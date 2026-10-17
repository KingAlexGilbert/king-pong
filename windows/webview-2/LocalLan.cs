// Offline signaling only. Protocol and limits: native/LAN-PROTOCOL.md.
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace KingPongWebView2
{
    internal sealed class LocalLanBridge : IDisposable
    {
        internal const int Port = 45873, Limit = 65536;
        internal static readonly Stopwatch Clock = Stopwatch.StartNew();
        readonly Action<string> emit;
        readonly BlockingCollection<Action> commands = new BlockingCollection<Action>(128);
        Room active;
        readonly object lifecycleGate = new object();
        int lifecycle;
        int scanning;
        volatile bool disposed;
        public LocalLanBridge(Action<string> emit)
        {
            this.emit = emit;
            new Thread(() => { foreach (var work in commands.GetConsumingEnumerable()) { try { work(); } catch { } } }) { IsBackground = true }.Start();
        }
        internal static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>();
            for (int i = 0; i < pairs.Length; i += 2) result[(string)pairs[i]] = pairs[i + 1];
            return result;
        }
        internal static string Text(Dictionary<string, object> m, string key) { object v; return m != null && m.TryGetValue(key, out v) ? v as string : null; }
        internal static int Number(Dictionary<string, object> m, string key, int fallback = 0) { object v; return m != null && m.TryGetValue(key, out v) && v is int ? (int)v : fallback; }
        internal static bool Yes(Dictionary<string, object> m, string key) { object v; return m != null && m.TryGetValue(key, out v) && v is bool && (bool)v; }
        internal static object Value(Dictionary<string, object> m, string key) { object v; return m != null && m.TryGetValue(key, out v) ? v : null; }
        internal static string Json(object m) { return new JavaScriptSerializer { MaxJsonLength = Limit, RecursionLimit = 12 }.Serialize(m); }
        internal static Dictionary<string, object> Parse(string text) { return new JavaScriptSerializer { MaxJsonLength = Limit, RecursionLimit = 12 }.DeserializeObject(text) as Dictionary<string, object>; }
        internal static bool Local(string text)
        {
            IPAddress ip;
            if (!IPAddress.TryParse(text, out ip) || ip.AddressFamily != AddressFamily.InterNetwork || ip.ToString() != text) return false;
            var a = ip.GetAddressBytes(); return a[0] == 10 || a[0] == 127 || a[0] == 192 && a[1] == 168 || a[0] == 172 && a[1] >= 16 && a[1] <= 31 || a[0] == 169 && a[1] == 254;
        }
        internal static string RandomHex(int bytes) { var data = new byte[bytes]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(data); return BitConverter.ToString(data).Replace("-", "").ToLowerInvariant(); }
        internal static bool Hex(string s, int length) { return s != null && s.Length == length && s.All(c => c >= '0' && c <= '9' || c >= 'a' && c <= 'f'); }
        internal static bool Signal(Dictionary<string, object> m, bool host)
        {
            if (m == null || Number(m, "attempt") != 0) return false;
            string type = Text(m, "type");
            var d = Value(m, "description") as Dictionary<string, object>;
            var c = Value(m, "candidate") as Dictionary<string, object>;
            if (type == "description") return Text(d, "type") == (host ? "offer" : "answer") && Text(d, "sdp") != null && Text(d, "sdp").Length <= 49152;
            if (type == "candidate") return Text(c, "candidate") != null && Text(c, "candidate").Length <= 4096 && (Value(c, "sdpMid") == null || Text(c, "sdpMid") != null && Text(c, "sdpMid").Length <= 256) && (Value(c, "sdpMLineIndex") == null || Value(c, "sdpMLineIndex") is int && Number(c, "sdpMLineIndex") >= 0 && Number(c, "sdpMLineIndex") <= 32);
            return type == "connected" || host && type == "start" && Value(m, "iceServers") is object[] && ((object[])m["iceServers"]).Length == 0;
        }
        internal static List<string> Addresses(bool broadcasts)
        {
            var result = new List<string>();
            try { foreach (var nic in NetworkInterface.GetAllNetworkInterfaces()) foreach (var a in nic.GetIPProperties().UnicastAddresses) {
                if (a.Address.AddressFamily != AddressFamily.InterNetwork || !Local(a.Address.ToString()) || IPAddress.IsLoopback(a.Address)) continue;
                if (!broadcasts) result.Add(a.Address.ToString());
                else { var ip = a.Address.GetAddressBytes(); var mask = a.IPv4Mask.GetAddressBytes(); for (int i = 0; i < 4; i++) ip[i] |= (byte)~mask[i]; result.Add(new IPAddress(ip).ToString()); }
            } } catch { }
            return result;
        }
        public void Handle(string text)
        {
            if (disposed || text == null || text.Length > Limit) return;
            Dictionary<string, object> m; try { m = Parse(text); } catch { return; }
            int gen = Number(m, "generation"); string op = Text(m, "op"); if (gen <= 0) return;
            int epoch = Volatile.Read(ref lifecycle);
            try { commands.TryAdd(() => { lock (lifecycleGate) {
                if (disposed || epoch != lifecycle) return;
                try {
                    if (op == "discover") {
                        if (Interlocked.CompareExchange(ref scanning, 1, 0) == 0) new Thread(() => { try { Discover(gen); } finally { scanning = 0; } }) { IsBackground = true }.Start();
                    } else if (op == "host" || op == "join") {
                        if (active != null) active.Dispose(); active = new Room(gen, emit); var room = active;
                        if (op == "host") room.Host();
                        else new Thread(() => { try { room.Join(m); } catch { room.Emit("error", "code", "connection_lost"); room.Dispose(); } }) { IsBackground = true }.Start();
                    } else if (active != null && active.Generation == gen) {
                        if (op == "close") active.Dispose();
                        else if (op == "send") active.Send(Value(m, "message") as Dictionary<string, object>);
                        else if (op == "approve") active.Approve(Text(m, "request"), Yes(m, "accept"));
                        else if (op == "release") active.Release(Yes(m, "block"), Yes(m, "block") ? "kicked" : "guest_left");
                    }
                } catch { emit(Json(Map("type", "error", "generation", gen, "code", "connection_lost"))); }
            } }); } catch (InvalidOperationException) { }
        }
        void Discover(int generation)
        {
            var rooms = new Dictionary<string, object>(); string nonce = RandomHex(16);
            try { using (var udp = new UdpClient(0)) {
                udp.EnableBroadcast = true; udp.Client.ReceiveTimeout = 250;
                var message = Encoding.UTF8.GetBytes(Json(Map("v", 1, "type", "discover", "nonce", nonce)));
                foreach (string address in Addresses(true).Concat(new[] { "255.255.255.255", "127.0.0.1" }).Distinct()) { try { udp.Send(message, message.Length, new IPEndPoint(IPAddress.Parse(address), Port)); } catch (SocketException) { } }
                long end = Clock.ElapsedMilliseconds + 2000;
                while (!disposed && Clock.ElapsedMilliseconds < end) { try {
                    IPEndPoint from = new IPEndPoint(IPAddress.Any, 0); byte[] data = udp.Receive(ref from); if (data.Length > 1024 || !Local(from.Address.ToString())) continue;
                    var m = Parse(Encoding.UTF8.GetString(data)); int port = Number(m, "port"); string id = Text(m, "room");
                    if (Number(m, "v") == 1 && Text(m, "type") == "room" && Text(m, "nonce") == nonce && Hex(id, 32) && port >= 1024 && port <= 65535 && rooms.Count < 32)
                        rooms[id] = Map("room", id, "address", from.Address.ToString(), "port", port, "full", Yes(m, "full"));
                } catch { } }
            } } catch { }
            if (!disposed) emit(Json(Map("type", "rooms", "generation", generation, "rooms", rooms.Values.ToArray())));
        }
        public void Stop() { lock (lifecycleGate) { lifecycle++; if (active != null) active.Dispose(); } }
        public void Dispose() { disposed = true; Stop(); commands.CompleteAdding(); }

        sealed class Peer : IDisposable
        {
            internal readonly Socket Socket;
            readonly List<byte> buffer = new List<byte>(); readonly object writeLock = new object();
            internal volatile bool Approved; internal volatile bool Closed; internal string Token = "", Request = RandomHex(8);
            internal readonly long Started = Clock.ElapsedMilliseconds;
            internal Peer(Socket socket) { Socket = socket; socket.SendTimeout = 1000; }
            internal void Send(Dictionary<string, object> m) { lock (writeLock) { if (Closed) return; m = new Dictionary<string, object>(m); m["v"] = 1; var data = Encoding.UTF8.GetBytes(Json(m) + "\n"); if (data.Length > Limit) throw new InvalidOperationException(); int pos = 0; while (pos < data.Length) { int n = Socket.Send(data, pos, data.Length-pos, SocketFlags.None); if (n <= 0) throw new InvalidOperationException(); pos += n; } } }
            internal Dictionary<string, object> Line(long deadline) {
                int newline;
                while ((newline = buffer.IndexOf(10)) < 0) {
                    if (Closed) throw new InvalidOperationException(); if (Clock.ElapsedMilliseconds >= deadline) throw new TimeoutException();
                    if (!Socket.Poll(250000, SelectMode.SelectRead)) continue;
                    var data = new byte[4096]; int n = Socket.Receive(data); if (n == 0) throw new InvalidOperationException();
                    buffer.AddRange(data.Take(n)); if (buffer.Count > Limit) throw new InvalidOperationException();
                }
                string text = new UTF8Encoding(false, true).GetString(buffer.Take(newline).ToArray()); buffer.RemoveRange(0,newline+1);
                var m = Parse(text); if (m == null || Number(m, "v") != 1) throw new InvalidOperationException(); return m;
            }
            public void Dispose() { Closed = true; try { Socket.Shutdown(SocketShutdown.Both); } catch { } Socket.Close(); }
        }
        sealed class Room : IDisposable
        {
            internal readonly int Generation; readonly Action<string> emit; readonly object gate = new object();
            volatile bool closed; bool host; string code, room; TcpListener listener; UdpClient udp; volatile Peer peer;
            readonly HashSet<string> blocked = new HashSet<string>(); readonly Dictionary<string, Tuple<long,int>> rates = new Dictionary<string, Tuple<long,int>>();
            internal Room(int gen, Action<string> emit) { Generation = gen; this.emit = emit; }
            internal void Emit(string type, params object[] fields) { if (closed) return; var m = Map(fields); m["type"] = type; m["generation"] = Generation; emit(Json(m)); }
            internal void Host() {
                if (closed) return; host = true; room = RandomHex(16);
                const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                var bytes = new byte[6]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
                // The 32-character alphabet divides the byte range without bias.
                code = new string(bytes.Select(b => alphabet[b % alphabet.Length]).ToArray());
                listener = new TcpListener(IPAddress.Any, 0); listener.Start(4); int port = ((IPEndPoint)listener.LocalEndpoint).Port;
                try { udp = new UdpClient(Port); udp.Client.ReceiveTimeout = 500; new Thread(() => Discovery(port)) { IsBackground = true }.Start(); } catch { if (udp != null) udp.Close(); udp = null; }
                Emit("hosting", "code", code, "room", room, "port", port, "addresses", Addresses(false).ToArray(), "discovery", udp != null);
                new Thread(Accept) { IsBackground = true }.Start();
            }
            void Discovery(int port) {
                var rate = new Dictionary<string,long>();
                while (!closed) try {
                    IPEndPoint from = new IPEndPoint(IPAddress.Any,0); var data = udp.Receive(ref from); string ip = from.Address.ToString();
                    foreach (var key in rate.Keys.ToArray()) if (Clock.ElapsedMilliseconds-rate[key] >= 1000) rate.Remove(key);
                    if (data.Length > 1024 || !Local(ip) || rate.ContainsKey(ip) || rate.Count >= 64) continue;
                    var m = Parse(Encoding.UTF8.GetString(data)); if (Number(m,"v") != 1 || Text(m,"type") != "discover" || !Hex(Text(m,"nonce"),32)) continue;
                    rate[ip] = Clock.ElapsedMilliseconds; var reply = Encoding.UTF8.GetBytes(Json(Map("v",1,"type","room","nonce",Text(m,"nonce"),"room",room,"port",port,"full",peer!=null)));
                    udp.Send(reply,reply.Length,from);
                } catch { }
            }
            bool Allow(string ip) {
                long now=Clock.ElapsedMilliseconds; foreach(var key in rates.Keys.ToArray()) if(now-rates[key].Item1>=30000) rates.Remove(key);
                Tuple<long,int> value; if(!rates.TryGetValue(ip,out value)) value=Tuple.Create(now,0);
                if(value.Item2>=8 || rates.Count>=128&&!rates.ContainsKey(ip)) return false; rates[ip]=Tuple.Create(value.Item1,value.Item2+1); return true;
            }
            void Accept() {
                while(!closed) { Peer p=null; try {
                    p=new Peer(listener.AcceptSocket()); string ip=((IPEndPoint)p.Socket.RemoteEndPoint).Address.ToString();
                    if(!Local(ip)||!Allow(ip)) { p.Send(Map("type","error","code","rate_limited"));p.Dispose();continue; }
                    if(peer!=null) { p.Send(Map("type","error","code","room_full"));p.Dispose();continue; }
                    var m=p.Line(Clock.ElapsedMilliseconds+5000); string token=Text(m,"token"), requested=Text(m,"room")??"";
                    string provided=Text(m,"code")??""; int difference=provided.Length^code.Length; for(int i=0;i<Math.Min(provided.Length,code.Length);i++) difference|=provided[i]^code[i];
                    if(Text(m,"type")!="join"||difference!=0||requested!=""&&requested!=room||!Hex(token,32)) { p.Send(Map("type","error","code","invalid_code"));p.Dispose();continue; }
                    lock(gate) { if(blocked.Contains(token)) { p.Send(Map("type","error","code","rejected"));p.Dispose();continue; } if(closed){p.Dispose();return;}p.Token=token;peer=p; }
                    p.Send(Map("type","welcome","code",code,"room",room));Emit("peer","request",p.Request);
                    var accepted=p; new Thread(()=>Read(accepted)){IsBackground=true}.Start();
                } catch { if(p!=null)p.Dispose(); } }
            }
            internal void Join(Dictionary<string,object> m) {
                string address=Text(m,"address");int port=Number(m,"port");if(!Local(address)||port<1024||port>65535)throw new InvalidOperationException();
                var socket=new Socket(AddressFamily.InterNetwork,SocketType.Stream,ProtocolType.Tcp);
                try { var task=socket.BeginConnect(IPAddress.Parse(address),port,null,null);using(task.AsyncWaitHandle){if(!task.AsyncWaitHandle.WaitOne(5000))throw new TimeoutException();}socket.EndConnect(task); }
                catch {socket.Close();throw;}
                var p=new Peer(socket);lock(gate){if(closed){p.Dispose();return;}peer=p;}
                p.Send(Map("type","join","code",Text(m,"code"),"room",Text(m,"room")??"","token",Text(m,"token")));
                var reply=p.Line(Clock.ElapsedMilliseconds+5000);if(Text(reply,"type")!="welcome"){Emit("error","code",Text(reply,"code")??"incompatible");Dispose();return;}
                code=Text(reply,"code");Emit("joined","code",code);Read(p);
            }
            void Read(Peer p) {
                long ping=Clock.ElapsedMilliseconds,last=ping,bucket=ping;int count=0;
                try { while(!closed&&!p.Closed) {
                    long now=Clock.ElapsedMilliseconds;if(now-last>20000||!p.Approved&&now-p.Started>60000)throw new TimeoutException();
                    if(now-ping>=5000){p.Send(Map("type","ping"));ping=now;}
                    Dictionary<string,object> m;try{m=p.Line(now+500);}catch(TimeoutException){continue;}
                    last=Clock.ElapsedMilliseconds;if(last-bucket>=10000){bucket=last;count=0;}if(++count>160)throw new InvalidOperationException();
                    string type=Text(m,"type");if(type=="ping"){p.Send(Map("type","pong"));continue;}if(type=="pong")continue;
                    if(!host&&type=="approved"){p.Approved=true;continue;}if(!host&&type=="error"){Emit("error","code",Text(m,"code")??"connection_lost");Dispose();break;}
                    if(!p.Approved||!Signal(m,!host))throw new InvalidOperationException();m.Remove("v");Emit("signal","message",m);
                }}catch{}finally{lock(gate){if(peer==p){peer=null;Emit(host?"departed":"error","code","host_left");}}p.Dispose();}
            }
            internal void Approve(string request,bool accept) {lock(gate){if(peer==null||peer.Request!=request||peer.Approved)return;if(accept){peer.Approved=true;peer.Send(Map("type","approved"));Emit("admitted");}else Release(true,"rejected");}}
            internal void Send(Dictionary<string,object> m){lock(gate){if(peer!=null&&peer.Approved&&Signal(m,host))peer.Send(m);}}
            internal void Release(bool block,string reason){lock(gate){var p=peer;if(p==null)return;peer=null;if(block&&blocked.Count<128)blocked.Add(p.Token);try{p.Send(Map("type","error","code",reason));}catch{}p.Dispose();Emit("departed");}}
            public void Dispose(){closed=true;if(listener!=null)listener.Stop();if(udp!=null)udp.Close();lock(gate){if(peer!=null)peer.Dispose();peer=null;}}
        }
    }
}

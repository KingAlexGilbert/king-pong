package com.kingalex.kingpong;

// Pure Java networking; no service, third-party library or gameplay transport.
// Limits and wire format are shared with native/LAN-PROTOCOL.md.
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

final class LocalLan implements Closeable {
    static final int PORT=45873, LIMIT=65536;
    static final SecureRandom RANDOM=new SecureRandom();
    final Consumer<String> emit;
    final ThreadPoolExecutor commands=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(128),r->{Thread t=new Thread(r,"KingPong LAN");t.setDaemon(true);return t;},new ThreadPoolExecutor.DiscardPolicy());
    final AtomicBoolean scanning=new AtomicBoolean();
    volatile Room active;
    volatile int lifecycle;
    volatile boolean closed;
    LocalLan(Consumer<String> emit){this.emit=emit;}
    static long now(){return System.nanoTime()/1000000;}
    static JSONObject obj(Object... pairs){JSONObject m=new JSONObject();try{for(int i=0;i<pairs.length;i+=2)m.put((String)pairs[i],pairs[i+1]);}catch(Exception e){throw new IllegalArgumentException(e);}return m;}
    static String text(JSONObject m,String key){Object v=m==null?null:m.opt(key);return v instanceof String?(String)v:null;}
    static boolean hex(String s,int n){return s!=null&&s.length()==n&&s.matches("[a-f0-9]+");}
    static String randomHex(int n){byte[] b=new byte[n];RANDOM.nextBytes(b);StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
    static JSONObject parse(String text)throws Exception {
        int depth=0;boolean quoted=false,escaped=false;
        for(int i=0;i<text.length();i++){char c=text.charAt(i);if(escaped){escaped=false;continue;}if(quoted&&c=='\\'){escaped=true;continue;}if(c=='"')quoted=!quoted;else if(!quoted){if(c=='{'||c=='[')depth++;else if(c=='}'||c==']')depth--;if(depth>12)throw new IOException("depth");}}
        return new JSONObject(text);
    }
    static boolean local(String s){
        if(s==null||!s.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"))return false;
        String[] p=s.split("\\.");int[] a=new int[4];for(int i=0;i<4;i++){a[i]=Integer.parseInt(p[i]);if(a[i]>255||!p[i].equals(Integer.toString(a[i])))return false;}
        return a[0]==10||a[0]==127||a[0]==192&&a[1]==168||a[0]==172&&a[1]>=16&&a[1]<=31||a[0]==169&&a[1]==254;
    }
    static boolean signal(JSONObject m,boolean host){
        if(m==null||m.optInt("attempt",0)!=0)return false;String type=text(m,"type");
        JSONObject d=m.optJSONObject("description"),c=m.optJSONObject("candidate");
        if("description".equals(type))return (host?"offer":"answer").equals(text(d,"type"))&&text(d,"sdp")!=null&&text(d,"sdp").length()<=49152;
        if("candidate".equals(type))return text(c,"candidate")!=null&&text(c,"candidate").length()<=4096&&(c.isNull("sdpMid")||text(c,"sdpMid")!=null&&text(c,"sdpMid").length()<=256)&&(c.isNull("sdpMLineIndex")||c.opt("sdpMLineIndex") instanceof Integer&&c.optInt("sdpMLineIndex")>=0&&c.optInt("sdpMLineIndex")<=32);
        return "connected".equals(type)||host&&"start".equals(type)&&m.optJSONArray("iceServers")!=null&&m.optJSONArray("iceServers").length()==0;
    }
    static List<String> addresses(boolean broadcast){
        List<String> result=new ArrayList<>();try{Enumeration<NetworkInterface> all=NetworkInterface.getNetworkInterfaces();while(all!=null&&all.hasMoreElements()){
            NetworkInterface nic=all.nextElement();for(InterfaceAddress a:nic.getInterfaceAddresses())if(a.getAddress() instanceof Inet4Address&&local(a.getAddress().getHostAddress())&&!a.getAddress().isLoopbackAddress()){
                InetAddress address=broadcast?a.getBroadcast():a.getAddress();if(address!=null)result.add(address.getHostAddress());
            }
        }}catch(Exception ignored){}return result;
    }
    static void thread(Runnable r){Thread t=new Thread(r,"KingPong LAN socket");t.setDaemon(true);t.start();}
    void handle(String input){
        if(closed||input==null||input.length()>LIMIT)return;
        final JSONObject m;try{m=parse(input);}catch(Exception e){return;}
        final int generation=m.optInt("generation",0);final String op=text(m,"op");if(generation<=0)return;
        final int epoch=lifecycle;
        commands.execute(()->{synchronized(this){
            if(closed||epoch!=lifecycle)return;
            try{
                if("discover".equals(op)){if(scanning.compareAndSet(false,true))thread(()->{try{discover(generation);}finally{scanning.set(false);}});}
                else if("host".equals(op)||"join".equals(op)){
                    if(active!=null)active.close();Room room=new Room(generation);active=room;
                    if("host".equals(op))room.host();else thread(()->{try{room.join(m);}catch(Exception e){room.event("error","code","connection_lost");room.close();}});
                }else{Room room=active;if(room==null||room.generation!=generation)return;
                    if("close".equals(op))room.close();
                    else if("send".equals(op))room.send(m.optJSONObject("message"));
                    else if("approve".equals(op))room.approve(text(m,"request"),m.optBoolean("accept",false));
                    else if("release".equals(op))room.release(m.optBoolean("block",false),m.optBoolean("block",false)?"kicked":"guest_left");
                }
            }catch(Exception e){emit.accept(obj("type","error","generation",generation,"code","connection_lost").toString());}
        }});
    }
    void discover(int generation){
        Map<String,JSONObject> rooms=new LinkedHashMap<>();String nonce=randomHex(16);
        try(DatagramSocket socket=new DatagramSocket()){
            socket.setBroadcast(true);socket.setSoTimeout(250);
            Set<String> destinations=new HashSet<>(addresses(true));destinations.add("255.255.255.255");destinations.add("127.0.0.1");
            byte[] data=obj("v",1,"type","discover","nonce",nonce).toString().getBytes(StandardCharsets.UTF_8);
            for(String ip:destinations)try{socket.send(new DatagramPacket(data,data.length,InetAddress.getByName(ip),PORT));}catch(IOException ignored){}
            long end=now()+2000;
            while(!closed&&now()<end)try{
                DatagramPacket packet=new DatagramPacket(new byte[1025],1025);socket.receive(packet);
                if(packet.getLength()>1024||!local(packet.getAddress().getHostAddress()))continue;
                JSONObject m=parse(new String(packet.getData(),0,packet.getLength(),StandardCharsets.UTF_8));String id=text(m,"room");int port=m.optInt("port",0);
                if(m.optInt("v")==1&&"room".equals(text(m,"type"))&&nonce.equals(text(m,"nonce"))&&hex(id,32)&&port>=1024&&port<=65535&&rooms.size()<32)
                    rooms.put(id,obj("room",id,"address",packet.getAddress().getHostAddress(),"port",port,"full",m.optBoolean("full",false)));
            }catch(Exception ignored){}
        }catch(IOException ignored){}
        if(!closed)emit.accept(obj("type","rooms","generation",generation,"rooms",new JSONArray(rooms.values())).toString());
    }
    synchronized void stop(){lifecycle++;Room room=active;if(room!=null)room.close();}
    @Override public void close(){closed=true;stop();commands.shutdownNow();}

    static final class Peer implements Closeable{
        final Socket socket;final SocketChannel channel;final Selector reads,writes;
        final byte[] buffer=new byte[LIMIT+1];int length;
        final long started=now();final String request=randomHex(8);
        volatile boolean closed,approved;String token="";
        Peer(Socket socket)throws IOException{this.socket=socket;channel=socket.getChannel();channel.configureBlocking(false);reads=Selector.open();writes=Selector.open();channel.register(reads,SelectionKey.OP_READ);channel.register(writes,SelectionKey.OP_WRITE);}
        synchronized void send(JSONObject message)throws Exception{
            if(closed)return;JSONObject copy=new JSONObject(message.toString());copy.put("v",1);byte[] data=(copy.toString()+"\n").getBytes(StandardCharsets.UTF_8);
            if(data.length>LIMIT)throw new IOException("oversized");ByteBuffer bytes=ByteBuffer.wrap(data);long deadline=now()+1000;while(bytes.hasRemaining()){if(closed||now()>=deadline)throw new IOException("write timeout");if(channel.write(bytes)==0){writes.select(100);writes.selectedKeys().clear();}}
        }
        JSONObject line(long deadline)throws Exception{
            while(!closed){
                for(int i=0;i<length;i++)if(buffer[i]==10){String text=new String(buffer,0,i,StandardCharsets.UTF_8);System.arraycopy(buffer,i+1,buffer,0,length-i-1);length-=i+1;JSONObject m=parse(text);if(!(m.opt("v") instanceof Integer)||m.optInt("v",0)!=1)throw new IOException("version");return m;}
                if(now()>=deadline)throw new SocketTimeoutException();if(length>=LIMIT)throw new IOException("oversized");
                if(reads.select(Math.max(1,Math.min(250,deadline-now())))==0)continue;reads.selectedKeys().clear();int n=channel.read(ByteBuffer.wrap(buffer,length,Math.min(4096,buffer.length-length)));if(n<0)throw new IOException("closed");length+=n;if(length>LIMIT)throw new IOException("oversized");
            }throw new IOException("closed");
        }
        public void close(){closed=true;try{channel.close();reads.wakeup();writes.wakeup();reads.close();writes.close();}catch(IOException ignored){}}
    }
    final class Room implements Closeable{
        final int generation;final Object gate=new Object();final Set<String> blocked=new HashSet<>();
        final Map<String,long[]> rates=new HashMap<>();volatile boolean closed;boolean hosting;
        String code,room;volatile Peer peer;ServerSocketChannel listener;DatagramSocket udp;
        Room(int generation){this.generation=generation;}
        void event(String type,Object... fields){if(closed)return;JSONObject m=obj(fields);try{m.put("type",type);m.put("generation",generation);emit.accept(m.toString());}catch(Exception ignored){}}
        void host()throws Exception{
            if(closed)return;hosting=true;room=randomHex(16);String alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";StringBuilder b=new StringBuilder();for(int i=0;i<6;i++)b.append(alphabet.charAt(RANDOM.nextInt(alphabet.length())));code=b.toString();
            listener=ServerSocketChannel.open();listener.socket().bind(new InetSocketAddress(0),4);int port=listener.socket().getLocalPort();
            try{udp=new DatagramSocket(PORT);udp.setSoTimeout(500);thread(()->discovery(port));}catch(IOException e){if(udp!=null)udp.close();udp=null;}
            event("hosting","code",code,"room",room,"port",port,"addresses",new JSONArray(addresses(false)),"discovery",udp!=null);thread(this::accept);
        }
        void discovery(int port){Map<String,Long> rates=new HashMap<>();while(!closed)try{
            DatagramPacket p=new DatagramPacket(new byte[1025],1025);udp.receive(p);String ip=p.getAddress().getHostAddress();long time=now();rates.entrySet().removeIf(e->time-e.getValue()>=1000);
            if(p.getLength()>1024||!local(ip)||rates.containsKey(ip)||rates.size()>=64)continue;
            JSONObject m=parse(new String(p.getData(),0,p.getLength(),StandardCharsets.UTF_8));if(m.optInt("v")!=1||!"discover".equals(text(m,"type"))||!hex(text(m,"nonce"),32))continue;
            rates.put(ip,time);byte[] data=obj("v",1,"type","room","nonce",text(m,"nonce"),"room",room,"port",port,"full",peer!=null).toString().getBytes(StandardCharsets.UTF_8);udp.send(new DatagramPacket(data,data.length,p.getAddress(),p.getPort()));
        }catch(Exception ignored){}}
        boolean allow(String ip){long time=now();rates.entrySet().removeIf(e->time-e.getValue()[0]>=30000);long[] value=rates.get(ip);if(value==null)value=new long[]{time,0};if(value[1]>=8||rates.size()>=128&&!rates.containsKey(ip))return false;value[1]++;rates.put(ip,value);return true;}
        void accept(){while(!closed){Peer p=null;try{
            p=new Peer(listener.accept().socket());String ip=p.socket.getInetAddress().getHostAddress();
            if(!local(ip)||!allow(ip)){p.send(obj("type","error","code","rate_limited"));p.close();continue;}
            if(peer!=null){p.send(obj("type","error","code","room_full"));p.close();continue;}
            JSONObject m=p.line(now()+5000);String token=text(m,"token"),requested=m.optString("room","");String provided=m.optString("code","");
            if(!"join".equals(text(m,"type"))||!java.security.MessageDigest.isEqual(provided.getBytes(StandardCharsets.UTF_8),code.getBytes(StandardCharsets.UTF_8))||!requested.isEmpty()&&!room.equals(requested)||!hex(token,32)){
                p.send(obj("type","error","code","invalid_code"));p.close();continue;
            }
            synchronized(gate){if(blocked.contains(token)){p.send(obj("type","error","code","rejected"));p.close();continue;}if(closed){p.close();return;}p.token=token;peer=p;}
            p.send(obj("type","welcome","code",code,"room",room));event("peer","request",p.request);Peer accepted=p;thread(()->read(accepted));
        }catch(Exception e){if(p!=null)p.close();}}}
        void join(JSONObject m)throws Exception{
            String address=text(m,"address");int port=m.optInt("port",0);if(!local(address)||port<1024||port>65535)throw new IOException("invalid address");
            Socket socket=SocketChannel.open().socket();try{socket.connect(new InetSocketAddress(InetAddress.getByName(address),port),5000);}catch(Exception e){socket.close();throw e;}
            Peer p=new Peer(socket);synchronized(gate){if(closed){p.close();return;}peer=p;}
            p.send(obj("type","join","code",text(m,"code"),"room",m.optString("room",""),"token",text(m,"token")));
            JSONObject reply=p.line(now()+5000);if(!"welcome".equals(text(reply,"type"))){event("error","code",reply.optString("code","incompatible"));close();return;}
            code=text(reply,"code");event("joined","code",code);read(p);
        }
        void read(Peer p){long ping=now(),last=ping,bucket=ping;int count=0;try{while(!closed&&!p.closed){
            // Signaling outlives the game's bounded 30-second background grace.
            long time=now();if(time-last>40000||!p.approved&&time-p.started>60000)throw new IOException("timeout");
            if(time-ping>=5000){p.send(obj("type","ping"));ping=time;}
            JSONObject m;try{m=p.line(time+500);}catch(SocketTimeoutException e){continue;}
            last=now();if(last-bucket>=10000){bucket=last;count=0;}if(++count>160)throw new IOException("rate");String type=text(m,"type");
            if("ping".equals(type)){p.send(obj("type","pong"));continue;}if("pong".equals(type))continue;
            if(!hosting&&"approved".equals(type)){p.approved=true;continue;}if(!hosting&&"error".equals(type)){event("error","code",m.optString("code","connection_lost"));close();break;}
            if(!p.approved||!signal(m,!hosting))throw new IOException("invalid");m.remove("v");event("signal","message",m);
        }}catch(Exception ignored){}finally{synchronized(gate){if(peer==p){peer=null;event(hosting?"departed":"error","code","host_left");}}p.close();}}
        void approve(String request,boolean accept)throws Exception{synchronized(gate){if(peer==null||!peer.request.equals(request)||peer.approved)return;if(accept){peer.approved=true;peer.send(obj("type","approved"));event("admitted");}else release(true,"rejected");}}
        void send(JSONObject m)throws Exception{synchronized(gate){if(peer!=null&&peer.approved&&signal(m,hosting))peer.send(m);}}
        void release(boolean block,String reason){synchronized(gate){Peer p=peer;if(p==null)return;peer=null;if(block&&blocked.size()<128)blocked.add(p.token);try{p.send(obj("type","error","code",reason));}catch(Exception ignored){}p.close();event("departed");}}
        public void close(){closed=true;try{if(listener!=null)listener.close();}catch(IOException ignored){}if(udp!=null)udp.close();Peer p=peer;if(p!=null)p.close();synchronized(gate){peer=null;}}
    }
}

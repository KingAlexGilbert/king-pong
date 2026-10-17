using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
namespace KingPongWebView2 {
    // One fixed Pages asset; JavaScript never supplies a URL/path.
    internal sealed class BossAudioCache {
        internal const string Url="https://kingalexgilbert.github.io/king-pong/audio/secret-boss-v1.ogg";
        internal const string Hash="2e88685119d386d9597cf62930a9335a4e894f599f4d580770cad7b4e2734167";
        internal const int Size=684920;int busy;
        static byte[] Read(Stream input){
            using(var output=new MemoryStream(Size)){
                var chunk=new byte[16384];var clock=Stopwatch.StartNew();int n;
                while((n=input.Read(chunk,0,Math.Min(chunk.Length,Size+1-(int)output.Length)))>0){output.Write(chunk,0,n);if(output.Length>Size||clock.ElapsedMilliseconds>10000)throw new IOException();}
                var bytes=output.ToArray();if(bytes.Length!=Size)throw new IOException();
                using(var hash=SHA256.Create())if(BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant()!=Hash)throw new IOException();return bytes;
            }
        }
        static byte[] Track(){
            string directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"KingPong","Cache"),path=Path.Combine(directory,"secret-boss-v1.ogg");
            try{using(var input=File.OpenRead(path))return Read(input);}catch(IOException){}catch(UnauthorizedAccessException){}
            var request=(HttpWebRequest)WebRequest.Create(Url);request.AllowAutoRedirect=false;request.Timeout=4000;request.ReadWriteTimeout=4000;byte[] bytes;
            using(var response=(HttpWebResponse)request.GetResponse()){if(response.StatusCode!=HttpStatusCode.OK)throw new IOException();using(var input=response.GetResponseStream())bytes=Read(input);}
            try{Directory.CreateDirectory(directory);string temporary=path+".tmp";File.WriteAllBytes(temporary,bytes);if(File.Exists(path))File.Replace(temporary,path,null);else File.Move(temporary,path);}catch(IOException){}catch(UnauthorizedAccessException){}
            return bytes;
        }
        internal void Load(string id,Action<string,string> emit){
            if(id==null||!Regex.IsMatch(id,"\\A[A-Za-z0-9_-]{1,32}\\z")||Interlocked.CompareExchange(ref busy,1,0)!=0)return;
            new Thread(()=>{string result=null;try{result=Convert.ToBase64String(Track());}catch{}finally{Interlocked.Exchange(ref busy,0);}emit(id,result);}){IsBackground=true}.Start();
        }
    }
}

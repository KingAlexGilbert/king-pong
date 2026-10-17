package com.kingalex.kingpong;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;
import android.util.Base64;
// One fixed asset; bridge arguments are never paths or URLs.
final class BossAudioCache {
    static final String URL_TEXT="https://kingalexgilbert.github.io/king-pong/audio/secret-boss-v1.ogg";
    static final String HASH="2e88685119d386d9597cf62930a9335a4e894f599f4d580770cad7b4e2734167";
    static final int SIZE=684920;
    final File directory;final AtomicBoolean busy=new AtomicBoolean();
    BossAudioCache(File directory){this.directory=directory;}
    static boolean valid(byte[] bytes)throws Exception{
        if(bytes.length!=SIZE)return false;byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder text=new StringBuilder();for(byte b:hash)text.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return HASH.equals(text.toString());
    }
    static byte[] read(InputStream input)throws Exception{
        ByteArrayOutputStream output=new ByteArrayOutputStream(SIZE);byte[] chunk=new byte[16384];long deadline=System.nanoTime()+10000000000L;int n;
        while((n=input.read(chunk,0,Math.min(chunk.length,SIZE+1-output.size())))!=-1){output.write(chunk,0,n);if(output.size()>SIZE||System.nanoTime()>deadline)throw new IOException("audio size/timeout");}
        byte[] bytes=output.toByteArray();if(!valid(bytes))throw new IOException("audio integrity");return bytes;
    }
    byte[] track()throws Exception{
        File file=new File(directory,"secret-boss-v1.ogg");try(InputStream input=new FileInputStream(file)){return read(input);}catch(Exception ignored){}
        HttpURLConnection connection=(HttpURLConnection)new URL(URL_TEXT).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(4000);connection.setReadTimeout(4000);byte[] bytes;
        try{if(connection.getResponseCode()!=200)throw new IOException("audio unavailable");try(InputStream input=connection.getInputStream()){bytes=read(input);}}finally{connection.disconnect();}
        try{directory.mkdirs();File temporary=new File(directory,"secret-boss-v1.tmp");try(OutputStream output=new FileOutputStream(temporary)){output.write(bytes);}if(!temporary.renameTo(file))temporary.delete();}catch(Exception ignored){}
        return bytes;
    }
    void load(String id,BiConsumer<String,String> emit){
        if(id==null||!id.matches("[A-Za-z0-9_-]{1,32}")||!busy.compareAndSet(false,true))return;
        Thread worker=new Thread(()->{String result=null;try{result=Base64.encodeToString(track(),Base64.NO_WRAP);}catch(Exception ignored){}finally{busy.set(false);}emit.accept(id,result);},"KingPong optional audio");worker.setDaemon(true);worker.start();
    }
}

using System;
using System.Text;
using KingPongWebView2;

// Console harness for the production Windows LAN core; no WebView dependency.
internal static class LanDriver
{
    private static readonly object Output = new object();
    private static void Main()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        using (var bridge = new LocalLanBridge(text => {
            lock (Output) { Console.WriteLine(text); Console.Out.Flush(); }
        })) {
            string line;
            while ((line = Console.ReadLine()) != null) bridge.Handle(line);
        }
    }
}

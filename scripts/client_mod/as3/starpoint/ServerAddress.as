package starpoint
{
   import flash.filesystem.File;
   import flash.filesystem.FileMode;
   import flash.filesystem.FileStream;

   // Optional server address file for the CN client (patch_cn_server_file.cjs): lets a phone play against a
   // PC's StarPoint over plain Wi-Fi. At the first API/version request the game reads server.txt from
   //   /sdcard/Android/obb/com.leiting.wf/server.txt   (the game's own folder: no permission needed)
   //   /sdcard/StarPoint/server.txt                    (needs All files access / the storage permission)
   // The first non-empty line that doesn't start with # is the address: host:port (e.g. 192.168.1.20:8000).
   // A BOM, spaces, CRLF, an http:// in front, a trailing / and a trailing /cn are all fine; no port = 8000.
   // Valid: the API host, the version check (and so the CDN and patch downloads, whose addresses the server
   // builds from the address the game used) go there. Missing or not understood: the address baked into
   // the APK, as without this file. Co-op's battle address comes from the server's replies (COOP_HOST).
   public class ServerAddress
   {
      public static const PATHS:Array = ["/sdcard/Android/obb/com.leiting.wf/server.txt", "/sdcard/StarPoint/server.txt"];
      public static var loaded:Boolean = false;
      public static var custom:String = null; // host:port from the file
      public static var problem:String = null; // a file was there but not understood

      public static function load():void
      {
         if (loaded) return;
         loaded = true;
         for (var i:int = 0; i < PATHS.length; i++)
         {
            try
            {
               var f:File = new File(PATHS[i]);
               if (!f.exists || f.isDirectory) continue;
               if (f.size > 4096) throw new Error("file is too big");
               var s:FileStream = new FileStream();
               s.open(f, FileMode.READ);
               var text:String = s.readUTFBytes(s.bytesAvailable);
               s.close();
               var address:String = parse(text);
               if (address == null) throw new Error("no host:port in it");
               custom = address;
               problem = null;
               trace("[ServerAddress] " + PATHS[i] + ": " + address);
               return;
            }
            catch (e:*)
            {
               // a bad or unreadable file never stops the game: the baked address is used
               problem = PATHS[i];
               trace("[ServerAddress] ignoring " + PATHS[i] + ": " + e);
            }
         }
      }

      // the address in the file's text, or null
      public static function parse(text:String):String
      {
         var lines:Array = text.split("\n");
         for (var i:int = 0; i < lines.length; i++)
         {
            var line:String = String(lines[i]).split(String.fromCharCode(0xFEFF)).join("").replace(/^\s+|\s+$/g, "");
            if (line.length == 0 || line.charAt(0) == "#") continue;
            line = line.replace(/^https?:\/\//i, "").replace(/\/+$/, "").replace(/\/cn$/i, "").replace(/\/+$/, "");
            var m:Array = line.match(/^([A-Za-z0-9.\-]+)(:(\d{1,5}))?$/);
            if (m == null) return null;
            var port:int = m[3] ? int(m[3]) : 8000;
            if (port < 1 || port > 65535) return null;
            return m[1] + ":" + port;
         }
         return null;
      }

      // "127.0.0.1:8000/cn"-style API host (baked = the APK's own)
      public static function apiHost(baked:String):String
      {
         load();
         return custom != null ? custom + "/cn" : baked;
      }

      // "http://127.0.0.1:8000/cn/shijtswy/version/"-style version check address
      public static function versionUrl(baked:String):String
      {
         load();
         return custom != null ? "http://" + custom + "/cn/shijtswy/version/" : baked;
      }

      // a line for the title screen, above the version text ("" without a file)
      public static function titleLine():String
      {
         load();
         if (custom != null) return "Server: " + custom + "\n";
         if (problem != null) return "server.txt not understood\n";
         return "";
      }
   }
}

package starpoint
{
   import flash.events.Event;
   import flash.events.IOErrorEvent;
   import flash.events.SecurityErrorEvent;
   import flash.net.URLLoader;
   import flash.net.URLRequest;
   import flash.utils.getTimer;
   import flash.utils.setTimeout;

   // StarPoint profiling (test builds only). Patched game functions call begin(name) on entry and
   // end(name) before each return. Per name: calls, total time (with the timed functions it calls) and
   // self time (without them). Sent to the server as GET <url>?d=name:calls:total:self,...
   // (logs/cn_requests.log shows it). Never throws into the game.
   public class Perf
   {
      public static var url:String = "http://127.0.0.1:8000/cn/perf";
      // open calls, innermost last: { name, start, child }
      public static var stack:Array = [];
      public static var totals:Object = {};
      public static var selfs:Object = {};
      public static var calls:Object = {};
      public static var pending:Boolean = false;

      public static function begin(name:String):void
      {
         try
         {
            stack.push({ name: name, start: getTimer(), child: 0 });
         }
         catch (e:*) {}
      }

      public static function end(name:String):void
      {
         try
         {
            // a call that ended by an exception never reached end(): drop it
            var top:Object = null;
            while (stack.length > 0)
            {
               top = stack.pop();
               if (top.name == name) break;
               top = null;
            }
            if (top == null) return;
            var ms:int = getTimer() - int(top.start);
            totals[name] = int(totals[name]) + ms;
            selfs[name] = int(selfs[name]) + ms - int(top.child);
            calls[name] = int(calls[name]) + 1;
            if (stack.length > 0) stack[stack.length - 1].child += ms;
            if (!pending)
            {
               pending = true;
               setTimeout(flush, 1500);
            }
         }
         catch (e:*) {}
      }

      public static function flush():void
      {
         pending = false;
         try
         {
            var parts:Array = [];
            for (var name:String in totals)
            {
               if (int(totals[name]) >= 5 || int(selfs[name]) >= 3) parts.push(name + ":" + calls[name] + ":" + totals[name] + ":" + selfs[name]);
            }
            totals = {};
            selfs = {};
            calls = {};
            if (parts.length == 0) return;
            var loader:URLLoader = new URLLoader();
            loader.addEventListener(IOErrorEvent.IO_ERROR, ignore);
            loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR, ignore);
            loader.load(new URLRequest(url + "?d=" + encodeURIComponent(parts.join(","))));
         }
         catch (e:*) {}
      }

      public static function ignore(e:Event):void
      {
      }
   }
}

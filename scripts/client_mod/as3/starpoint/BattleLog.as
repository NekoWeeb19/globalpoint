package starpoint
{
   import flash.events.IOErrorEvent;
   import flash.events.SecurityErrorEvent;
   import flash.net.URLLoader;
   import flash.net.URLRequest;
   import flash.net.URLRequestMethod;
   import flash.utils.Dictionary;
   import flash.utils.getTimer;
   import flash.utils.setTimeout;

   // StarPoint battle log. The game's battle code is patched to call these functions; lines are sent to
   // the server (POST /starpoint/battle_log, through the same mitmproxy redirect as the game's API) about
   // once a second. Every function here must never throw into the game.
   public class BattleLog
   {
      public static var url:String = "https://na.wdfp.kakaogames.com/starpoint/battle_log";
      public static var lines:Array = [];
      public static var pending:Boolean = false;
      public static var dash:Dictionary = new Dictionary(true);

      public static function log(text:String):void
      {
         try
         {
            lines.push(getTimer() + " " + text);
            if (!pending)
            {
               pending = true;
               setTimeout(flush, 1000);
            }
         }
         catch (e:*) {}
      }

      public static function flush():void
      {
         pending = false;
         try
         {
            if (lines.length == 0) return;
            var req:URLRequest = new URLRequest(url);
            req.method = URLRequestMethod.POST;
            req.contentType = "text/plain";
            req.data = lines.join("\n");
            lines = [];
            var loader:URLLoader = new URLLoader();
            loader.addEventListener(IOErrorEvent.IO_ERROR, ignore);
            loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR, ignore);
            loader.load(req);
         }
         catch (e:*) {}
      }

      public static function ignore(e:*):void {}

      // Haxe enums -> Tag(params), numbers/strings as is, small arrays; anything else by a few fields.
      public static function show(v:*, depth:int = 0):String
      {
         try
         {
            if (v === null) return "null";
            if (v === undefined) return "undefined";
            if (v is Number || v is String || v is Boolean) return String(v);
            if (v is Array)
            {
               if (depth > 2) return "[..]";
               var parts:Array = [];
               for (var i:int = 0; i < v.length && i < 8; i++) parts.push(show(v[i], depth + 1));
               return "[" + parts.join(",") + "]";
            }
            if (v.hasOwnProperty("tag") && v.hasOwnProperty("params"))
            {
               if (v.params == null || v.params.length == 0 || depth > 2) return String(v.tag);
               return v.tag + show(v.params, depth + 1).replace(/^\[/, "(").replace(/\]$/, ")");
            }
            if (depth > 2) return "{..}";
            var out:Array = [];
            for (var k:String in v) out.push(k + ":" + show(v[k], depth + 1));
            return "{" + out.slice(0, 8).join(",") + "}";
         }
         catch (e:*) {}
         return "?";
      }

      public static function member(m:*):String
      {
         try
         {
            if (m == null) return "-";
            return "m" + m.index;
         }
         catch (e:*) {}
         return "m?";
      }

      // ConditionSlot.setCondition(key, condition)
      public static function condSet(slot:*, key:String, c:*):void
      {
         try
         {
            var owner:String = slot.ownerMember != null ? member(slot.ownerMember) : (slot.ownerEnemy != null ? "enemy" : "party");
            log("BUFF+ " + owner + " " + show(c.content) + " frames=" + c.timeLimit + " key=" + key);
         }
         catch (e:*) {}
      }

      // ConditionSlot.removeCondition(key)
      public static function condRemove(slot:*, key:String):void
      {
         try
         {
            var owner:String = slot.ownerMember != null ? member(slot.ownerMember) : (slot.ownerEnemy != null ? "enemy" : "party");
            log("BUFF- " + owner + " key=" + key);
         }
         catch (e:*) {}
      }

      // InstantAbility.apply(enemy, member, ...)
      public static function ability(a:*, m:*):void
      {
         try
         {
            log("ABILITY " + member(m) + " at=" + show(a.address) + " trigger=" + show(a.source.trigger) + " effect=" + show(a.source.content));
         }
         catch (e:*) {}
      }

      // BallImpl dash gauge refill: called every frame with the refill per frame; returns the rate to use.
      public static function dashRate(ball:*, rate:Number):Number
      {
         try
         {
            var s:Object = dash[ball];
            if (s == null) { s = { frames: -1, last: 1 }; dash[ball] = s; }
            var v:Number = ball.escapePoint.value;
            if (v <= 0 && s.last > 0) { log("DASH used"); s.frames = 0; }
            if (s.frames >= 0)
            {
               s.frames++;
               if (v + rate >= ball.escapePoint.max) { log("DASH ready after " + s.frames + " frames (refill per frame " + rate + ")"); s.frames = -1; }
            }
            s.last = v;
         }
         catch (e:*) {}
         return rate;
      }
   }
}

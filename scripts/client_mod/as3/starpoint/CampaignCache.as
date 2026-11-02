package starpoint
{
   // StarPoint speed-up for the CN client's campaign lookups (patch_cn_campaign_cache.cjs).
   // CampaignRepository.applyStaminaCampaignFor / applyRewardCampaignFor scan every stamina/reward
   // campaign row and check its dates, once per event banner (the Events screen asks for every banner).
   // Here the rows on at a moment are worked out once per kind per second and reused; only the cheap
   // quest check runs per banner. If anything goes wrong it falls back to the game's own full scan.
   // Game objects are typed * (this compiles without the game's classes; members are looked up by name).
   public class CampaignCache
   {
      // per kind ("stamina", "reward"): { second, rows }. Keyed by kind only: the game hands out a new
      // table wrapper (and a new repository) on every lookup, and the rows depend only on the time.
      public static var cache:Object = {};

      // the rows of `table` whose repeat kind contains `time` (repo.isAppTimeWithinRepeatKind)
      public static function active(repo:*, table:*, time:Number, kind:String):Array
      {
         var second:Number = Math.floor(time / 1000);
         var hit:* = cache[kind];
         if (hit != null && hit.second == second) return hit.rows;
         var rows:Array = [];
         var keys:Array = table.keys();
         for (var i:int = 0; i < keys.length; i++)
         {
            var v:* = table.get(int(keys[i]));
            if (repo.isAppTimeWithinRepeatKind(v.repeat_kind, time)) rows.push(v);
         }
         cache[kind] = { second: second, rows: rows };
         return rows;
      }

      public static function applyStamina(repo:*, table:*, base:*, match:Function, time:Number):void
      {
         var rows:Array;
         try
         {
            rows = active(repo, table, time, "stamina");
         }
         catch (e:*)
         {
            rows = null;
         }
         var i:int;
         var v:*;
         if (rows == null)
         {
            var keys:Array = table.keys();
            for (i = 0; i < keys.length; i++)
            {
               v = table.get(int(keys[i]));
               if (repo.isAppTimeWithinRepeatKind(v.repeat_kind, time) && match(v.quest_kind))
               {
                  base.setStaminaCostRate(v.stamina_consumption_rate);
                  base.extendTimeRange(v.repeat_kind);
               }
            }
            return;
         }
         for (i = 0; i < rows.length; i++)
         {
            v = rows[i];
            if (match(v.quest_kind))
            {
               base.setStaminaCostRate(v.stamina_consumption_rate);
               base.extendTimeRange(v.repeat_kind);
            }
         }
      }

      public static function applyReward(repo:*, table:*, base:*, match:Function, time:Number):void
      {
         var rows:Array;
         try
         {
            rows = active(repo, table, time, "reward");
         }
         catch (e:*)
         {
            rows = null;
         }
         var i:int;
         var v:*;
         if (rows == null)
         {
            var keys:Array = table.keys();
            for (i = 0; i < keys.length; i++)
            {
               v = table.get(int(keys[i]));
               if (repo.isAppTimeWithinRepeatKind(v.repeat_kind, time) && match(v.quest_kind))
               {
                  base.addRewardMultipliers(v.reward_kind);
                  base.extendTimeRange(v.repeat_kind);
               }
            }
            return;
         }
         for (i = 0; i < rows.length; i++)
         {
            v = rows[i];
            if (match(v.quest_kind))
            {
               base.addRewardMultipliers(v.reward_kind);
               base.extendTimeRange(v.repeat_kind);
            }
         }
      }
   }
}

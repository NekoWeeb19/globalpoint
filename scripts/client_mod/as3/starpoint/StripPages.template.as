package starpoint
{
   // StarPoint layout fix for the CN client's summon screen (patch_cn_strip_pages.cjs).
   // The early banners' summon art is a short strip (~624 px high) made for an older screen layout.
   // The game centers picture pages (GachaFeaturePageHolderView.setContent) but puts animation pages at
   // the top, so strip animations sat at the top with an empty gap above the featured units. This moves
   // a strip animation down to the middle of the page area, like a picture. Full-screen animations are
   // left alone. The strip is shown whole (its halftone top edge is part of the art).
   // Game objects are typed * (this compiles without the game's classes).
   public class StripPages
   {
      // animation folder ("gacha/feature_movie/<banner>/<page>") -> its tallest frame; filled in by
      // patch_cn_strip_pages.cjs from scripts/client_mod/strip_pages.json
      public static var strips:Object = /*STRIPS*/{};

      // how far below its own top a strip's middle is, in the page's coordinates
      public static var STRIP_MIDDLE:Number = /*MIDDLE*/330;

      public static function isStrip(path:String):Boolean
      {
         if (path == null) return false;
         var slash:int = path.lastIndexOf("/");
         if (slash > 0 && strips[path.substring(0, slash)] != null) return true;
         for (var dir:String in strips) if (path.indexOf(dir + "/") >= 0) return true;
         return false;
      }

      // called right after the page holder adds an animation page (holder.contentsArea is the page area)
      public static function place(holder:*, anim:*):void
      {
         try
         {
            if (isStrip(anim._path))
            {
               var area:* = holder.contentsArea;
               anim.y = area.top + area.height * 0.5 - STRIP_MIDDLE;
            }
            else anim.y = 0;
         }
         catch (e:*)
         {
         }
      }
   }
}

package starpoint
{
   import flash.display.Sprite;
   import flash.display.Stage;
   import flash.filesystem.File;
   import flash.filesystem.FileMode;
   import flash.filesystem.FileStream;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import flash.text.TextFormatAlign;
   import flash.utils.getDefinitionByName;
   import flash.utils.getTimer;
   import flash.utils.setTimeout;

   // StarPoint drop-off for the CN client's game files (patch_cn_storage_dropoff.cjs).
   // The game keeps its downloads in private storage (Local Store/asset/asset_download/dummy/: info.json
   // + download/...), which nothing else can write without root. At startup AssetExtractor.start (the
   // first loading step, before any downloaded file is read) asks start() here first. If the game's OBB
   // folder or /sdcard/StarPoint/game/ holds files, they are moved into that folder (same relative paths),
   // the drop-off copies deleted, then the game's own start() runs. info.json (the version record that
   // tells the server which updates the game already has) is moved last, and only if every file moved.
   // Moving works in slices of ~50 ms so the screen keeps drawing; a text line shows the count.
   // No folder, no files or no permission: start() returns null and the game starts as normal.
   // Game objects are typed * (this compiles without the game's classes; members are looked up by name).
   public class StorageDropoff
   {
      public static var passing:Boolean = false;

      // the drop-off folders, lowest priority first (a later info.json wins over an earlier one)
      public static function sources():Array
      {
         var out:Array = [];
         var paths:Array = ["/sdcard/Android/obb/com.leiting.wf", "/sdcard/StarPoint/game"];
         for (var i:int = 0; i < paths.length; i++)
         {
            try
            {
               var f:File = new File(paths[i]);
               if (f.exists && f.isDirectory && hasFiles(f, 3)) out.push(f);
            }
            catch (e:*)
            {
            }
         }
         return out;
      }

      // any file within `depth` levels (stops at the first one)
      public static function hasFiles(dir:File, depth:int):Boolean
      {
         var list:Array = dir.getDirectoryListing();
         for (var i:int = 0; i < list.length; i++)
         {
            var f:File = list[i];
            if (!f.isDirectory) return true;
            if (depth > 0 && hasFiles(f, depth - 1)) return true;
         }
         return false;
      }

      public static function target():File
      {
         return File.applicationStorageDirectory.resolvePath("asset/asset_download/dummy");
      }

      // called first thing in AssetExtractor.start; null = run the game's own start
      public static function start(extractor:*):*
      {
         if (passing) return null;
         var found:Array;
         try
         {
            found = sources();
         }
         catch (e:*)
         {
            found = [];
         }
         if (found.length == 0) return null;
         var PM:Class;
         var IM:Class;
         var pm:*;
         try
         {
            PM = getDefinitionByName("pinball.common.task.ProgressManager") as Class;
            IM = getDefinitionByName("haxe.ds.IntMap") as Class;
            var weights:* = new IM();
            weights.h[0] = 1;
            pm = new PM(weights);
         }
         catch (e:*)
         {
            return null;
         }
         new StorageDropoff(extractor, pm, found).begin();
         return pm;
      }

      public var extractor:*;
      public var pm:*;
      public var roots:Array;
      public var dirs:Array = []; // [root, relative dir] still to list
      public var files:Array = []; // [root, relative path, size]
      public var infos:Array = []; // [root, File] of the info.json files
      public var emptyDirs:Array = []; // drop-off folders to remove afterwards (deepest last)
      public var next:int = 0;
      public var moved:int = 0;
      public var failed:int = 0;
      public var bytesTotal:Number = 0;
      public var bytesDone:Number = 0;
      public var started:int = 0;
      public var overlay:Sprite;
      public var label:TextField;

      public function StorageDropoff(extractor:*, pm:*, roots:Array)
      {
         this.extractor = extractor;
         this.pm = pm;
         this.roots = roots;
      }

      public function begin():void
      {
         started = getTimer();
         for (var i:int = 0; i < roots.length; i++) dirs.push([roots[i], ""]);
         showOverlay();
         say("Finding game files…");
         setTimeout(scan, 1);
      }

      // list the drop-off folders, a slice at a time
      public function scan():void
      {
         try
         {
            var until:int = getTimer() + 50;
            while (dirs.length > 0 && getTimer() < until)
            {
               var d:Array = dirs.shift();
               var root:File = d[0];
               var rel:String = d[1];
               var dir:File = rel == "" ? root : root.resolvePath(rel);
               if (rel != "") emptyDirs.push(dir);
               var list:Array = dir.getDirectoryListing();
               for (var i:int = 0; i < list.length; i++)
               {
                  var f:File = list[i];
                  var r:String = (rel == "" ? "" : rel + "/") + f.name;
                  if (f.isDirectory) dirs.push([root, r]);
                  else if (r == "info.json") infos.push([root, f]);
                  else
                  {
                     files.push([root, r, f.size]);
                     bytesTotal += f.size;
                  }
               }
            }
         }
         catch (e:*)
         {
            failed++;
            dirs.length = 0; // a folder could not be read: move what was found, keep info.json back
         }
         if (dirs.length > 0)
         {
            say("Finding game files… " + files.length);
            setTimeout(scan, 1);
            return;
         }
         setTimeout(move, 1);
      }

      // move the files, a slice at a time
      public function move():void
      {
         var dest:File = target();
         var until:int = getTimer() + 50;
         while (next < files.length && getTimer() < until)
         {
            var e:Array = files[next++];
            if (moveOne((e[0] as File).resolvePath(e[1]), dest.resolvePath(e[1]))) moved++;
            else failed++;
            bytesDone += e[2];
         }
         if (next < files.length)
         {
            var gb:Number = 1024 * 1024 * 1024;
            say("Moving game files into the game: " + next + " / " + files.length + " (" + (bytesDone / gb).toFixed(1) + " / " + (bytesTotal / gb).toFixed(1) + " GB)\nKeep the game open.");
            if (bytesTotal > 0) pm.progress(0, 0.99 * bytesDone / bytesTotal);
            setTimeout(move, 1);
            return;
         }
         finish();
      }

      // rename when both sides are on one volume, else copy + delete
      public static function moveOne(src:File, dst:File):Boolean
      {
         try
         {
            dst.parent.createDirectory();
            try
            {
               src.moveTo(dst, true);
               return true;
            }
            catch (e:*)
            {
            }
            src.copyTo(dst, true);
            try
            {
               src.deleteFile();
            }
            catch (e2:*)
            {
            }
            return true;
         }
         catch (e3:*)
         {
         }
         return false;
      }

      public static function readVersion(f:File):String
      {
         try
         {
            var s:FileStream = new FileStream();
            s.open(f, FileMode.READ);
            var text:String = s.readUTFBytes(s.bytesAvailable);
            s.close();
            var v:* = JSON.parse(text).version;
            return v == null ? null : String(v);
         }
         catch (e:*)
         {
         }
         return null;
      }

      // < 0 when a is older than b
      public static function compareVersions(a:String, b:String):int
      {
         var pa:Array = a.split(".");
         var pb:Array = b.split(".");
         for (var i:int = 0; i < Math.max(pa.length, pb.length); i++)
         {
            var d:Number = (i < pa.length ? Number(pa[i]) : 0) - (i < pb.length ? Number(pb[i]) : 0);
            if (d != 0) return d < 0 ? -1 : 1;
         }
         return 0;
      }

      public function finish():void
      {
         var dest:File = target();
         var infoMoved:Boolean = false;
         if (failed == 0)
         {
            for (var i:int = 0; i < infos.length; i++)
            {
               var src:File = infos[i][1];
               var have:File = dest.resolvePath("info.json");
               var vNew:String = readVersion(src);
               var vOld:String = have.exists ? readVersion(have) : null;
               if (vNew != null && vOld != null && compareVersions(vNew, vOld) < 0)
               {
                  // the game already has newer files: keep its record, drop the old one
                  try { src.deleteFile(); } catch (e:*) { }
                  continue;
               }
               if (moveOne(src, have))
               {
                  infoMoved = true;
                  moved++;
               }
            }
            if (infoMoved)
            {
               // a finished set replaces any half-done download
               var partial:Array = ["partial_downloaded.json", "partial_downloaded.platform", "partial_downloaded_android_thread.json"];
               for (var p:int = 0; p < partial.length; p++)
               {
                  try
                  {
                     var pf:File = dest.resolvePath(partial[p]);
                     if (pf.exists) pf.deleteFile();
                  }
                  catch (e4:*)
                  {
                  }
               }
            }
         }
         // remove the emptied drop-off folders, deepest first (the drop-off roots stay)
         for (var k:int = emptyDirs.length - 1; k >= 0; k--)
         {
            try
            {
               var d:File = emptyDirs[k];
               if (d.exists && d.getDirectoryListing().length == 0) d.deleteDirectory(false);
            }
            catch (e5:*)
            {
            }
         }
         var secs:Number = (getTimer() - started) / 1000;
         trace("[StorageDropoff] moved " + moved + " files, " + failed + " failed, info.json " + (infoMoved ? "moved" : "kept") + ", " + secs.toFixed(1) + " s");
         if (failed > 0)
         {
            say(failed + " game files could not be moved; they stay in the drop-off folder and are retried next start.");
            setTimeout(hideOverlay, 6000);
         }
         else hideOverlay();
         // now the game's own start (bundle.zip check), then hand its end on to the loading screen
         var inner:*;
         passing = true;
         try
         {
            inner = extractor.start();
         }
         finally
         {
            passing = false;
         }
         var self:StorageDropoff = this;
         if (inner == null || inner.get_completed()) pm.complete(0);
         else inner.waitCompleteImpl.addCompleteHandler(function():void
         {
            self.pm.complete(0);
         });
      }

      public static function stage():Stage
      {
         try
         {
            var lib:* = getDefinitionByName("flash.Lib");
            return lib.current.stage;
         }
         catch (e:*)
         {
         }
         return null;
      }

      public function showOverlay():void
      {
         try
         {
            var st:Stage = stage();
            if (st == null) return;
            var w:Number = st.stageWidth;
            var h:Number = st.stageHeight;
            overlay = new Sprite();
            overlay.mouseEnabled = false;
            overlay.mouseChildren = false;
            var size:int = Math.max(14, Math.round(w / 28));
            overlay.graphics.beginFill(0x000000, 0.75);
            overlay.graphics.drawRect(0, h * 0.42, w, size * 4);
            overlay.graphics.endFill();
            label = new TextField();
            label.defaultTextFormat = new TextFormat("_sans", size, 0xFFFFFF, false, null, null, null, null, TextFormatAlign.CENTER);
            label.multiline = true;
            label.wordWrap = true;
            label.selectable = false;
            label.x = size / 2;
            label.y = h * 0.42 + size / 2;
            label.width = w - size;
            label.height = size * 3;
            overlay.addChild(label);
            st.addChild(overlay);
         }
         catch (e:*)
         {
            overlay = null;
         }
      }

      public function say(text:String):void
      {
         try
         {
            if (label != null)
            {
               label.text = text;
               if (overlay.parent != null) overlay.parent.setChildIndex(overlay, overlay.parent.numChildren - 1);
            }
         }
         catch (e:*)
         {
         }
      }

      public function hideOverlay():void
      {
         try
         {
            if (overlay != null && overlay.parent != null) overlay.parent.removeChild(overlay);
         }
         catch (e:*)
         {
         }
         overlay = null;
         label = null;
      }
   }
}

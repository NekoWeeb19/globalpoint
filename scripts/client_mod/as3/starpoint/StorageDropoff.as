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
   import flash.utils.ByteArray;
   import flash.utils.Endian;
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
   // OBB: a .obb file in either folder (scripts/build_cn_obb.cjs: a stored zip whose first entry,
   // starpoint-obb-index.txt, lists every entry's offsets) is unpacked first, from the END of the file
   // backwards, cutting the file shorter after each slice: the space it frees takes the unpacked files,
   // so no second 10 GB is needed, and an interrupted unpack carries on from where the file now ends.
   // Its info.json (second entry, so unpacked last) follows the same rules; the emptied file is deleted.
   // The game's own OBB folder needs no permission on any Android version.
   // Game objects are typed * (this compiles without the game's classes; members are looked up by name).
   public class StorageDropoff
   {
      public static var passing:Boolean = false;
      public static const DROP_PATHS:Array = ["/sdcard/Android/obb/com.leiting.wf", "/sdcard/StarPoint/game"];
      public static const INDEX_NAME:String = "starpoint-obb-index.txt";

      public static function isObb(f:File):Boolean
      {
         return !f.isDirectory && f.name.toLowerCase().substr(-4) == ".obb";
      }

      // files in the drop-off folders that are not game files: OBBs (unpacked separately) and
      // server.txt (ServerAddress.as reads it from the OBB folder; it stays where it is)
      public static function isIgnored(f:File):Boolean
      {
         return isObb(f) || (!f.isDirectory && f.name.toLowerCase() == "server.txt");
      }

      // the .obb files at the top of the drop-off folders
      public static function obbFiles():Array
      {
         var out:Array = [];
         for (var i:int = 0; i < DROP_PATHS.length; i++)
         {
            try
            {
               var d:File = new File(DROP_PATHS[i]);
               if (!d.exists || !d.isDirectory) continue;
               var list:Array = d.getDirectoryListing();
               for (var j:int = 0; j < list.length; j++) if (isObb(list[j])) out.push(list[j]);
            }
            catch (e:*)
            {
            }
         }
         return out;
      }

      // the drop-off folders, lowest priority first (a later info.json wins over an earlier one)
      public static function sources():Array
      {
         var out:Array = [];
         var paths:Array = DROP_PATHS;
         for (var i:int = 0; i < paths.length; i++)
         {
            try
            {
               var f:File = new File(paths[i]);
               // game files sit 5 folders down (download/production/upload/xx/<hash>)
               if (f.exists && f.isDirectory && hasFiles(f, 8)) out.push(f);
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
            if (isIgnored(f)) continue;
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
         var obbs:Array;
         try
         {
            found = sources();
         }
         catch (e:*)
         {
            found = [];
         }
         try
         {
            obbs = obbFiles();
         }
         catch (e0:*)
         {
            obbs = [];
         }
         if (found.length == 0 && obbs.length == 0) return null;
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
         var job:StorageDropoff = new StorageDropoff(extractor, pm, found);
         job.obbQueue = obbs;
         job.begin();
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
      public var obbQueue:Array = [];
      public var obbInfos:Array = []; // [obb File, data offset, size] of each OBB's info.json
      public var obbDone:Array = []; // OBB files fully unpacked (deleted once their info.json is handled)
      // the OBB being unpacked
      public var obb:File;
      public var stream:FileStream;
      public var hdr:Array;
      public var dat:Array;
      public var len:Array;
      public var paths:Array;
      public var k:int;
      public var infoAt:int;
      public var obbCount:int;
      public var obbNext:int;
      public var obbBytesTotal:Number;
      public var obbBytesDone:Number;
      public var buf:ByteArray = new ByteArray();
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
         showOverlay();
         nextObb();
      }

      // the OBBs one after another, then the loose files
      public function nextObb():void
      {
         if (obbQueue.length > 0)
         {
            openObb(obbQueue.shift());
            return;
         }
         if (roots.length == 0)
         {
            finish();
            return;
         }
         for (var i:int = 0; i < roots.length; i++) dirs.push([roots[i], ""]);
         say("Finding game files…");
         setTimeout(scan, 1);
      }

      // reads the OBB's index (first zip entry); entries past the file's current end are already unpacked
      public function openObb(f:File):void
      {
         obb = f;
         stream = null;
         try
         {
            say("Reading " + f.name + "…");
            var s:FileStream = new FileStream();
            s.endian = Endian.LITTLE_ENDIAN;
            s.open(f, FileMode.UPDATE); // it must be possible to cut it shorter
            stream = s;
            var fileLen:Number = new File(f.nativePath).size;
            s.position = 0;
            if (s.readUnsignedInt() != 0x04034b50) throw new Error("not a zip");
            s.position = 18;
            var indexLen:uint = s.readUnsignedInt();
            s.position = 26;
            var nameLen:int = s.readUnsignedShort();
            var extraLen:int = s.readUnsignedShort();
            if (s.readUTFBytes(nameLen) != INDEX_NAME) throw new Error("not a StarPoint OBB");
            s.position = 30 + nameLen + extraLen;
            var lines:Array = s.readUTFBytes(indexLen).split("\n");
            var head:Array = String(lines[0]).split(" ");
            if (head[0] != "STARPOINT-OBB" || head[1] != "1") throw new Error("unknown OBB version");
            hdr = [];
            dat = [];
            len = [];
            paths = [];
            infoAt = -1;
            for (var i:int = 1; i < lines.length; i++)
            {
               var line:String = lines[i];
               if (line.length < 40) continue;
               hdr.push(Number(line.substr(0, 12)));
               dat.push(Number(line.substr(13, 12)));
               len.push(Number(line.substr(26, 12)));
               paths.push(line.substr(39));
               if (line.substr(39) == "info.json") infoAt = hdr.length - 1;
            }
            if (hdr.length != int(head[2])) throw new Error("index is cut short");
            // what is still in the file (entries are in offset order)
            k = hdr.length - 1;
            while (k >= 0 && hdr[k] >= fileLen) k--;
            if (k >= 0 && dat[k] + len[k] > fileLen) throw new Error("file ends inside " + paths[k]);
            obbCount = 0;
            obbBytesTotal = 0;
            for (var j:int = 0; j <= k; j++)
            {
               if (j == infoAt) continue;
               obbCount++;
               obbBytesTotal += len[j];
            }
            obbNext = 0;
            obbBytesDone = 0;
            trace("[StorageDropoff] " + f.nativePath + ": " + hdr.length + " entries, " + obbCount + " to unpack");
         }
         catch (e:*)
         {
            // not ours, unreadable or not writable: leave it alone
            trace("[StorageDropoff] skipping " + f.nativePath + ": " + e);
            closeObb();
            setTimeout(nextObb, 1);
            return;
         }
         setTimeout(unpack, 1);
      }

      public function closeObb():void
      {
         try
         {
            if (stream != null) stream.close();
         }
         catch (e:*)
         {
         }
         stream = null;
      }

      // unpack from the end backwards, a slice at a time, then cut the file at the lowest unpacked entry
      public function unpack():void
      {
         var dest:File = target();
         var until:int = getTimer() + 50;
         var cutAt:Number = -1;
         var stop:String = null;
         while (k >= 0 && getTimer() < until)
         {
            if (k == infoAt)
            {
               k--;
               continue;
            }
            var err:String = unpackOne(dest.resolvePath(paths[k]), dat[k], len[k]);
            if (err != null)
            {
               stop = err;
               break;
            }
            cutAt = hdr[k];
            obbNext++;
            obbBytesDone += len[k];
            k--;
         }
         if (cutAt >= 0)
         {
            try
            {
               stream.position = cutAt;
               stream.truncate();
            }
            catch (e:*)
            {
               stop = "could not shorten " + obb.name + ": " + e;
            }
         }
         if (stop != null)
         {
            closeObb();
            failed++;
            trace("[StorageDropoff] " + obb.nativePath + ": " + stop);
            if (stop == "space")
            {
               // stay on this screen: going on would start the 10 GB download instead
               var gb:Number = 1024 * 1024 * 1024;
               var free:Number = 0;
               try
               {
                  free = dest.spaceAvailable;
               }
               catch (e2:*)
               {
               }
               say("Phone storage is full: " + ((obbBytesTotal - obbBytesDone) / gb).toFixed(1) + " GB still to unpack, " + (free / gb).toFixed(1) + " GB free.\nFree some space, then close and reopen the game. It carries on where it stopped.");
               return;
            }
            setTimeout(nextObb, 1);
            return;
         }
         if (k >= 0 && !(k == 0 && infoAt == 0))
         {
            var g:Number = 1024 * 1024 * 1024;
            say("Unpacking game files: " + obbNext + " / " + obbCount + "\n" + (obbBytesDone / g).toFixed(1) + " / " + (obbBytesTotal / g).toFixed(1) + " GB. Keep the game open.");
            if (obbBytesTotal > 0) pm.progress(0, 0.99 * obbBytesDone / obbBytesTotal);
            setTimeout(unpack, 1);
            return;
         }
         closeObb();
         if (infoAt >= 0) obbInfos.push([obb, dat[infoAt], len[infoAt]]);
         obbDone.push(obb);
         trace("[StorageDropoff] " + obb.nativePath + ": unpacked " + obbNext + " files, " + ((getTimer() - started) / 1000).toFixed(1) + " s");
         setTimeout(nextObb, 1);
      }

      // copies one stored entry out of the OBB; null = done, "space" = storage full, else the error
      public function unpackOne(dst:File, from:Number, size:Number):String
      {
         var out:FileStream = null;
         try
         {
            dst.parent.createDirectory();
            out = new FileStream();
            out.open(dst, FileMode.WRITE);
            var off:Number = 0;
            while (off < size)
            {
               var n:uint = uint(Math.min(1048576, size - off));
               stream.position = from + off;
               buf.length = 0;
               stream.readBytes(buf, 0, n);
               out.writeBytes(buf, 0, n);
               off += n;
            }
            out.close();
            return null;
         }
         catch (e:*)
         {
            try
            {
               if (out != null) out.close();
            }
            catch (e2:*)
            {
            }
            try
            {
               if (dst.exists) dst.deleteFile();
            }
            catch (e3:*)
            {
            }
            try
            {
               if (target().spaceAvailable < size + 16 * 1048576) return "space";
            }
            catch (e4:*)
            {
            }
            return dst.nativePath + ": " + e;
         }
         return null;
      }

      public static function readObbInfo(o:Array):ByteArray
      {
         var s:FileStream = new FileStream();
         s.open(o[0], FileMode.READ);
         s.position = o[1];
         var b:ByteArray = new ByteArray();
         s.readBytes(b, 0, o[2]);
         s.close();
         return b;
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
                  if (isIgnored(f)) continue;
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
            say("Moving game files: " + next + " / " + files.length + "\n" + (bytesDone / gb).toFixed(1) + " / " + (bytesTotal / gb).toFixed(1) + " GB. Keep the game open.");
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
            var keepObbs:Boolean = false;
            // the OBBs' info.json first (lower priority than loose files), then the emptied OBBs go
            for (var o:int = 0; o < obbInfos.length; o++)
            {
               try
               {
                  var bytes:ByteArray = readObbInfo(obbInfos[o]);
                  var have0:File = dest.resolvePath("info.json");
                  bytes.position = 0;
                  var v:* = JSON.parse(bytes.readUTFBytes(bytes.length)).version;
                  var vHave:String = have0.exists ? readVersion(have0) : null;
                  if (v == null || vHave == null || compareVersions(String(v), vHave) >= 0)
                  {
                     var w:FileStream = new FileStream();
                     w.open(have0, FileMode.WRITE);
                     w.writeBytes(bytes, 0, bytes.length);
                     w.close();
                     infoMoved = true;
                     moved++;
                  }
               }
               catch (e6:*)
               {
                  trace("[StorageDropoff] info.json from " + obbInfos[o][0].nativePath + ": " + e6);
                  keepObbs = true;
               }
            }
            if (!keepObbs) for (var q:int = 0; q < obbDone.length; q++)
            {
               try
               {
                  (obbDone[q] as File).deleteFile();
               }
               catch (e7:*)
               {
               }
            }
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
            overlay.graphics.drawRect(0, h * 0.42, w, size * 5);
            overlay.graphics.endFill();
            label = new TextField();
            label.defaultTextFormat = new TextFormat("_sans", size, 0xFFFFFF, false, null, null, null, null, TextFormatAlign.CENTER);
            label.multiline = true;
            label.wordWrap = true;
            label.selectable = false;
            label.x = size / 2;
            label.y = h * 0.42 + size / 2;
            label.width = w - size;
            label.height = size * 4;
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

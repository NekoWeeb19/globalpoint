Read-only tools for checking the global game client's own message definitions (its Haxe enums),
used to get the co-op protocol right (src/coop/tcp.ts).

The game's code is assets/worldflipper_android_release.swf inside the APK (unzip the APK first).

  node scripts/client_swf/maps.cjs <swf> Welcome SceneReady   -> the decoder's name=number tables
                                                                (TypePackerResource2.resolveMap*)
                                                                that contain those names
  node scripts/client_swf/enums.cjs <swf> "^Meeting"          -> enums with their constructors' values
  node scripts/client_swf/abc.cjs <swf> "Meeting"             -> classes, fields and method signatures

maps.cjs is the reliable one for message numbers; enums.cjs can't number constructors without values.

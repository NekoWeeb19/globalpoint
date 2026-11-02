const zlib=require("zlib"),crypto=require("crypto"),unz=require("F:/starpoint-main/node_modules/unzipper");const {readAmf3}=require("F:/starpoint-main/scripts/client_mod/amf3.cjs");const {cnZips}=require("F:/starpoint-main/scripts/cn_archives.cjs");const L=require("./redraw_lib.cjs");
const SALT="K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy";const s=l=>{const x=crypto.createHash("sha1").update(l+SALT).digest("hex");return x.slice(0,2)+"/"+x.slice(2)};
(async()=>{const ka=s("scene/general/sprite_sheet.atlas.amf3.deflate");let a;for(const z of cnZips())for(const e of (await unz.Open.file(z)).files)if(e.path.endsWith(ka))a=await e.buffer();
const f=readAmf3(zlib.inflateRawSync(a)).find(x=>x.n.endsWith("sprite_sheet/ege_warning"));console.log(JSON.stringify(f));
const img=L.load(__dirname+"/general_new2.png");const W=f.r?f.h:f.w,H=f.r?f.w:f.h;for(let y=0;y<H;y++)img.px.fill(0,((f.y+y)*img.w+f.x)*4,((f.y+y)*img.w+f.x+W)*4);L.save(img,__dirname+"/general_new4.png");console.log("cleared",W,H)})()

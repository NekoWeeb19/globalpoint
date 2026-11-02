const zlib=require("zlib"),fs=require("fs"),unz=require("F:/starpoint-main/node_modules/unzipper"),crypto=require("crypto");
const {readAmf3}=require("F:/starpoint-main/scripts/client_mod/amf3.cjs");const {cnZips}=require("F:/starpoint-main/scripts/cn_archives.cjs");const L=require("./redraw_lib.cjs");
const SALT="K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy";const s=l=>{const x=crypto.createHash("sha1").update(l+SALT).digest("hex");return x.slice(0,2)+"/"+x.slice(2)};
(async()=>{const SP=__dirname;const P=require("F:/starpoint-main/.cdn/cn_patches/patches.json");const v=P.find(p=>p.version==="1.4.125");const z=await unz.Open.file("F:/starpoint-main/.cdn/cn_patches/"+v.archives[0].file);
const kp=s("scene/general/sprite_sheet.png"),ka=s("scene/general/sprite_sheet.atlas.amf3.deflate");const pe=z.files.find(e=>e.path.endsWith(kp));fs.writeFileSync(SP+"/general.png.game",await pe.buffer());
let a;for(const zz of cnZips())for(const e of (await unz.Open.file(zz)).files)if(e.path.endsWith(ka))a=await e.buffer();
const img=L.load(SP+"/general.png.game");const f=readAmf3(zlib.inflateRawSync(a)).find(x=>x.n==="scene/general/sprite_sheet/vector_icon-assets/playing");console.log(JSON.stringify(f),img.w,img.h);
// stored rotated: crop (w x h), display = rotate CCW
const W=f.w,H=f.h;const crop={w:W,h:H,px:Buffer.alloc(W*H*4)};for(let y=0;y<H;y++)img.px.copy(crop.px,y*W*4,((f.y+y)*img.w+f.x)*4,((f.y+y)*img.w+f.x+W)*4);
const rot=(src,cw)=>{const o={w:src.h,h:src.w,px:Buffer.alloc(src.w*src.h*4)};for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){const [X,Y]=cw?[src.h-1-y,x]:[y,src.w-1-x];src.px.copy(o.px,(Y*o.w+X)*4,(y*src.w+x)*4,(y*src.w+x)*4+4)}return o};
const disp=f.r?rot(crop,false):crop;L.save(disp,SP+"/badge_before.png");
const box=L.textBox(disp,[6,4,disp.w-12,disp.h-8],235,2);console.log("box",box);L.erase(box,disp);const t=L.fit("Now Playing","SemiBold",disp.w-24,(box[3]-box[1])*0.62);L.paste(disp,t,disp.w/2,(box[1]+box[3])/2);L.save(disp,SP+"/badge_after.png");
const back=f.r?rot(disp,true):disp;for(let y=0;y<H;y++)back.px.copy(img.px,((f.y+y)*img.w+f.x)*4,y*W*4,(y+1)*W*4);L.save(img,SP+"/general_new.png");console.log("ok",pe.path)})()

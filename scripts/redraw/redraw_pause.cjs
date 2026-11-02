const zlib=require("zlib"),fs=require("fs"),unz=require("F:/starpoint-main/node_modules/unzipper");const {readAmf3}=require("F:/starpoint-main/scripts/client_mod/amf3.cjs");const {cnZips}=require("F:/starpoint-main/scripts/cn_archives.cjs");const L=require("./redraw_lib.cjs");
(async()=>{const SP=__dirname;let a;for(const z of cnZips())for(const e of (await unz.Open.file(z)).files)if(e.path.endsWith("19/722166c96272eb26217732327db9130a8c4dc5"))a=await e.buffer();
const bz=await unz.Open.buffer(fs.readFileSync(SP+"/bundle16.zip"));const pe=bz.files.find(e=>e.path.endsWith("82/328225a589e4b85e0bbdc84e9046a573697f2c"));console.log("bundle path",pe.path);const pb=await pe.buffer();pb.write("PNG",1,"latin1");fs.writeFileSync(SP+"/battle_layer1.png",pb);
const img=L.load(SP+"/battle_layer1.png");const frames=readAmf3(zlib.inflateRawSync(a)).filter(x=>/\/(new_)?hud_pause_button\/b$/.test(x.n));
const rot=(src,cw)=>{const o={w:src.h,h:src.w,px:Buffer.alloc(src.w*src.h*4)};for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){const [X,Y]=cw?[src.h-1-y,x]:[y,src.w-1-x];src.px.copy(o.px,(Y*o.w+X)*4,(y*src.w+x)*4,(y*src.w+x)*4+4)}return o};
for(const f of frames){const crop={w:f.w,h:f.h,px:Buffer.alloc(f.w*f.h*4)};for(let y=0;y<f.h;y++)img.px.copy(crop.px,y*f.w*4,((f.y+y)*img.w+f.x)*4,((f.y+y)*img.w+f.x+f.w)*4);
 const d=f.r?rot(crop,false):crop;L.save(d,SP+"/pb_disp_"+(f.n.includes("new_")?"new":"old")+".png");
 // dark text pixels in lower part
 let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=Math.floor(d.h*0.55);y<d.h-8;y++)for(let x=8;x<d.w-8;x++){const i=(y*d.w+x)*4;if(d.px[i+3]>200&&d.px[i]<120){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}
 console.log(f.n,f.r,d.w,d.h,"text",x0,y0,x1,y1);const bg=[...d.px.slice((y0*d.w+x0-3)*4,(y0*d.w+x0-3)*4+4)];
 for(let y=y0-2;y<=y1+2;y++)for(let x=x0-2;x<=x1+2;x++){const i=(y*d.w+x)*4;for(let k=0;k<4;k++)d.px[i+k]=bg[k]}
 const t=L.textImg("End",(y1-y0)*1.05,"SemiBold");for(let i=0;i<t.px.length;i+=4){const al=t.px[i+3];t.px[i]=t.px[i+1]=t.px[i+2]=68;t.px[i+3]=al}
 L.paste(d,t,(x0+x1)/2,(y0+y1)/2);L.save(d,SP+"/pb_new_"+(f.n.includes("new_")?"new":"old")+".png");
 const back=f.r?rot(d,true):d;for(let y=0;y<f.h;y++)back.px.copy(img.px,((f.y+y)*img.w+f.x)*4,y*f.w*4,(y+1)*f.w*4)}
L.save(img,SP+"/battle_layer1_new.png")})()

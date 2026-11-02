const zlib=require("zlib"),fs=require("fs"),unz=require("F:/starpoint-main/node_modules/unzipper");const {readAmf3}=require("F:/starpoint-main/scripts/client_mod/amf3.cjs");const L=require("./redraw_lib.cjs");
(async()=>{const SP=__dirname;const z=await unz.Open.buffer(fs.readFileSync(SP+"/bundle15.zip"));const atlas=readAmf3(zlib.inflateRawSync(await z.files.find(e=>e.path.endsWith("1d/e643f37b652794339c07f4101f9e47405a80a3")).buffer()));
const pb=await z.files.find(e=>e.path.endsWith("92/8b9a8d8563727935e6509882936fb24e618069")).buffer();pb.write("PNG",1,"latin1");fs.writeFileSync(SP+"/small_sheet.png",pb);const img=L.load(SP+"/small_sheet.png");
const f=atlas.find(x=>x.n.endsWith("bitmap_text-assets/menu"));for(let y=0;y<f.h;y++)img.px.fill(0,((f.y+y)*img.w+f.x)*4,((f.y+y)*img.w+f.x+f.w)*4);
const t0=L.fit("Menu","Regular",f.w-8,f.h*0.55);const r=0,W=t0.w+2*r,H=t0.h+2*r,o2={w:W,h:H,px:Buffer.alloc(W*H*4)};
for(let y=0;y<H;y++)for(let x=0;x<W;x++){let a=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(dx*dx+dy*dy>r*r+1)continue;const X=x-r+dx,Y=y-r+dy;if(X>=0&&Y>=0&&X<t0.w&&Y<t0.h)a=Math.max(a,t0.px[(Y*t0.w+X)*4+3])}const i=(y*W+x)*4;o2.px[i]=o2.px[i+1]=o2.px[i+2]=255;o2.px[i+3]=a}
for(let y=0;y<t0.h;y++)for(let x=0;x<t0.w;x++){const s2=(y*t0.w+x)*4,d=((y+r)*W+x+r)*4,a=t0.px[s2+3]/255;for(let k=0;k<3;k++)o2.px[d+k]=Math.round(68*a+o2.px[d+k]*(1-a))}
L.paste(img,o2,f.x+f.w/2,f.y+f.h/2);L.save(img,SP+"/small_sheet_new.png");
const o={w:f.w*4,h:f.h*4,px:Buffer.alloc(f.w*f.h*64)};for(let y=0;y<o.h;y++)for(let x=0;x<o.w;x++){const si=((f.y+Math.floor(y/4))*img.w+f.x+Math.floor(x/4))*4,d=(y*o.w+x)*4,al=img.px[si+3]/255;for(let k=0;k<3;k++)o.px[d+k]=Math.round(img.px[si+k]*al+200*(1-al));o.px[d+3]=255}L.save(o,SP+"/menu_check3.png");console.log(JSON.stringify(f))})()

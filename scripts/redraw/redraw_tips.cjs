const zlib=require("zlib"),fs=require("fs");const L=require("./redraw_lib.cjs");const SP=__dirname;
const sheet=L.load(SP+"/title/ext_sheet.png");
// text with a dark outline (alpha dilated by r)
function outlined(text,size,weight,r=2){const t=L.textImg(text,size,weight);const W=t.w+2*r,H=t.h+2*r,px=Buffer.alloc(W*H*4);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){let a=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(dx*dx+dy*dy>r*r+1)continue;const X=x-r+dx,Y=y-r+dy;if(X>=0&&Y>=0&&X<t.w&&Y<t.h)a=Math.max(a,t.px[(Y*t.w+X)*4+3])}const i=(y*W+x)*4;px[i]=px[i+1]=px[i+2]=55;px[i+3]=a}
 const o={w:W,h:H,px};// text on top
 for(let y=0;y<t.h;y++)for(let x=0;x<t.w;x++){const s=(y*t.w+x)*4,d=((y+r)*W+x+r)*4,a=t.px[s+3]/255;for(let k=0;k<3;k++)o.px[d+k]=Math.round(255*a+o.px[d+k]*(1-a));o.px[d+3]=Math.max(o.px[d+3],t.px[s+3])}return o}
function blit(t,x,y){for(let j=0;j<t.h;j++)for(let i=0;i<t.w;i++){const X=Math.round(x)+i,Y=Math.round(y)+j;if(X<0||Y<0||X>=sheet.w||Y>=sheet.h)continue;const s=(j*t.w+i)*4,d=(Y*sheet.w+X)*4,a=t.px[s+3]/255;for(let k=0;k<3;k++)sheet.px[d+k]=Math.round(t.px[s+k]*a+sheet.px[d+k]*(1-a));sheet.px[d+3]=Math.max(sheet.px[d+3],t.px[s+3])}}
function clear(x,y,w,h){for(let j=0;j<h;j++)sheet.px.fill(0,((y+j)*sheet.w+x)*4,((y+j)*sheet.w+x+w)*4)}
// shrink a size until every line fits maxW
function sizeFor(lines,size,weight,maxW){for(;;){const w=Math.max(...lines.map(l=>outlined(l,size,weight,0).w));if(w<=maxW||size<8)return size;size-=0.5}}
// CNtips_a: 660x96 at (2,2)
clear(0,0,sheet.w,101);
const a=["[ Healthy Gaming Advisory ]","Say no to harmful and pirated games. Protect yourself from scams.","Play in moderation, as addiction harms health. Plan your time well."];
let sz=sizeFor(a.slice(1),20,"SemiBold",650);const rows=[outlined(a[0],22,"Bold",2),outlined(a[1],sz,"SemiBold",1),outlined(a[2],sz,"SemiBold",1)];
let y=2+3;const gap=(96-6-rows.reduce((s,r)=>s+r.h,0))/2;for(const r of rows){blit(r,2+330-r.w/2,y);y+=r.h+gap}
// CNtips_b: 659x76 at (2,102); two columns of three
clear(2,102,659,76);
const left=["Copyright: Cygames, Inc.","Approval No.: NPPA [2021] 1196","Copyright Reg. No.: 2021SR0753907"];
const right=["Operator: Shenzhen Leiting Info Tech Co., Ltd.","Publisher: Xiamen Leiting Interactive Co., Ltd.","Publication No.: ISBN 978-7-498-09293-9"];
const s2=Math.min(sizeFor(left,17,"SemiBold",265),sizeFor(right,17,"SemiBold",380));
for(let i=0;i<3;i++){const l=outlined(left[i],s2,"SemiBold",1),r=outlined(right[i],s2,"SemiBold",1);const yy=102+2+i*25;blit(l,4,yy);blit(r,2+659-r.w-2,yy)}
L.save(sheet,SP+"/title/ext_sheet_new.png");console.log("sizes",sz,s2)

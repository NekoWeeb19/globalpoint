const L=require("./redraw_lib.cjs");const SP=__dirname;
// every thumbnail has the same band: "专辑 NN" sits in x 66..172, y 153..186 (from thumbnail 1)
const BOX=[66,153,172,186];
for(let n=1;n<=17;n++){const img=L.load(SP+"/bgm/thumbnail_"+n+".png");L.erase(BOX,img);const t=L.fit("Album "+String(n).padStart(2,"0"),"Regular",img.w-30,(184-156-6)*0.78);L.paste(img,t,img.w/2,(BOX[1]+BOX[3])/2);L.save(img,SP+"/bgm/new_thumbnail_"+n+".png")}
console.log("ok")

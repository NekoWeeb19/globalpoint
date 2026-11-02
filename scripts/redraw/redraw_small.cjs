const L=require("./redraw_lib.cjs");const SP=__dirname;
// thumbnails: "专辑 NN" in the bottom band -> "Album NN"
for(let n=1;n<=17;n++){const img=L.load(SP+"/bgm/thumbnail_"+n+".png");const box=L.textBox(img,[20,Math.floor(img.h*0.72),img.w-40,Math.floor(img.h*0.27)],215,3);if(!box){console.log("thumb",n,"none");continue}
 L.erase(box,img);const t=L.fit("Album "+String(n).padStart(2,"0"),"Regular",img.w-30,(box[3]-box[1]-6)*0.78);L.paste(img,t,img.w/2,(box[1]+box[3])/2);L.save(img,SP+"/bgm/new_thumbnail_"+n+".png");if(n<3)console.log("thumb",n,box.join(","),img.w+"x"+img.h)}
for(const [f,text] of [["play_buttom","Play"],["stop_buttom","Playing"]]){const img=L.load(SP+"/bgm/"+f+".png");const box=L.textBox(img,[10,20,img.w-30,img.h-40],235,4);L.erase(box,img);const t=L.fit(text,"SemiBold",img.w-36,(box[3]-box[1]-8)*0.8);L.paste(img,t,(box[0]+box[2])/2,(box[1]+box[3])/2);L.save(img,SP+"/bgm/new_"+f+".png");console.log(f,box.join(","),img.w+"x"+img.h)}

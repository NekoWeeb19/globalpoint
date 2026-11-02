const L=require("./redraw_lib.cjs");const SP=__dirname;
const titles={1:"System Music",2:"Garden of the Sprites",3:"Kingdom of Sand",4:"Endless Blue",5:"Fang Canyon",6:"Android Planet",7:"Yamato",8:"The Wastelands",9:"Realm of Ruin",10:"The Shifting City",11:"Origin's End",12:"Character Theme - Christmas",13:"Character Theme - New Year",14:"Character Theme - Anniversary",15:"Character Theme - Summer",16:"Character Theme - Halloween",17:"Other"};
const only=process.argv[2]?process.argv[2].split(",").map(Number):Object.keys(titles).map(Number);
for(const n of only){const img=L.load(SP+"/bgm/banner_"+n+".png");const box=L.textBox(img,[200,170,1040,130],238,6);if(!box){console.log(n,"no text found");continue}
 L.erase(box,img);const h=box[3]-box[1]-12;const t=L.fit(titles[n],"Bold",1180,h*0.82);L.shadow(img,t,img.w/2,(box[1]+box[3])/2);L.paste(img,t,img.w/2,(box[1]+box[3])/2);L.save(img,SP+"/bgm/new_banner_"+n+".png");console.log(n,box.join(","),t.w+"x"+t.h)}

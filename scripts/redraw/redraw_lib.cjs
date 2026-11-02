const zlib=require("zlib");
function decodePng(b) {
    let p = 8, w, h, bd, ct, il, plte, trns
    const idat = []
    while (p < b.length) {
        const len = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len)
        if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12] }
        else if (t === "IDAT") idat.push(d)
        else if (t === "PLTE") plte = d
        else if (t === "tRNS") trns = d
        else if (t === "IEND") break
        p += 12 + len
    }
    if (bd !== 8 || il) throw new Error(`PNG not supported (bit depth ${bd}, interlace ${il})`)
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]
    const raw = zlib.inflateSync(Buffer.concat(idat))
    const st = w * ch, out = Buffer.alloc(w * h * 4)
    let prev = Buffer.alloc(st)
    for (let y = 0; y < h; y++) {
        const f = raw[y * (st + 1)], line = Buffer.from(raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)))
        for (let x = 0; x < st; x++) {
            const a = x >= ch ? line[x - ch] : 0, u = prev[x], c = x >= ch ? prev[x - ch] : 0
            let v = line[x]
            if (f === 1) v += a
            else if (f === 2) v += u
            else if (f === 3) v += (a + u) >> 1
            else if (f === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c) }
            line[x] = v & 255
        }
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4
            if (ct === 6) line.copy(out, o, x * 4, x * 4 + 4)
            else if (ct === 2) { out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255 }
            else if (ct === 3) { const i = line[x]; out[o] = plte[i * 3]; out[o + 1] = plte[i * 3 + 1]; out[o + 2] = plte[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255 }
            else if (ct === 0) { out[o] = out[o + 1] = out[o + 2] = line[x]; out[o + 3] = 255 }
            else { out[o] = out[o + 1] = out[o + 2] = line[x * 2]; out[o + 3] = line[x * 2 + 1] }
        }
        prev = line
    }
    return { w, h, px: out }
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
}
/** RGBA PNG; `lower` keeps the game's "\x89png" signature spelling. */
function encodePng({ w, h, px }, lower) {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
    const raw = Buffer.alloc((w * 4 + 1) * h)
    for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (lower) sig.write("png", 1, "latin1")
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))])
}
const asPng = b => { const c = Buffer.from(b); c.write("PNG", 1, "latin1"); return c }
const fs=require("fs"),{execFileSync}=require("child_process");const SP=__dirname;const FONT="F:/WF client/fonts/";
const load=f=>decodePng(asPng(fs.readFileSync(f)));
const save=(img,f)=>{const b=encodePng(img);fs.writeFileSync(f,b);const g=Buffer.from(b);g.write("png",1,"latin1");fs.writeFileSync(f+".game",g)};
function textImg(text,size,weight){const out=SP+"/_t.png";execFileSync("powershell",["-NoProfile","-ExecutionPolicy","Bypass","-File",SP+"/render_text.ps1",FONT+"Poppins-"+weight+".ttf",String(size),text,out]);const t=load(out);
 let x0=t.w,y0=t.h,x1=-1,y1=-1;for(let y=0;y<t.h;y++)for(let x=0;x<t.w;x++)if(t.px[(y*t.w+x)*4+3]>8){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
 const w=x1-x0+1,h=y1-y0+1,px=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)t.px.copy(px,y*w*4,((y0+y)*t.w+x0)*4,((y0+y)*t.w+x0+w)*4);return {w,h,px}}
// white text pixels in a rect -> bbox (padded)
function textBox(img,[rx,ry,rw,rh],thr=235,pad=5){let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++){const i=(y*img.w+x)*4;if(img.px[i]>=thr&&img.px[i+1]>=thr&&img.px[i+2]>=thr&&img.px[i+3]>200){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}
 return x1<0?null:[Math.max(0,x0-pad),Math.max(0,y0-pad),Math.min(img.w-1,x1+pad),Math.min(img.h-1,y1+pad)]}
// fill bbox by vertical interpolation between the rows just outside it
function erase([x0,y0,x1,y1],img){for(let x=x0;x<=x1;x++){const a=((y0-1)*img.w+x)*4,b=((y1+1)*img.w+x)*4;for(let y=y0;y<=y1;y++){const t=(y-y0+1)/(y1-y0+2),i=(y*img.w+x)*4;for(let k=0;k<4;k++)img.px[i+k]=Math.round(img.px[a+k]*(1-t)+img.px[b+k]*t)}}}
function paste(img,t,cx,cy){const ox=Math.round(cx-t.w/2),oy=Math.round(cy-t.h/2);for(let y=0;y<t.h;y++)for(let x=0;x<t.w;x++){const X=ox+x,Y=oy+y;if(X<0||Y<0||X>=img.w||Y>=img.h)continue;const s=(y*t.w+x)*4,d=(Y*img.w+X)*4,a=t.px[s+3]/255;for(let k=0;k<3;k++)img.px[d+k]=Math.round(t.px[s+k]*a+img.px[d+k]*(1-a));img.px[d+3]=Math.max(img.px[d+3],t.px[s+3])}}
function fit(text,weight,maxW,targetH){let size=targetH*1.35,t;for(let i=0;i<12;i++){t=textImg(text,size,weight);if(t.w<=maxW)break;size*=maxW/t.w*0.98}return t}
module.exports={load,save,textBox,erase,paste,fit,textImg};
// a soft dark shadow under text (3x3 spread, offset 2px)
module.exports.shadow=function(img,t,cx,cy,alpha=0.35){const ox=Math.round(cx-t.w/2)+2,oy=Math.round(cy-t.h/2)+2;for(let y=-1;y<t.h+1;y++)for(let x=-1;x<t.w+1;x++){let a=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<t.w&&Y<t.h)a+=t.px[(Y*t.w+X)*4+3]}a=a/9/255*alpha;const X=ox+x,Y=oy+y;if(X<0||Y<0||X>=img.w||Y>=img.h||a<=0)continue;const d=(Y*img.w+X)*4;for(let k=0;k<3;k++)img.px[d+k]=Math.round(img.px[d+k]*(1-a))}}

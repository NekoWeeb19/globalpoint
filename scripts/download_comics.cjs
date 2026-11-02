// Downloads the comics listed in assets/comics_en.json (Flipper World -> .cdn/comics/0) and
// assets/comics_stella_en.json (Stella's W.F.101 -> .cdn/comics/1) from wfjukebox's CDN, as
// <episode>.png (full page), <episode>.small.png (list thumbnail) and <episode>.large.png (wide
// banner for the newest comic). Skips files that are already there,
// so it can be run again after a failure.
//
//   node scripts/download_comics.cjs
const fs = require("fs")
const path = require("path")
const https = require("https")

const SERIES = [
    { list: require("../assets/comics_en.json").comics, base: "https://wfjukebox.b-cdn.net/comics/comics-en", out: path.join(__dirname, "..", ".cdn", "comics", "0") },
    { list: require("../assets/comics_stella_en.json").comics, base: "https://wfjukebox.b-cdn.net/comics/stella-en", out: path.join(__dirname, "..", ".cdn", "comics", "1") },
]

function get(url, file) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url}: HTTP ${res.statusCode}`)) }
            const tmp = file + ".part"
            const out = fs.createWriteStream(tmp)
            res.pipe(out)
            out.on("finish", () => out.close(() => { fs.renameSync(tmp, file); resolve() }))
            out.on("error", reject)
        }).on("error", reject)
    })
}

;(async () => {
    for (const { out } of SERIES) fs.mkdirSync(out, { recursive: true })
    const jobs = SERIES.flatMap(({ list, base, out }) => list.flatMap(c => [
        [`${base}/${c.episode}/base.png`, path.join(out, `${c.episode}.png`)],
        [`${base}/${c.episode}/small.png`, path.join(out, `${c.episode}.small.png`)],
        [`${base}/${c.episode}/large.png`, path.join(out, `${c.episode}.large.png`)],
    ])).filter(([, file]) => !fs.existsSync(file))
    let done = 0, failed = 0
    const worker = async () => {
        while (jobs.length > 0) {
            const [url, file] = jobs.shift()
            for (let attempt = 1; ; attempt++) {
                try { await get(url, file); break } catch (e) {
                    if (attempt >= 3) { failed++; console.error(e.message); break }
                }
            }
            if (++done % 50 === 0) console.log(`${done} files...`)
        }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    console.log(`done: ${done} files, ${failed} failed`)
})()

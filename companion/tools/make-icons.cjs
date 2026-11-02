// Writes the companion's icon drawables: the dashboard logo (web/public/img/logo.png, 125x118) redrawn
// as vectors. Each sparkle is a 4-point star fitted to the PNG: tips at 0.8r, curve control at
// 0.06r, plus a round stroke 0.4r wide for the rounded tips.
const fs = require("fs"), path = require("path")
// Usage: node companion/tools/make-icons.cjs   (writes into companion/app/src/main/res)
const res = process.argv[2] || path.join(__dirname, "..", "app", "src", "main", "res")
const GOLD = "#FFE9C400", SURFACE = "#FF171306"

// sparkles in the PNG's pixel space: center and radius (measured, pixel extents + 0.5)
const stars = [
    { x: 80.5, y: 52.5, r: 43 },   // big, right
    { x: 29, y: 17.5, r: 17.25 },  // small, top left
    { x: 29, y: 88, r: 28.5 },     // bottom left
]
const n = v => +v.toFixed(2)
function star({ x, y, r }) {
    const t = 0.8 * r, c = 0.06 * r
    return `M${n(x + t)},${n(y)} Q${n(x + c)},${n(y + c)} ${n(x)},${n(y + t)} Q${n(x - c)},${n(y + c)} ${n(x - t)},${n(y)} `
        + `Q${n(x - c)},${n(y - c)} ${n(x)},${n(y - t)} Q${n(x + c)},${n(y - c)} ${n(x + t)},${n(y)} Z`
}
const paths = color => stars.map(s => `        <path android:fillColor="${color}" android:strokeColor="${color}" android:strokeWidth="${n(0.4 * s.r)}" android:strokeLineJoin="round" android:pathData="${star(s)}" />`).join("\n")

// center of the drawing and its farthest point (tips are rounded: tip + stroke = r) from that center
const cx = 62.5, cy = 59
let reach = 0
for (const s of stars) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) reach = Math.max(reach, Math.hypot(s.x + dx * s.r - cx, s.y + dy * s.r - cy))
function group(size, radius, color) {
    const k = radius / reach
    return `    <group android:scaleX="${n(k)}" android:scaleY="${n(k)}" android:translateX="${n(size / 2 - cx * k)}" android:translateY="${n(size / 2 - cy * k)}">\n${paths(color)}\n    </group>`
}
const vector = (size, dp, body) => `<?xml version="1.0" encoding="utf-8"?>
<!-- the dashboard logo (web/public/img/logo.png) as a vector; made by companion/tools/make-icons.cjs -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${dp}dp" android:height="${dp}dp" android:viewportWidth="${size}" android:viewportHeight="${size}">
${body}
</vector>
`
const write = (file, text) => { fs.writeFileSync(path.join(res, file), text); console.log("wrote", file) }

// adaptive icon foreground: 108dp, everything inside the 66dp safe circle (radius 33; 31 leaves a margin)
write("drawable/ic_launcher_foreground.xml", vector(108, 108, group(108, 31, GOLD)))
// themed icon (Android 13+): only the shape counts, the system picks the color
write("drawable/ic_launcher_monochrome.xml", vector(108, 108, group(108, 31, "#FFFFFFFF")))
write("drawable/ic_launcher_background.xml", `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="${SURFACE}" />
</shape>
`)
// notification small icon: white silhouette, 24dp
write("drawable/ic_notification.xml", vector(24, 24, group(24, 11.5, "#FFFFFFFF")))
// before Android 8 (no adaptive icons): rounded square with the sparkles
write("mipmap/ic_launcher.xml", vector(48, 48,
    `    <path android:fillColor="${SURFACE}" android:pathData="M10,2 H38 A8,8 0 0 1 46,10 V38 A8,8 0 0 1 38,46 H10 A8,8 0 0 1 2,38 V10 A8,8 0 0 1 10,2 Z" />\n` + group(48, 20, GOLD)))
write("mipmap-anydpi-v26/ic_launcher.xml", `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`)
console.log("reach", n(reach))

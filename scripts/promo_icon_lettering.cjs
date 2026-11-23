// English lettering for a promo icon that only exists with Japanese lettering (Black Clover's campaign mission icon,
// quest/event/banner/collect_item_event/b_collabo_mission_event_001: the collab never ran on global). Every promo icon
// carries the same lettering layer (キャンペーンミッション, global's "Promo Missions") over its own art, so:
//   - the English lettering is where two of global's English icons agree (their art behind it differs),
//   - the Japanese lettering is where the target agrees with a Japanese icon of the same layer,
//   - both are found at the offset where the target's lettering lines up with the Japanese reference's (Black
//     Clover's sits 6 pixels higher than 1st Anniversary's),
//   - the English pixels go on top, and Japanese pixels the English doesn't cover are filled from the art around them.
// Used by scripts/gen_cn_art_fixes.cjs (rule 5). Pictures are { w, h, px } RGBA (scripts/cn_sprite_merge.cjs).

const dist = (a, i, b, j) => Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]) + Math.abs(a[i + 3] - b[j + 3])
const AREA = { x: 140, y: 150 } // the lettering's corner (lower right); the frame elsewhere is the same on every icon

/** The offset (dx, dy) where the target's lettering matches the Japanese reference's best: { dx, dy, share }. */
function letteringOffset(target, jp, en) {
    const { w, h } = target
    let best = { dx: 0, dy: 0, share: 0 }
    for (let dy = -12; dy <= 12; dy++) for (let dx = -6; dx <= 6; dx++) {
        let n = 0, same = 0
        for (let y = AREA.y; y < h; y++) for (let x = AREA.x; x < w; x++) {
            const i = (y * w + x) * 4
            // the Japanese reference's lettering: differs from the English copy of the same icon, and is orange/yellow
            if (dist(jp.px, i, en.px, i) <= 30 || !(jp.px[i] > 190 && jp.px[i + 1] > 90 && jp.px[i + 2] < 110)) continue
            const X = x + dx, Y = y + dy
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue
            n++
            if (dist(jp.px, i, target.px, (Y * w + X) * 4) <= 40) same++
        }
        if (n && same / n > best.share) best = { dx, dy, share: same / n }
    }
    return best
}

/**
 * The target picture with English lettering, or null when its lettering doesn't line up with the reference's.
 * jp/en: the same icon with Japanese and English lettering (1st Anniversary, CN's and global's); en2: another of
 * global's English icons (Summer 2020).
 */
function englishLettering(target, jp, en, en2) {
    const { w, h } = target
    for (const p of [jp, en, en2]) if (p.w !== w || p.h !== h) return null
    const { dx, dy, share } = letteringOffset(target, jp, en)
    if (share < 0.8) return null
    const N = w * h, ref = p => { const x = p % w + -dx, y = ((p / w) | 0) + -dy; return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1 }
    const isLettering = p => { const r = ref(p); return r >= 0 && dist(jp.px, r * 4, en.px, r * 4) > 12 }
    const english = new Uint8Array(N), japanese = new Uint8Array(N)
    for (let p = 0; p < N; p++) {
        const x = p % w, y = (p / w) | 0, r = ref(p)
        if (x < AREA.x - 10 || y < AREA.y - 10 || r < 0) continue
        if (en.px[r * 4 + 3] > 0 && dist(en.px, r * 4, en2.px, r * 4) <= 12) english[p] = 1
        if (isLettering(p) && dist(target.px, p * 4, jp.px, r * 4) <= 60) japanese[p] = 1
    }
    // close 1-pixel gaps inside the English letters
    const around = [1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1]
    for (let pass = 0; pass < 2; pass++) {
        const g = english.slice()
        for (let p = w + 1; p < N - w - 1; p++) if (!english[p] && around.reduce((n, d) => n + english[p + d], 0) >= 5) g[p] = 1
        english.set(g)
    }
    // the Japanese lettering's soft edge
    { const g = japanese.slice(); for (let p = 0; p < N; p++) if (japanese[p]) for (const d of [1, -1, w, -w]) if (p + d >= 0 && p + d < N && isLettering(p + d)) g[p + d] = 1; japanese.set(g) }

    const px = Buffer.from(target.px)
    for (let p = 0; p < N; p++) if (english[p]) { const r = ref(p) * 4; en.px.copy(px, p * 4, r, r + 4) }
    const hole = new Uint8Array(N)
    for (let p = 0; p < N; p++) if (japanese[p] && !english[p]) hole[p] = 1
    for (let pass = 0; pass < 300; pass++) {
        const next = []
        for (let p = 0; p < N; p++) if (hole[p]) {
            const x = p % w, y = (p / w) | 0, sum = [0, 0, 0, 0]
            let n = 0
            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
                const X = x + ox, Y = y + oy, q = Y * w + X
                if (X < 0 || Y < 0 || X >= w || Y >= h || hole[q] || english[q]) continue
                for (let k = 0; k < 4; k++) sum[k] += px[q * 4 + k]
                n++
            }
            if (n >= 2) next.push([p, sum.map(v => Math.round(v / n))])
        }
        if (!next.length) break
        for (const [p, c] of next) { for (let k = 0; k < 4; k++) px[p * 4 + k] = c[k]; hole[p] = 0 }
    }
    return { w, h, px, offset: { dx, dy, share } }
}

module.exports = { englishLettering, letteringOffset }

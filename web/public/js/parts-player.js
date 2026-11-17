// Plays the game's "parts" animations (battle effects: <effect>.parts / .atlas / .timeline / .png) on a canvas.
// A port of the client's flatomo player (flatomo.animation.parts: PartsAnimationSource, GraphicsSource,
// PartsAnimationImageProvider.moveImage, LayoutTools.apply; CN 1.8.1), as read from its code:
//   parts.t  matrices {a, b, c, d, x, y}, fixed point (4096 = 1.0)
//   parts.c  custom easing curves (cubic Bezier points x 1,000,000)
//   parts.i  images [{ p: atlas name, s: smoothing }]; atlas frames { n, x, y, w, h (in the sheet), r: stored turned 90
//            degrees (w x h is then the turned size), fx, fy, fw, fh: trimmed (the pixels sit at -fx, -fy) }
//   parts.g  graphics [{ t: total frames, s: segments }]; graphics[0] is the animation
//     segment { s: kind << 30 | start frame (kind 0 image, 1 movie, 2 graphics), i: image or graphics index, l: keys }
//     key { t: duration (low 16 bits) | tween kind << 16 (0 none, 1 custom curve, 2 ease) | easing << 18,
//           m: matrix index << 12 | blend mode << 8 | alpha (0-255), c: colour (multiplier % << 24 | R << 16 | G << 8 | B),
//           r: loop kind << 30 | start frame (graphics: 0 hold, 1 play once, 2 loop) }
// Frames are drawn in the order of the segments; a graphics segment draws its child at the child's frame.
// Works in the browser (window.PartsPlayer) and in Node (module.exports) for checks.
;(function (root) {
    const RES = 4096
    const DEFAULT_COLOUR = 1677721600 // 100 % multiplier, no offsets
    const BLEND = ["source-over", "lighter", "multiply", "overlay", "screen"]

    // a custom easing curve (CustomTweenRecord): cubic Bezier segments from (0,0) to (1,1), six numbers per segment
    // (control 1 x/y, control 2 x/y, end x/y; the last segment's end is (1,1)), all x 1,000,000
    function curveRatio(res, t) {
        const v = (k) => res[k] / 1e6, count = Math.round((res.length + 2) / 6)
        let lo = 0, hi = count - 1
        while (lo !== hi) { const mid = lo + Math.ceil((hi - lo) / 2); if (t < v(mid * 6 - 2)) hi = mid - 1; else lo = mid }
        const k = lo
        const x0 = k ? v(k * 6 - 2) : 0, y0 = k ? v(k * 6 - 1) : 0
        const x1 = v(k * 6), y1 = v(k * 6 + 1), x2 = v(k * 6 + 2), y2 = v(k * 6 + 3)
        const x3 = k === count - 1 ? 1 : v(k * 6 + 4), y3 = k === count - 1 ? 1 : v(k * 6 + 5)
        const bx = (u) => ((1 - u) ** 3) * x0 + 3 * ((1 - u) ** 2) * u * x1 + 3 * (1 - u) * u * u * x2 + u ** 3 * x3
        const by = (u) => ((1 - u) ** 3) * y0 + 3 * ((1 - u) ** 2) * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3 * y3
        let a = 0, b = 1
        for (let n = 0; n < 30; n++) { const m = (a + b) / 2; if (bx(m) < t) a = m; else b = m }
        return by((a + b) / 2)
    }
    function easing(kind, value, curves, ratio) {
        if (kind === 2) {
            const e = value / 100
            return e === 0 ? ratio : e < 0 ? ratio * (ratio * -e + (1 + e)) : ratio * ((2 - ratio) * e + (1 - e))
        }
        const c = curves[value]
        return c ? curveRatio(c, ratio) : ratio
    }
    const easingValue = (t) => { const v = t >> 18, k = (t >> 16) & 3; return k === 2 ? v - 63 : v }

    // every frame of a graphic: a list of { kind, id, frame (graphics), m: [a,b,c,d,x,y], alpha, blend, colour }
    function bake(parts) {
        const mats = parts.t.map((t) => [t.a / RES, t.b / RES, t.c / RES, t.d / RES, t.x / RES, t.y / RES])
        const out = parts.g.map((g) => Array.from({ length: g.t }, () => []))
        parts.g.forEach((g, gi) => {
            const frames = out[gi]
            // later segments are added first and each goes to the front, so the list ends up in segment order
            for (let n = g.s.length - 1; n >= 0; n--) {
                const seg = g.s[n], kind = seg.s >>> 30, start = seg.s & 0x3fffffff, keys = seg.l
                let at = start
                keys.forEach((key, k) => {
                    const dur = key.t == null ? 1 : (key.t & 0xffff) || 1
                    const tween = key.t == null ? 0 : (key.t >> 16) & 3
                    const m0 = mats[key.m >>> 12], a0 = (key.m & 0xff) / 255, blend = (key.m >> 8) & 0xf, c0 = key.c ?? DEFAULT_COLOUR
                    const next = keys[k + 1]
                    for (let f = 0; f < dur; f++) {
                        const frame = at + f
                        if (frame >= frames.length) break
                        let m = m0, alpha = a0, col = c0
                        if (tween && next && f > 0) {
                            const r = easing(tween, easingValue(key.t), parts.c, f / dur)
                            const m1 = mats[next.m >>> 12], a1 = (next.m & 0xff) / 255, c1 = next.c ?? DEFAULT_COLOUR
                            m = m0.map((v, q) => v * (1 - r) + m1[q] * r)
                            alpha = a0 * (1 - r) + a1 * r
                            if (c0 !== c1) col = [24, 16, 8, 0].reduce((acc, sh) => acc | ((Math.trunc(((c0 >> sh) & 0xff) * (1 - r) + ((c1 >> sh) & 0xff) * r) & 0xff) << sh), 0)
                        }
                        let child = 0
                        if (kind === 2 && key.r != null) {
                            const lk = key.r >>> 30, sf = key.r & 0x3fffffff, total = parts.g[seg.i]?.t ?? 1
                            child = lk === 0 ? sf : lk === 1 ? Math.min(sf + f, total - 1) : (sf + f) % total
                        }
                        frames[frame].unshift({ kind, id: seg.i, frame: child, m, alpha, blend, colour: col })
                    }
                    at += dur
                })
            }
        })
        return out
    }

    // the images to draw at a frame of graphic gi: { image, m (world), alpha, blend, colour }, in draw order
    function collect(baked, gi, frame, parent, alpha, blend, colourMul, out) {
        const list = baked[gi]?.[frame] ?? []
        for (const p of list) {
            const [a, b, c, d, x, y] = p.m, [pa, pb, pc, pd, px, py] = parent
            const m = [a * pa + b * pc, a * pb + b * pd, c * pa + d * pc, c * pb + d * pd, x * pa + y * pc + px, x * pb + y * pd + py]
            const al = alpha * p.alpha, bl = p.blend || blend
            const mul = colourMul * (((p.colour >> 24) & 0xff) / 100)
            if (p.kind === 0) out.push({ image: p.id, m, alpha: al, blend: bl, colour: p.colour, mul })
            else if (p.kind === 2) collect(baked, p.id, p.frame, m, al, bl, mul, out)
        }
        return out
    }

    class PartsPlayer {
        // parts: the .parts JSON; atlas: the .atlas JSON (frames by name); image: the sheet (HTMLImageElement or null)
        constructor(parts, atlas, image) {
            this.parts = parts
            this.atlas = new Map(atlas.map((f) => [f.n, f]))
            this.image = image
            this.baked = bake(parts)
            this.total = parts.g[0]?.t ?? 0
        }
        // what is drawn at a frame (0-based), with each piece's box in effect units, before scale
        piecesAt(frame) {
            return collect(this.baked, 0, frame, [1, 0, 0, 1, 0, 0], 1, 0, 1, []).map((q) => {
                const f = this.atlas.get(this.parts.i[q.image]?.p)
                return { ...q, frame: f }
            }).filter((q) => q.frame)
        }
        // the box the frame's pieces cover: { minX, minY, maxX, maxY } or null
        bounds(frame) {
            let box = null
            for (const q of this.piecesAt(frame)) {
                if (q.alpha <= 0.01) continue
                const f = q.frame, ox = -(f.fx ?? 0), oy = -(f.fy ?? 0), [w, h] = f.r ? [f.h, f.w] : [f.w, f.h]
                for (const [u, v] of [[ox, oy], [ox + w, oy], [ox, oy + h], [ox + w, oy + h]]) {
                    const X = q.m[0] * u + q.m[2] * v + q.m[4], Y = q.m[1] * u + q.m[3] * v + q.m[5]
                    box = box ? { minX: Math.min(box.minX, X), minY: Math.min(box.minY, Y), maxX: Math.max(box.maxX, X), maxY: Math.max(box.maxY, Y) } : { minX: X, minY: Y, maxX: X, maxY: Y }
                }
            }
            return box
        }
        // draws a frame onto a 2D canvas context, centred at (cx, cy), scaled
        draw(ctx, frame, cx, cy, scale) {
            if (!this.image) return
            for (const q of this.piecesAt(frame)) {
                if (q.alpha <= 0.003) continue
                const f = q.frame, [a, b, c, d, x, y] = q.m
                ctx.save()
                ctx.globalAlpha = Math.max(0, Math.min(1, q.alpha))
                ctx.globalCompositeOperation = BLEND[q.blend] ?? "source-over"
                ctx.setTransform(a * scale, b * scale, c * scale, d * scale, cx + x * scale, cy + y * scale)
                // a trimmed frame: its pixels sit at (-fx, -fy) inside the untrimmed size
                ctx.translate(-(f.fx ?? 0), -(f.fy ?? 0))
                // a rotated frame ("r"): stored turned 90 degrees clockwise in the sheet (w x h there), turned back here
                if (f.r) ctx.transform(0, -1, 1, 0, 0, f.w)
                ctx.drawImage(this.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
                ctx.restore()
            }
        }
    }
    if (typeof module !== "undefined") module.exports = { PartsPlayer, bake }
    else root.PartsPlayer = PartsPlayer
})(typeof window !== "undefined" ? window : globalThis)

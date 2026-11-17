// Skill preview: runs a skill script frame by frame into snapshots of what's on screen, and draws them.
// What the game does when a skill fires (CN 1.8.1 client: MemberImpl.startSkillCutinAnimation, BallImpl.startToSkillCutin):
// the unit's sprite plays its "skill_ready" sequence with a skill flash and the cut-in, the ball holds for 60 frames,
// then the script runs. Units are drawn x 6 (BattleConstants.SCALE_RENDERER); effects and areas use battle units.
// An approximation for the dashboard, not the battle: no enemies (a pretend target stands in for "the one hit", groups
// of enemies and anything the stage can't place), the ball stands still unless Move the ball moves it (moving up),
// and a branch (If ...) shows its first block. Needs parts-player.js (window.PartsPlayer) for effects.
;(function (root) {
    const CUTIN = 60 // frames before the script runs
    const UNIT_SCALE = 6
    const BALL = { x: 0, y: 300 } // where the unit's ball is on the stage
    const TARGET = { x: 0, y: -150 } // the pretend enemy
    const FIELD = { w: 1500, h: 2000 } // CN's whole-field areas are 1500 x 2000 around the centre (-1)
    const MAX_FRAMES = 1800

    const isBlock = (v) => Array.isArray(v) && v[0] === "Block" && Array.isArray(v[1])
    const isItem = (v) => Array.isArray(v) && (v[0] === "Command" || v[0] === "Event") && Array.isArray(v[1])
    const items = (v) => isBlock(v) ? v[1] : isItem(v) ? [v] : []
    const top = (v) => typeof v === "number" ? v : Array.isArray(v) && v[0] && typeof v[0] === "object" ? (v[0].max ?? v[0].alv_max ?? null) : null
    const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) })
    const angleTo = (from, to) => Math.atan2(to.x - from.x, -(to.y - from.y)) // 0 = up the screen, clockwise

    // runs the script; frames counts from the button press (the script starts at CUTIN). effectFrames: path -> { first, total, sequences }
    function simulate(program, effectFrames = {}) {
        const queue = new Map() // frame -> [fn]
        const at = (f, fn) => { if (f > MAX_FRAMES) return; if (!queue.has(f)) queue.set(f, []); queue.get(f).push(fn) }
        const ball = { kind: "ball", x: BALL.x, y: BALL.y, angle: 0, alive: () => true, moves: [] }
        const target = { kind: "target", x: TARGET.x, y: TARGET.y, alive: () => true }
        const centre = { kind: "centre", x: 0, y: 0, alive: () => true }
        const corner = { kind: "corner", x: -FIELD.w / 2, y: -FIELD.h / 2, alive: () => true }
        const areas = [], points = [], effects = [], hides = [], shakes = [], notes = new Set()
        let lastEnd = CUTIN
        const subject = (id, scope) => id === -17 || id === -18 || id === -33 ? ball : id === -1 ? centre : id === -2 ? corner : scope.get(id) ?? target
        // a direction system's angle for something attached to `of`
        const dirAngle = (dir, of, scope) => {
            if (!Array.isArray(dir)) return 0
            if (dir[0] === "EF") return of?.angle ?? ball.angle
            if (dir[0] === "CD") return of?.rot ?? 0
            if (dir[0] === "GH") return angleTo(of ?? ball, subject(dir[1], scope))
            return 0
        }
        // where something attached to `of` with an offset sits, and its rotation
        const place = (of, dir, ox, oy, r, scope) => {
            const a = dirAngle(dir, of, scope), o = rot(ox || 0, oy || 0, a)
            return { x: of.x + o.x, y: of.y + o.y, rot: a + (r || 0), angle: a }
        }
        const lifeFrames = (lt) => Array.isArray(lt) ? top(lt[1]) : null

        function run(block, t, scope) {
            const local = new Map(scope)
            for (const it of items(block)) {
                if (isBlock(it)) { run(it, t, local); continue }
                if (!isItem(it)) continue
                const p = it[1], name = p[0]
                lastEnd = Math.max(lastEnd, t)
                if (it[0] === "Event") {
                    if (name === "Wait") at(t + (p[1] || 0), (tt) => run(p[3], tt, local))
                    else if (name === "Repeat") {
                        const every = Math.max(1, p[1] || 1), times = Math.max(1, Math.min(120, p[2] || 1))
                        for (let k = 0; k < times; k++) at(t + every * k, (tt) => run(p[4], tt, local))
                    } else {
                        // ball hits: shown once, on the pretend target
                        notes.add("“When the ball hits” blocks are shown once, at the start.")
                        for (const b of p.slice(1).filter((x) => isBlock(x) || isItem(x)).slice(0, 1)) at(t, (tt) => run(b, tt, local))
                    }
                    continue
                }
                switch (name) {
                    case "CreateHitArea": {
                        const of = subject(p[2], local), pl = place(of, p[3], p[4], p[5], p[6], local)
                        const life = (Array.isArray(p[13]) && /^SpecifyHitAreaLifetime/.test(p[13][0]) ? top(p[13][1]) : null) ?? 60
                        const area = { kind: "area", shape: p[9], start: t, end: t + life, x: pl.x, y: pl.y, rot: pl.rot, angle: pl.angle, follow: p[7] ? { of, ox: p[4], oy: p[5], dir: p[3], r: p[6] } : null, moves: [], alive: (f) => f < area.end }
                        areas.push(area); lastEnd = Math.max(lastEnd, area.end)
                        const inner = new Map(local)
                        if (Number.isInteger(p[19])) inner.set(p[19], area)
                        if (Number.isInteger(p[21])) inner.set(p[21], area)
                        if (Number.isInteger(p[22])) inner.set(p[22], target)
                        run(p[20], t, inner)
                        // "on each hit": once, a frame later, on the pretend target
                        at(t + 1, (tt) => run(p[23], tt, inner))
                        break
                    }
                    case "ShowEffect": {
                        const path = Array.isArray(p[2]) && typeof p[2][1] === "string" ? p[2][1] : null
                        if (!path) break
                        const of = subject(p[3], local), pl = place(of, p[6], p[7], p[8], p[9], local)
                        const fr = effectFrames[path], lt = p[5]
                        let end
                        if (Array.isArray(lt) && /^SpecifyEffectLifetime/.test(lt[0])) end = t + (lifeFrames(lt) ?? 60)
                        else if (Array.isArray(lt) && lt[0] === "PlayOnlyFirstSequence") end = t + (fr?.first ?? 60)
                        else if (Array.isArray(lt) && lt[0] === "UntilTargetTerminates") end = of.end ?? t + (fr?.total ?? 60)
                        else end = t + (fr?.total ?? 60)
                        const sc = Array.isArray(p[12]) && p[12][0] === "Some" ? (top(p[12][1]) ?? 1) : 1
                        effects.push({ kind: "effect", path, shared: p[2][0] === "ResolveByElement", start: t, end, once: Array.isArray(lt) && lt[0] === "PlayOnlyFirstSequence", x: pl.x, y: pl.y, rot: pl.rot, scale: sc, layer: Array.isArray(p[4]) ? p[4][0] : "", follow: p[10] ? { of, ox: p[7], oy: p[8], dir: p[6], r: p[9], turn: p[11] } : null })
                        lastEnd = Math.max(lastEnd, end)
                        break
                    }
                    case "CreateReferencePoint": {
                        const of = subject(p[1], local), pl = place(of, p[2], p[3], p[4], p[5], local)
                        const point = { kind: "point", x: pl.x, y: pl.y, rot: pl.rot, angle: pl.angle, start: t, end: t + (p[9] || 60), alive: (f) => f < point.end, follow: p[6] ? { of, ox: p[3], oy: p[4], dir: p[2], r: p[5] } : null }
                        points.push(point)
                        const inner = new Map(local); if (Number.isInteger(p[10])) inner.set(p[10], point)
                        run(p[11], t, inner)
                        break
                    }
                    case "CreateReferencePointAtSpecifiedPosition": {
                        const of = subject(p[2], local)
                        const point = { kind: "point", x: of.x, y: of.y, rot: 0, angle: 0, start: t, end: t + (p[3] || 60), alive: (f) => f < point.end }
                        points.push(point)
                        const inner = new Map(local); if (Number.isInteger(p[4])) inner.set(p[4], point)
                        run(p[5], t, inner)
                        break
                    }
                    case "FindAllSubjects": case "FindNearSubjects": {
                        // the party (and the unit) are the unit; enemies, and anything else, the pretend target
                        const group = name === "FindAllSubjects" ? p[2] : p[3], id = name === "FindAllSubjects" ? p[1] : p[5]
                        const who = group === 1 || (group >= 33 && group <= 39) || (group >= 81 && group <= 147) ? ball : target
                        const inner = new Map(local); if (Number.isInteger(id)) inner.set(id, who)
                        run(name === "FindAllSubjects" ? p[9] : p[6], t, inner)
                        break
                    }
                    case "MoveBall": {
                        const of = subject(p[1], local)
                        if (of === ball) {
                            const a = dirAngle(p[2], ball, local) + (p[3] || 0)
                            ball.moves.push({ start: t, end: t + (p[4] || 0), angle: a, speed: p[5] || 0 })
                            lastEnd = Math.max(lastEnd, t + (p[4] || 0))
                        }
                        break
                    }
                    case "MoveHitArea": {
                        const area = subject(p[1], local)
                        if (area.kind === "area") area.moves.push({ start: t, angle: dirAngle(p[2], area, local) + (p[3] || 0), speed: p[4] || 0 })
                        break
                    }
                    case "HideCharacter": hides.push([t, t + (p[2] || 0)]); break
                    case "ShakeCamera": shakes.push({ start: t, end: t + 18, size: p[1] || 1 }); break
                    case "StopBall": lastEnd = Math.max(lastEnd, t + (p[2] || 0)); break
                    default: {
                        // a branch or anything else that holds blocks: its first block
                        const blocks = p.slice(1).filter((x) => isBlock(x) || isItem(x))
                        if (blocks.length) {
                            if (/^Conditionals|^If/.test(name) && blocks.length > 1) notes.add("A branch (If ...) shows its first block.")
                            run(blocks[0], t, local)
                        }
                    }
                }
            }
        }
        run(program?.[11], CUTIN, new Map())

        // step the frames: run what's due, move the ball and areas, follow, snapshot
        // until everything scheduled has run and ended (Waits add commands as they come due)
        const horizon = () => Math.min(MAX_FRAMES, Math.max(lastEnd, ...queue.keys(), ...effects.map((e) => e.end), ...areas.map((a) => a.end), ...points.map((q) => q.end)) + 20)
        const frames = []
        for (let f = 0; f <= horizon(); f++) {
            for (const fn of queue.get(f) ?? []) fn(f)
            for (const m of ball.moves) if (f > m.start && f <= m.end) { ball.x += Math.sin(m.angle) * m.speed; ball.y -= Math.cos(m.angle) * m.speed; ball.angle = m.angle }
            for (const a of areas) for (const m of a.moves) if (f > m.start && f < a.end) { a.x += Math.sin(m.angle) * m.speed; a.y -= Math.cos(m.angle) * m.speed }
            const follow = (o) => { if (!o.follow) return; const pl = place(o.follow.of, o.follow.dir, o.follow.ox, o.follow.oy, o.follow.r, new Map()); o.x = pl.x; o.y = pl.y; if (o.follow.turn !== false) o.rot = pl.rot }
            const snap = { frame: f, ball: { x: ball.x, y: ball.y, hidden: hides.some(([a, b]) => f >= a && f < b) }, shake: 0, areas: [], effects: [], points: [] }
            for (const a of areas) if (f >= a.start && f < a.end) { follow(a); snap.areas.push({ shape: a.shape, x: a.x, y: a.y, rot: a.rot }) }
            for (const p of points) if (f >= p.start && f < p.end) { follow(p); snap.points.push({ x: p.x, y: p.y }) }
            for (const e of effects) if (f >= e.start && f < e.end) { follow(e); snap.effects.push({ path: e.path, shared: e.shared, local: f - e.start, once: e.once, x: e.x, y: e.y, rot: e.rot, scale: e.scale, layer: e.layer }) }
            for (const s of shakes) if (f >= s.start && f < s.end) snap.shake = Math.max(snap.shake, s.size * 6 * (1 - (f - s.start) / 18))
            frames.push(snap)
        }
        if (effects.length || areas.length) notes.add("Enemies aren't shown: “the one hit” and enemy groups stand on a pretend target (the cross above the unit).")
        return { frames, notes: [...notes], cutin: CUTIN, target: TARGET }
    }

    // an effect's frame at `local` frames after it appears: through its sequences, looping the loop ones
    function effectFrame(info, total, local, once) {
        if (!info?.sequences?.length) return Math.min(local, total - 1)
        const seqs = info.sequences.map((s) => { const m = /^(\S+) (\d+)-(\d+) (\S+)$/.exec(s); return m ? { b: +m[2] - 1, e: +m[3] - 1, kind: m[4] } : null }).filter(Boolean)
        if (once) return Math.min(local, seqs[0].e)
        let f = local
        for (const s of seqs) {
            const len = s.e - s.b + 1
            if (s.kind === "loop") return s.b + (f % len)
            if (f < len) return s.b + f
            f -= len
        }
        return Math.min(local, total - 1)
    }

    class SkillStage {
        // sim: from simulate(); sprite: { atlas, timeline, image } or null; loadEffect(path) -> Promise<PartsPlayer|null>
        constructor(canvas, sim, sprite, loadEffect, effectFrames) {
            this.canvas = canvas; this.sim = sim; this.sprite = sprite; this.effectFrames = effectFrames
            this.players = new Map()
            for (const f of sim.frames) for (const e of f.effects) if (!this.players.has(e.path)) {
                this.players.set(e.path, null)
                loadEffect(e.path, e.shared).then((pl) => this.players.set(e.path, pl)).catch(() => { })
            }
            // the sprite's frames by number (frame f shows the first image numbered f or later)
            if (sprite) {
                const imgs = sprite.atlas.map((a) => ({ n: parseInt(a.n.slice(-4), 10), a })).sort((x, y) => x.n - y.n)
                this.spriteFrame = (f) => imgs.find((x) => x.n >= f)?.a ?? imgs[imgs.length - 1]?.a
                const seq = (name) => sprite.timeline?.sequences?.find((s) => s.name === name)
                this.ready = seq("skill_ready"); this.neutral = seq("neutral")
            }
            // the view: everything the skill reaches, at least 700 wide
            let minX = BALL.x - 350, maxX = BALL.x + 350, minY = Math.min(BALL.y, TARGET.y) - 200, maxY = BALL.y + 200
            for (const f of sim.frames) {
                for (const a of f.areas) { const r = a.shape?.[0] === "Rectangle" ? Math.max(top(a.shape[1]), top(a.shape[2])) / 2 : top(a.shape?.[1]) ?? 100; minX = Math.min(minX, a.x - r); maxX = Math.max(maxX, a.x + r); minY = Math.min(minY, a.y - r); maxY = Math.max(maxY, a.y + r) }
                for (const e of f.effects) { minX = Math.min(minX, e.x - 100); maxX = Math.max(maxX, e.x + 100); minY = Math.min(minY, e.y - 100); maxY = Math.max(maxY, e.y + 100) }
            }
            minX = Math.max(minX, -FIELD.w / 2 - 100); maxX = Math.min(maxX, FIELD.w / 2 + 100); minY = Math.max(minY, -FIELD.h / 2 - 100); maxY = Math.min(maxY, FIELD.h / 2 + 100)
            this.view = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom: Math.min(canvas.width / (maxX - minX), canvas.height / (maxY - minY)) }
        }
        draw(frame) {
            const ctx = this.canvas.getContext("2d"), snap = this.sim.frames[Math.min(frame, this.sim.frames.length - 1)], v = this.view
            const sx = snap.shake ? (Math.random() - 0.5) * snap.shake : 0, sy = snap.shake ? (Math.random() - 0.5) * snap.shake : 0
            const W = (x) => (x - v.cx + sx) * v.zoom + this.canvas.width / 2, H = (y) => (y - v.cy + sy) * v.zoom + this.canvas.height / 2
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"
            ctx.fillStyle = "#101418"; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
            // the field's edge, when in view
            ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.strokeRect(W(-FIELD.w / 2), H(-FIELD.h / 2), FIELD.w * v.zoom, FIELD.h * v.zoom)
            // the pretend target
            ctx.strokeStyle = "rgba(255,120,120,0.7)"; ctx.beginPath(); const tx = W(TARGET.x), ty = H(TARGET.y); ctx.moveTo(tx - 8, ty - 8); ctx.lineTo(tx + 8, ty + 8); ctx.moveTo(tx + 8, ty - 8); ctx.lineTo(tx - 8, ty + 8); ctx.stroke()
            const drawEffects = (behind) => {
                for (const e of snap.effects) {
                    if ((e.layer === "BacksideOfCharacter") !== behind) continue
                    const pl = this.players.get(e.path); if (!pl) continue
                    const lf = effectFrame(this.effectFrames[e.path], pl.total, e.local, e.once)
                    ctx.save(); ctx.translate(W(e.x), H(e.y)); ctx.rotate(e.rot || 0)
                    pl.draw(ctx, lf, 0, 0, v.zoom * e.scale)
                    ctx.restore()
                }
            }
            drawEffects(true)
            // the unit: skill_ready during the cut-in, then neutral
            if (this.sprite?.image && !snap.ball.hidden) {
                const f = snap.frame < this.sim.cutin && this.ready ? Math.min(this.ready.begin + snap.frame, this.ready.end) : this.neutral ? this.neutral.begin + (Math.floor(snap.frame / 30) % (this.neutral.end - this.neutral.begin + 1)) : 1
                const a = this.spriteFrame(f)
                if (a) {
                    const s = UNIT_SCALE * v.zoom, [w, h] = a.r ? [a.h, a.w] : [a.w, a.h]
                    ctx.save(); ctx.imageSmoothingEnabled = false
                    ctx.translate(W(snap.ball.x) - (a.fw ?? w) / 2 * s, H(snap.ball.y) - (a.fh ?? h) / 2 * s); ctx.scale(s, s); ctx.translate(-(a.fx ?? 0), -(a.fy ?? 0))
                    if (a.r) ctx.transform(0, -1, 1, 0, 0, a.w)
                    ctx.drawImage(this.sprite.image, a.x, a.y, a.w, a.h, 0, 0, a.w, a.h)
                    ctx.restore()
                }
            } else if (!snap.ball.hidden) {
                ctx.fillStyle = "rgba(120,180,255,0.8)"; ctx.beginPath(); ctx.arc(W(snap.ball.x), H(snap.ball.y), 50 * v.zoom, 0, Math.PI * 2); ctx.fill()
            }
            drawEffects(false)
            // the attack areas: what hits, while it hits
            ctx.setLineDash([6, 4]); ctx.strokeStyle = "rgba(255,210,80,0.9)"; ctx.fillStyle = "rgba(255,210,80,0.08)"
            for (const a of snap.areas) {
                const k = a.shape?.[0], r1 = top(a.shape?.[1]) ?? 0, r2 = top(a.shape?.[2]) ?? 0
                ctx.save(); ctx.translate(W(a.x), H(a.y)); ctx.rotate(a.rot || 0); ctx.beginPath()
                if (k === "Rectangle") ctx.rect(-r1 / 2 * v.zoom, -r2 / 2 * v.zoom, r1 * v.zoom, r2 * v.zoom)
                else if (k === "Sector") { ctx.moveTo(0, 0); ctx.arc(0, 0, r1 * v.zoom, -Math.PI / 2 - r2 / 2, -Math.PI / 2 + r2 / 2); ctx.closePath() }
                else ctx.arc(0, 0, r1 * v.zoom, 0, Math.PI * 2)
                ctx.fill(); ctx.stroke(); ctx.restore()
            }
            ctx.setLineDash([])
            // the cut-in moment
            if (snap.frame < this.sim.cutin) { ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "12px sans-serif"; ctx.fillText("cut-in (the game shows the skill's picture here)", 8, 16) }
        }
    }
    const api = { simulate, SkillStage, effectFrame, CUTIN }
    if (typeof module !== "undefined") module.exports = api
    else root.SkillPreview = api
})(typeof window !== "undefined" ? window : globalThis)

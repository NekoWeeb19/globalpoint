// The game's summon ball field, run from its own code (converted by transpile.cjs into physics.js, not in git).
//   const { loadConfigs, runField } = require("./field.cjs")
//   const configs = await loadConfigs()               // gacha/<movie>.gacha from the CN game files
//   runField(seed, configs.fes) -> { rarity: 0 | 1 | 2 (3★/4★/5★), movie: true when the ball movie plays }
const fs = require("fs"), path = require("path"), zlib = require("zlib")

// the few Haxe helpers the field touches (jp.sipo.gipo), enough to run it
class GenericGearDispatcher {
    constructor(preset, once) { this.handlers = null; this.once = once; this.executingHandlers = null; this.executingIndex = -1 }
    get_executing() { return this.executingIndex >= 0 }
    clear() { this.handlers = null }
    addBehavior(list, h) { list.push(h) }
}
globalThis.GenericGearDispatcher = GenericGearDispatcher
globalThis.AddBehaviorPreset = { addTail: 0 }
globalThis.GearDispatcherHandler = class { constructor(f) { this.func = f } }
globalThis.SipoError = class extends Error {}
globalThis.Reflect.hasField = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

const PHYSICS = path.join(__dirname, "physics.js")
let P = null
function physics() {
    if (P) return P
    if (!fs.existsSync(PHYSICS)) throw new Error("physics.js is missing: run node scripts/gacha_seeds/transpile.cjs first")
    P = require(PHYSICS)
    // set up by the game at boot (boot_ffc6)
    for (const k of ["tmp1", "tmp2", "out1", "out2"]) P.Distance[k] = new P.GJKVertex()
    return P
}

/** The field configs (movie name -> config) from the CN game files. */
async function loadConfigs(names = ["normal", "normal_guarantee", "fes", "fes_guarantee"]) {
    const { readCn } = require("../cn_read.cjs")
    const { readAmf3 } = require("../amf3.cjs")
    const out = {}
    for (const name of names) {
        const raw = await readCn(`gacha/${name}.gacha.amf3.deflate`)
        if (!raw) throw new Error(`gacha/${name}.gacha is not in the CN game files`)
        let data
        try { data = zlib.inflateRawSync(raw) } catch { data = zlib.inflateSync(raw) }
        out[name] = readAmf3(data)
    }
    return out
}

/**
 * The ball's starting rarity, from the seed alone (FallingField.createBall's third draw, FixedFallingField.initBallRarity)
 * without building the physics world. The game's Mersenne Twister: Haxe Int maths, warmed up by 624 draws.
 */
function startRarity(seed, config) {
    if (config.threshold.isRarity5) return 2
    const mt = [seed | 0]
    for (let i = 1; i < 624; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) | 0
    let index = 0
    const next = () => {
        const i = index
        let y = mt[i] | 0
        index = (i + 1) % 624
        const z = (y & -2147483648) | (mt[index] & 0x7fffffff)
        mt[i] = (mt[(i + 397) % 624] ^ (z >>> 1) ^ (-1727483681 & (~(z & 1) + 1))) | 0
        y ^= y >>> 11; y ^= (y << 7) & -1658038656; y ^= (y << 15) & -272236544; y ^= y >>> 18
        return (y >>> 0) / 4294967296
    }
    for (let i = 0; i < 624; i++) next()
    next(); next() // ball x, ejection angle
    return next() > config.threshold.ballStar4 ? 1 : 0
}

/**
 * Runs one seed the way BallMovie.precalculateFieldResult does. With maxRarity, a seed whose ball already starts above
 * it returns { skipped: true } without building the field (the ball's rarity only goes up).
 */
function runField(seed, config, maxRarity = 2) {
    if (maxRarity < 2) {
        const start = startRarity(seed, config)
        if (start > maxRarity) return { rarity: start, skipped: true }
    }
    const { FixedFallingField } = physics()
    const cfg = { ...config, seed }
    const field = new FixedFallingField(cfg, cfg.threshold)
    if (field.moviePlayable) {
        let frames = 0
        while (!field.finished) { field.update(); if (++frames > 100000) throw new Error(`seed ${seed} never finished`) }
    }
    return { rarity: field.ball.rarity, movie: field.moviePlayable }
}

module.exports = { loadConfigs, runField }

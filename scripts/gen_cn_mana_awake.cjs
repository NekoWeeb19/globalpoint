// CN's mana node awakening ("Awake" board): data for src/nya/manaAwake.ts and the awake missions.
//
// How it works in the CN client (and the Chinese fork, lib/character-growth/commands/awake-mana-nodes.ts):
// - 36 units have 4 awake missions each (master/mission/character_awake_mission, ids <unit><n><step>):
//   three tasks and a "complete all" (kind 13). Finishing the "complete all" unlocks awake level 1 of
//   board 1 for the unit (its reward row: column 1 = 0, then unit, board, awake level).
// - With it unlocked, each board-1 node can be awakened (character/awake_mana_node). The cost depends
//   on the unit's rarity, the node's slot (1-3 ability, 4 = skill/other) and its pedestal size (column
//   4 of master/generated/mana_board): master/mana_board/mana_node_awake "<rarity>/<slot>/<pedestal>"
//   = item ids, item counts, mana.
//
// Awake mission columns (params = column - 5, as in the other mission tables):
//   4 kind, 5 sub-kind (17 = no ally knocked out), 7 battle mode (1 solo, 2 co-op, 3 either),
//   9..12 quest range (kind, query 1..3), 13 the boss quest's difficulty, 16 the unit (read all
//   episodes / all bond tokens), 23 required leader, 24 required party members, 25 required races,
//   26 episode quest ids (kind 96); 19 the target missions of a "complete all" (kind 13).
//
//   node --env-file=.env scripts/gen_cn_mana_awake.cjs   -> assets/mana_awake_cn.json
const fs = require("fs")
const path = require("path")
const R = require("./cdn_rows.cjs")
const { readCnTable } = require("F:/WF client/tools/cn_read.cjs")

const OUT = path.join(__dirname, "..", "assets", "mana_awake_cn.json")
const NONE = v => v === undefined || v === "" || v === "(None)"
const num = v => (NONE(v) ? undefined : Number(v))
const list = v => (NONE(v) ? undefined : String(v).split(",").map(x => x.trim()).filter(Boolean))

;(async () => {
    const rows = async t => Object.entries(await readCnTable(t)).map(([k, v]) => [k, R.splitCsv(v.replace(/\n$/, ""))])

    // units: rarity and races
    const units = {}
    for (const [id, c] of await rows("master/character/character.orderedmap")) units[id] = { rarity: Number(c[2]), races: list(c[4]) ?? [] }

    // board-1 nodes: slot (mana_node column 6) and pedestal size (generated/mana_board column 4)
    const pedestal = {}
    for (const [key, c] of await rows("master/generated/mana_board.orderedmap")) {
        const [unit, board] = key.split("/")
        if (board === "1") pedestal[c[0]] = Number(c[4])
    }
    const nodes = {}
    for (const [key, c] of await rows("master/mana_board/mana_node.orderedmap")) {
        const [unit, board] = key.split("/")
        if (board !== "1") continue
        const slot = c[6] === "1" || c[6] === "2" || c[6] === "3" ? Number(c[6]) : 4
        ;(nodes[unit] ??= {})[c[0]] = { slot, pedestal: pedestal[c[0]] ?? 0 }
    }

    // costs: rarity -> slot -> pedestal -> { items, mana }
    const costs = {}
    for (const [key, c] of await rows("master/mana_board/mana_node_awake.orderedmap")) {
        const [rarity, slot, ped] = key.split("/")
        const ids = list(c[0]) ?? [], counts = list(c[1]) ?? []
        const items = {}
        ids.forEach((id, i) => { items[id] = Number(counts[i]) })
        ;((costs[rarity] ??= {})[slot] ??= {})[ped] = { items, mana: Number(c[2]) }
    }

    // awake missions
    const rewardRows = {}
    for (const [key, c] of await rows("master/mission/character_awake_mission_reward.orderedmap")) {
        const [id, stage] = key.split("/")
        ;(rewardRows[id] ??= {})[stage] = c
    }
    const missions = {}
    for (const [id, c] of await rows("master/mission/character_awake_mission.orderedmap")) {
        const kind = Number(c[4])
        const stages = {}, requirements = {}
        let unlock
        for (const [stage, r] of Object.entries(rewardRows[id] ?? {})) {
            requirements[stage] = Number(r[5]) || 1
            const rewards = []
            for (let at = 9; at + 2 < r.length; at += 6) {
                if (NONE(r[at])) continue
                const type = Number(r[at]), amount = Number(r[at + 1])
                if (type === 1 && !NONE(r[at + 2])) rewards.push({ type: "item", id: Number(r[at + 2]), amount })
                else if (type === 0) rewards.push({ type: "free_vmoney", amount })
                else if (type === 3) rewards.push({ type: "free_mana", amount })
            }
            stages[stage] = rewards
            if (r[1] === "0") unlock = { character: Number(r[2]), board: Number(r[3]), level: Number(r[4]) }
        }
        const rule = {
            kind,
            ...(NONE(c[5]) ? {} : { sub: Number(c[5]) }),
            ...(NONE(c[7]) ? {} : { mode: Number(c[7]) }),
            ...(NONE(c[9]) ? {} : { range: [Number(c[9]), NONE(c[10]) ? null : c[10], NONE(c[11]) ? null : c[11], NONE(c[12]) ? null : c[12]] }),
            ...(NONE(c[13]) ? {} : { difficulty: Number(c[13]) }),
            ...(NONE(c[16]) ? {} : { character: Number(c[16]) }),
            ...(NONE(c[23]) ? {} : { leader: Number(c[23]) }),
            ...(NONE(c[24]) ? {} : { members: list(c[24]).map(Number) }),
            ...(NONE(c[25]) ? {} : { races: list(c[25]) }),
            ...(NONE(c[26]) ? {} : { list: list(c[26]).map(Number) }),
            ...(kind === 13 && !NONE(c[19]) ? { list: list(c[19]).map(Number) } : {}),
        }
        // kind 15 ("clear within N seconds"): the limit is the reward row's column 6 (seconds)
        const firstReward = Object.values(rewardRows[id] ?? {})[0]
        if (kind === 15 && firstReward && !NONE(firstReward[6])) rule.timeLimit = Number(firstReward[6])
        missions[id] = { name: c[2], text: c[3], rule, requirements, stages, ...(unlock ? { unlock } : {}) }
    }

    fs.writeFileSync(OUT, JSON.stringify({ _note: "Built by scripts/gen_cn_mana_awake.cjs (CN node awakening + awake missions).", units, nodes, costs, missions }))
    const kinds = {}
    for (const m of Object.values(missions)) kinds[m.rule.kind] = (kinds[m.rule.kind] ?? 0) + 1
    console.log(`Wrote ${OUT}: ${Object.keys(nodes).length} units' board-1 nodes, ${Object.keys(missions).length} awake missions (kinds ${JSON.stringify(kinds)}), ${Object.values(missions).filter(m => m.unlock).length} unlocks`)
})().catch(e => { console.error(e); process.exit(1) })

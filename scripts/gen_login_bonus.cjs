// Builds assets/login_bonus.json (daily login bonuses) from the global client's own master table
// (see scripts/cdn_master.cjs).
//
//   node scripts/gen_login_bonus.cjs
//
// master/bonus/login_bonus is nested: bonus group id -> day index (1, 2, ...) -> one row of 47 columns.
// Columns (global client; the Chinese fork's 48-column layout has the dates one column later):
//   0 group type (0 Normal, 1 Limited, 2 Comeback, 3 ComebackAlways, 4 ActiveUser)
//   6.. up to 7 reward slots of 4 columns (kind, amount, item id, character id), kind 0 beads,
//       1 item, 2 character, 3 mana, 4 EXP
//   38/39 comeback condition period, 40/41 open from/until (UTC, like the other master dates),
//   42/43 a yearly window inside that ("MM-DD hh:mm:ss"), 45 linked comeback group (ActiveUser)

const path = require("path")
const fs = require("fs")
const { ROOT, readTable, parseCsvLine, str, int } = require("./cdn_master.cjs")

const OUT = path.join(ROOT, "assets", "login_bonus.json")
const TYPES = ["Normal", "Limited", "Comeback", "ComebackAlways", "ActiveUser"]
const COLUMNS = 47

;(async () => {
    const table = await readTable("master/bonus/login_bonus.orderedmap", true)
    const groups = {}
    for (const [groupId, rows] of Object.entries(table)) {
        const indexes = Object.keys(rows).map(Number).sort((a, b) => a - b)
        if (indexes.some((index, i) => index !== i + 1)) throw new Error(`${groupId}: day indexes should be 1, 2, 3...`)
        const lines = indexes.map(index => parseCsvLine(rows[String(index)]))
        for (const c of lines) if (c.length !== COLUMNS) throw new Error(`${groupId}: expected ${COLUMNS} columns, got ${c.length}.`)

        const first = lines[0]
        const type = TYPES[int(first[0])]
        if (type === undefined) throw new Error(`${groupId}: unknown group type ${first[0]}.`)
        for (const c of lines) {
            if (c[0] !== first[0] || c[40] !== first[40] || c[41] !== first[41]) throw new Error(`${groupId}: days disagree on type or dates.`)
        }
        const start = str(first[40])
        if (start === null) throw new Error(`${groupId}: no start date.`)

        const days = lines.map((c, i) => {
            const rewards = []
            for (let slot = 0; slot < 7; slot++) {
                const col = 6 + slot * 4
                const kind = int(c[col])
                if (kind === null) continue
                if (kind < 0 || kind > 4) throw new Error(`${groupId} day ${i + 1}: unknown reward kind ${c[col]}.`)
                const amount = int(c[col + 1])
                if (amount === null || amount <= 0) throw new Error(`${groupId} day ${i + 1}: bad amount ${c[col + 1]}.`)
                const reward = { kind, amount }
                if (kind === 1) reward.id = int(c[col + 2])
                if (kind === 2) reward.id = int(c[col + 3])
                if ((kind === 1 || kind === 2) && !(reward.id > 0)) throw new Error(`${groupId} day ${i + 1}: reward kind ${kind} has no id.`)
                rewards.push(reward)
            }
            if (rewards.length === 0) throw new Error(`${groupId} day ${i + 1}: no rewards.`)
            return rewards
        })

        groups[groupId] = {
            type,
            start,
            end: str(first[41]),
            yearlyFrom: str(first[42]),
            yearlyUntil: str(first[43]),
            linkedComeback: str(first[45]),
            days,
        }
    }
    fs.writeFileSync(OUT, JSON.stringify({ groups }, null, 2) + "\n")
    const byType = {}
    for (const g of Object.values(groups)) byType[g.type] = (byType[g.type] ?? 0) + 1
    console.log(`Wrote ${Object.keys(groups).length} login bonus groups to ${path.relative(ROOT, OUT)}: ${JSON.stringify(byType)}`)
})().catch(e => { console.error(e); process.exit(1) })

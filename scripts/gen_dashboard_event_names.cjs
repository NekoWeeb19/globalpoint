// The dashboard's Chinese event and summon banner names (scripts/i18n/zh/event_names.json, built into the dashboard's
// dictionary by scripts/build_dashboard_i18n.cjs): each English name in the event catalogs (assets/event_catalog.json,
// event_catalog_cn.json) with CN's own name for the same key (assets/event_names_zh.json). An English name that stands
// for events with different Chinese names takes the first one found; names CN doesn't have stay English.
//
//   node scripts/gen_dashboard_event_names.cjs
const fs = require("fs")
const path = require("path")

const A = path.join(__dirname, "..", "assets")
const zh = JSON.parse(fs.readFileSync(path.join(A, "event_names_zh.json"), "utf8")).names
const out = { _note: "Built by scripts/gen_dashboard_event_names.cjs: event and banner names from CN's own Chinese names." }
let names = 0
for (const file of ["event_catalog.json", "event_catalog_cn.json"]) {
    const catalog = JSON.parse(fs.readFileSync(path.join(A, file), "utf8"))
    const events = Array.isArray(catalog.events) ? catalog.events : Object.values(catalog.events ?? {})
    for (const e of events) {
        const add = (key, en) => {
            const cn = zh[String(key).replace(/-cn$/, "")]
            // a CN name still in Japanese (kana) helps nobody: the English one stays
            if (!en || !cn || out[en] !== undefined || /^_/.test(en) || /[ぁ-ゖァ-ヺ]/.test(cn)) return
            out[en] = cn
            names++
        }
        add(e.key, e.name)
        for (const b of e.bannerInfo ?? e.banners ?? []) if (b?.id) add(`gacha:${b.id}`, b.name)
    }
}
fs.writeFileSync(path.join(__dirname, "i18n", "zh", "event_names.json"), JSON.stringify(out, null, 1) + "\n")
console.log(`${names} names -> scripts/i18n/zh/event_names.json`)

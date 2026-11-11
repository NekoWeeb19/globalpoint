const R = require("./cdn_rows.cjs"); const { readCnTable } = require("./cn_read.cjs")
;(async () => {
  const g = await readCnTable("master/gacha/gacha.orderedmap")
  for (const id of ["1", "61"]) { const c = R.splitCsv(g[id].replace(/\n$/, "")); console.log("gacha", id, c[0], "| list pic", c[3], "| start/end", c[29], c[30], c[31]) }
  const fc = await readCnTable("master/gacha/gacha_feature_content.orderedmap")
  const keys = Object.keys(fc)
  console.log("feature content key sample:", keys.slice(0, 3), "total", keys.length)
  for (const k of keys.filter(k => k.split("/")[0] === "61" || k.split("/")[0] === "1")) console.log("feature", k, fc[k].replace(/\n/g, " | ").slice(0, 300))
})()

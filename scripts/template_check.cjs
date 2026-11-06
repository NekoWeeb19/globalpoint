// The game's text templates (haxe.Template: ::value::, ::if (x)::, ::elseif (x)::, ::else::, ::end::, ::foreach x::):
// a template whose blocks don't close crashes the game where it shows the text (e.g. U_f72d75 "Unclosed 'else'"
// on the team screen, from an ability piece). templateProblem says what's wrong (null when it parses);
// repairTemplate fixes the two ways global's English pieces break: a block marker with one colon (":if x::")
// and a missing ::end::.
//
//   node scripts/template_check.cjs <translated dir>   lists every row of every table with a broken template

// haxe.Template's expression marker: ::expr:: where expr has no ':'
const EXPR = /::([A-Za-z0-9_ ()&|!+=\/><*."',\-]+)::/g

function templateProblem(text) {
    if (typeof text !== "string" || !text.includes("::")) return null
    const stack = []
    for (const m of text.matchAll(EXPR)) {
        const e = m[1].trim()
        if (/^if[ (]/.test(e) || /^foreach /.test(e)) stack.push(e.startsWith("if") ? "if" : "foreach")
        else if (/^elseif[ (]/.test(e) || e === "else") {
            if (stack.at(-1) !== "if" && stack.at(-1) !== "else") return `'${e}' outside an if`
            if (e === "else") stack[stack.length - 1] = "else"
        } else if (e === "end") {
            if (stack.length === 0) return "'end' with nothing to close"
            stack.pop()
        }
    }
    if (stack.length > 0) return `unclosed '${stack.at(-1)}'`
    return null
}

/** The template repaired (or unchanged when it was fine or can't be repaired: check templateProblem again). */
function repairTemplate(text) {
    if (templateProblem(text) === null) return text
    // ":if x::" (one colon) -> "::if x::"
    let out = text.replace(/(^|[^:]):(if[ (]|elseif[ (]|else::|end::|foreach )/g, "$1::$2")
    const problem = templateProblem(out)
    if (problem && problem.startsWith("unclosed")) {
        // close what's open: before the trailing "::if (isBeforeInstantTrigger)::" piece ending when there is
        // one (it closes the sentence), else at the end
        let open = 0
        for (const m of out.matchAll(EXPR)) { const e = m[1].trim(); if (/^(if[ (]|foreach )/.test(e)) open++; else if (e === "end") open-- }
        const ends = "::end::".repeat(Math.max(0, open))
        const at = out.lastIndexOf("::if (isBeforeInstantTrigger)::")
        out = at >= 0 && templateProblem(out.slice(0, at) + ends + out.slice(at)) === null ? out.slice(0, at) + ends + out.slice(at) : out + ends
    }
    return out
}

module.exports = { templateProblem, repairTemplate }

if (require.main === module) {
    const fs = require("fs")
    const path = require("path")
    const R = require("./cdn_rows.cjs")
    const dir = process.argv[2] ?? require("./cn_archives.cjs").cnTextDir()
    const files = JSON.parse(fs.readFileSync(path.join(dir, "files.json"), "utf8"))
    let bad = 0
    for (const f of files) {
        const file = f.from && fs.existsSync(f.from) ? f.from : path.join(dir, f.path)
        if (!fs.existsSync(file)) continue
        let tree
        try { tree = R.decodeFile(fs.readFileSync(file)) } catch { continue }
        for (const { path: keys, leaf } of R.leaves(tree)) {
            for (const cell of R.splitCsv(leaf.text.replace(/\n$/, ""))) {
                const problem = templateProblem(cell)
                if (!problem) continue
                bad++
                const fixed = repairTemplate(cell)
                console.log(`${f.path} ${keys.join("/")}: ${problem}${templateProblem(fixed) === null ? " (repairable)" : " (NOT repairable)"}\n    ${cell.slice(0, 200)}`)
            }
        }
    }
    console.log(`${bad} broken template(s) in ${files.length} tables`)
}

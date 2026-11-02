// The comics pack for the phone companion app: same as `node scripts/build_pack.cjs comics ...`.
//   node scripts/build_comics_pack.cjs <out.zip> [comics folder]
const path = require("path")
const [out, comics] = process.argv.slice(2)
if (!out) { console.error("usage: node scripts/build_comics_pack.cjs <out.zip> [comics folder]"); process.exit(1) }
process.argv = [process.argv[0], path.join(__dirname, "build_pack.cjs"), "comics", out, ...(comics ? ["--comics", comics] : [])]
require("./build_pack.cjs")

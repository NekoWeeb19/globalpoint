import { existsSync } from "fs"
import path from "path"

const serverRoot = path.join(__dirname, "..", "..")
const shipped = path.join(serverRoot, "assets")

/**
 * The CN data the schedule rebuilds (missions_cn.json, cn_shops.json, pass_card_cn.json, from
 * scripts/gen_cn_*.cjs): in CN_GENERATED_DIR (relative paths are from the server folder) when set and
 * the file is there, else the server's own assets folder (the copy that ships with it).
 */
export function cnGeneratedFile(name: string): string {
    const dir = process.env.CN_GENERATED_DIR
    if (dir) {
        const file = path.join(path.resolve(serverRoot, dir), name)
        if (existsSync(file)) return file
    }
    return path.join(shipped, name)
}

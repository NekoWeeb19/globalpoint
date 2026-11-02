// The patched CN client (scripts/client_mod/patch_cn_client.cjs) calls StarPoint at /cn/api/index.php,
// next to the global client's /latest/api/index.php, so the two can be told apart. Its game files are
// the CN CDN (CN_CDN_DIR, default .cdn/cn in the server folder), served at /cn/cdn.
//
// Most of the CN-only reply shapes here come from the Chinese StarPoint fork (startpoint-cn,
// src/routes/cn), which plays the official CN 1.8.1 client.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs"
import { chosenAccount } from "../nya/activeAccounts"
import path from "path"
import { AsyncLocalStorage } from "async_hooks"

export const CN_PREFIX = "/cn"
export const CN_CDN_PREFIX = CN_PREFIX + "/cdn"

/**
 * The CN client's version file (/shijtswy/version/client_release_android.dis): a comment line, then
 * JSON naming the API host. `host` is the address the client reached StarPoint at (its Host header),
 * so the reply works from an emulator (127.0.0.1:8000) and a phone (LAN address) alike.
 */
export function cnVersionFile(host: string): string {
    return ["// 用于官服正式用", JSON.stringify({ default: { apiPath: host + CN_PREFIX, apiScheme: "http" } })].join("\r\n")
}

// whether the request being handled came from the CN client, for code with no request at hand
// (the mission data: src/nya/mission.ts). Set for every request by a hook in server.ts.
const cnRequestContext = new AsyncLocalStorage<boolean>()

/** Runs the rest of a request's handling knowing whether it came from the CN client. */
export function runInCnContext(cn: boolean, next: () => void) {
    cnRequestContext.run(cn, next)
}

/** Header a route sets when it passes a CN request on to another route with fastify.inject. */
export const CN_INTERNAL_HEADER = "x-starpoint-cn"

/** Whether the request being handled came from the CN client. */
export function inCnRequest(): boolean {
    return cnRequestContext.getStore() === true
}

/** Whether a request URL (as the client sent it) came from the CN client. */
export function isCnRequest(url: string | undefined): boolean {
    if (!url) return false
    return url === CN_PREFIX || url.startsWith(CN_PREFIX + "/")
}

/** The global API URL a CN client URL is served by, or null when it is not a CN API call. */
/** The API path of a CN client URL ("single_battle_quest/finish"), or "" when it is not an API call. */
export function cnApiPath(url: string | undefined): string {
    const api = CN_PREFIX + "/api/index.php/"
    if (!url || !url.startsWith(api)) return ""
    return url.slice(api.length).split("?")[0]
}

export function cnApiUrl(url: string): string | null {
    const api = CN_PREFIX + "/api/index.php"
    if (url !== api && !url.startsWith(api + "/") && !url.startsWith(api + "?")) return null
    return "/latest/api/index.php" + url.slice(api.length)
}

/**
 * The account the CN client plays on (CN_ACCOUNT_ID in .env), so it opens the same save as the
 * global client. Null when not set: each CN device then gets its own new account.
 */
export function cnLinkedAccountId(): number | null {
    // the dashboard's Players tab switch wins over .env
    const chosen = chosenAccount("cn")
    if (chosen !== undefined) return chosen
    const raw = process.env.CN_ACCOUNT_ID
    if (raw === undefined || raw.trim() === "") return null
    const id = Number.parseInt(raw)
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

// ---- CN game files (CDN) ----

/** Folder with the unpacked CN CDN (archive-*-full/diff, entities, path): CN_CDN_DIR (relative paths
 *  are from the server folder), else .cdn/cn there. */
export function cnCdnRoot(): string {
    return path.resolve(path.join(__dirname, "..", ".."), process.env.CN_CDN_DIR || path.join(".cdn", "cn"))
}

interface CnArchive { location: string, size: number, sha256: string }
interface CnPathFile {
    info: {
        client_asset_version: string,
        target_asset_version: string,
        eventual_target_asset_version: string,
        is_initial: boolean,
        latest_maj_first_version: string
    },
    full: { version: string, archive: CnArchive[] } | null,
    diff: { version: string, original_version: string, archive: CnArchive[] }[] | null,
    asset_version_hash: string
}

// the official answer's download address; replaced by StarPoint's own
const OFFICIAL_CDN = "https://shijtswydl.leiting.com/patch/gf/upload_assets"

let pathFileCache: CnPathFile | null = null
/** The official CN get_path answer for a fresh install (the CDN's "path" file). */
function cnPathFile(): CnPathFile {
    if (pathFileCache) return pathFileCache
    pathFileCache = JSON.parse(readFileSync(path.join(cnCdnRoot(), "path"), "utf8")) as CnPathFile
    return pathFileCache
}

// StarPoint's own updates after CN's 1.4.54 (English art and text, ...), from scripts/build_cn_patch.cjs:
// .cdn/cn_patches/patches.json + the zips beside it, served at /cn/patch
export const CN_PATCH_PREFIX = CN_PREFIX + "/patch"
export function cnPatchDir(): string {
    return path.join(cdnDir(), "cn_patches")
}

/** The server's game-files folder (CDN_DIR, relative paths are from the server folder; default .cdn):
 *  StarPoint's CN patches, comics and the dashboard's pictures live in it. */
export function cdnDir(): string {
    return path.resolve(path.join(__dirname, "..", ".."), process.env.CDN_DIR || ".cdn")
}
interface CnPatch { version: string, from: string, archives: { file: string, size: number, sha256: string }[] }
let patchCache: { mtime: number, patches: CnPatch[] } | null = null
/** The patches, in order (re-read when patches.json changes). */
export function cnPatches(): CnPatch[] {
    const file = path.join(cnPatchDir(), "patches.json")
    try {
        const mtime = statSync(file).mtimeMs
        if (patchCache && patchCache.mtime === mtime) return patchCache.patches
        const patches = (JSON.parse(readFileSync(file, "utf8")) as CnPatch[])
            .sort((a, b) => compareVersions(a.version, b.version))
        patchCache = { mtime, patches }
        return patches
    } catch {
        return []
    }
}

/** The CN game files' version the client should have: CN's 1.4.54, or StarPoint's newest patch. */
export function cnAssetVersion(): string {
    const patches = cnPatches()
    if (patches.length > 0) return patches[patches.length - 1].version
    try {
        return cnPathFile().info.target_asset_version
    } catch {
        return "1.4.54"
    }
}

/** The address the CN client downloads game files from, as reached through `host`. */
export function cnCdnBaseUrl(host: string): string {
    return `http://${host}${CN_CDN_PREFIX}`
}

/** Compares "1.4.12"-style versions. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(n => Number.parseInt(n)), pb = b.split(".").map(n => Number.parseInt(n))
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (d !== 0) return d
    }
    return 0
}

// Android only: the official list also names the iOS archives.
const forAndroid = (archives: CnArchive[], base: string): CnArchive[] => archives
    .filter(a => !a.location.includes("/archive-ios-"))
    .map(a => ({ ...a, location: a.location.replace(OFFICIAL_CDN, base) }))

/**
 * The CN client's /asset/get_path answer. `resVer` is the game files' version the client has (its
 * RES_VER header): none = a fresh install (everything: the 1.4.0 base and every update to 1.4.54),
 * the newest = nothing to download, an older one = the updates after it.
 */
export function cnPathList(host: string, resVer: string | undefined): CnPathFile {
    const file = cnPathFile()
    const target = cnAssetVersion()
    const base = cnCdnBaseUrl(host)
    const patchBase = `http://${host}${CN_PATCH_PREFIX}`
    const info = (client: string, initial: boolean) => ({
        client_asset_version: client,
        target_asset_version: target,
        eventual_target_asset_version: target,
        is_initial: initial,
        latest_maj_first_version: file.info.latest_maj_first_version,
    })
    // oldest update first, so they apply in order (the official file lists them out of order)
    const updates = [
        ...[...(file.diff ?? [])].sort((a, b) => compareVersions(a.version, b.version)),
        // StarPoint's patches come after CN's own updates (already full addresses, so the
        // official-address rewrite below leaves them alone)
        ...cnPatches().map(p => ({
            version: p.version,
            original_version: p.from,
            archive: p.archives.map(a => ({ location: `${patchBase}/${a.file}`, size: a.size, sha256: a.sha256 })),
        })),
    ]
    const known = resVer !== undefined && /^\d+\.\d+\.\d+$/.test(resVer)
        && compareVersions(resVer, file.info.latest_maj_first_version) >= 0 && compareVersions(resVer, target) <= 0

    if (known && resVer === target) {
        return { info: info(target, false), full: null, diff: null, asset_version_hash: "" }
    }
    if (known) {
        // the client takes an update only when its original_version is the version it has: follow the
        // chain from resVer. A version the chain skips (patches squashed into one since the client last
        // updated) gets the update that covers it, labelled as starting from the client's version; a
        // patch holds the newest copy of every file it changes since its own start, so that is safe.
        const diff: typeof updates = []
        let current = resVer!
        while (compareVersions(current, target) < 0) {
            const next = updates.find(d => d.original_version === current && compareVersions(d.version, current) > 0)
                ?? updates.find(d => compareVersions(d.version, current) > 0 && compareVersions(d.original_version, current) <= 0)
            if (!next) break
            diff.push({ ...next, original_version: current, archive: forAndroid(next.archive, base) })
            current = next.version
        }
        if (current === target) return { info: info(resVer!, false), full: null, diff, asset_version_hash: "" }
        // no way from resVer to the newest version: download everything, as a fresh install
    }
    return {
        info: info(file.info.client_asset_version, true),
        full: file.full ? { version: file.full.version, archive: forAndroid(file.full.archive, base) } : null,
        diff: updates.map(d => ({ ...d, archive: forAndroid(d.archive, base) })),
        asset_version_hash: file.asset_version_hash,
    }
}

let installedBytesCache: number | null = null
/** Size of all CN game files once installed (from the CDN's file list). */
function cnInstalledBytes(): number {
    if (installedBytesCache !== null) return installedBytesCache
    let total = 0
    try {
        const dir = path.join(cnCdnRoot(), "entities")
        const csv = existsSync(dir) ? readdirSync(dir).find(f => /android_medium\.csv$/.test(f)) : undefined
        if (csv) for (const line of readFileSync(path.join(dir, csv), "utf8").split(/\r?\n/)) {
            const size = Number.parseInt(line.split(",")[2])
            if (!isNaN(size)) total += size
        }
    } catch { }
    installedBytesCache = total
    return total
}

/** The CN client's /asset/version_info (and /assetintitle/version_info_in_title) answer. */
export function cnVersionInfo(host: string) {
    const base = cnCdnBaseUrl(host)
    return {
        base_url: `${base}/`,
        files_list: `${base}/recovery/empty.csv`,
        total_size: cnInstalledBytes(),
        delayed_assets_size: 0,
    }
}

// ---- /load ----

/** Master-table date text in CN time (UTC+8), as the CN client shows it. */
export function cnDateText(date: Date): string {
    const d = new Date(date.getTime() + 8 * 3600 * 1000)
    const p = (n: number, w = 2) => String(n).padStart(w, "0")
    return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/**
 * Adds what the CN client's /load reads on top of the global reply (fields of CN-only features,
 * all off or empty here). From the CN fork's wrapOptionFields (src/routes/cn/load.ts).
 */
export function addCnLoadFields(d: Record<string, any>, host: string): Record<string, any> {
    d.available_asset_version = cnAssetVersion()
    if (d.user_info) {
        // the Growth Fund counts as bought (free, like the pass's premium track; src/nya/growthFund.ts)
        d.user_info.is_bought_fund_ex_quest = true
        d.user_info.is_bought_fund_main_quest = true
        d.user_info.is_bought_fund_laite = true
        d.user_info.is_bought_fund_laite2 = true
        d.user_info.is_bought_fund_laite3 = true
        d.user_info.is_newbie ??= false
        d.user_info.is_comeback ??= false
        d.user_info.month_card_remain_days ??= 0
        d.user_info.weekly_bonus_remain_days ??= 0
        d.user_info.monthly_payment_total ??= 0
        d.user_info.renewal_gift_remain_days ??= 0
    }
    if (d.user_option) {
        d.user_option.episode_encyclopedia_suggest_show ??= false
        d.user_option.server_push ??= false
        d.user_option.stamina ??= false
    }
    d.cn_crash_url = `http://${host}${CN_PREFIX}/crash`
    d.survey_url = ""
    d.qq_group_url = ""
    d.bug_report_url = ""
    d.enable_gift = false
    d.enable_customer_service = false
    d.enable_rename = true
    d.enable_delete_file = false
    d.enable_newbie = false
    d.enable_little_assistant = false
    d.mission_tips = false
    d.monthly_tip = false
    d.simple_payment_item_list = []
    d.premium_bonus_index_list = []
    d.premium_bonus_mailed_item_list = []
    d.ex_boost_draw_result ??= null
    d.pass_force_reward = false
    d.crazy_gacha_result_list ??= {}
    d.last_crazy_gacha_draw_result ??= []
    d.converted_gacha_list ??= []
    d.fund_receive_list ??= []
    d.login_info = {}
    d.tower_dungeon_list = []
    d.special_exchange_campaign_list = []
    d.win_lottery_active_mission_list = []
    d.stars_gacha_campaign_list ??= []
    d.favorite_party_group_list ??= []
    d.ranking_event_reward = []
    d.party_list = []
    d.payment_rebate_info = { expired_time: 0, status: 0, start_time: 0 }
    d.monthly_charge_bonus_info = { bonus_days: 0, expired_time: 0, init_time: 0, status: 0, start_time: 0 }
    d.comeback_campaign_boss_boost = { period_start_time: 0, period_end_time: 0 }
    d.unfinished_quest_list ??= []
    d.unfinished_multi_quest_list ??= []
    d.mission_info ??= []
    return d
}

// ---- reply shapes that differ on CN ----

// ids that exist in the CN game files' tables (scripts/gen_cn_ids.cjs); empty when the file is missing
let cnIdsCache: Record<string, Set<number>> | null = null
function cnIds(name: string): Set<number> | null {
    if (cnIdsCache === null) {
        cnIdsCache = {}
        try {
            const raw = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "assets", "cn_ids.json"), "utf8")) as Record<string, number[]>
            for (const [key, ids] of Object.entries(raw)) cnIdsCache[key] = new Set(ids)
        } catch { }
    }
    return cnIdsCache[name] ?? null
}

/**
 * Turns a global reply into the CN client's shape, for any reply (run on every msgpack reply to the CN
 * client, in server.ts). So far: learned mana nodes are { multiplied_id, awake_level } objects on CN
 * (awake_level = CN's node awakening, 0 here), plain node ids on global (the CN client stops with
 * error C8707 on a plain id).
 */
export function adaptCnReply(payload: unknown, api: string = ""): unknown {
    const data = (payload as { data?: Record<string, any> } | null)?.data
    if (!data || typeof data !== "object") return payload
    const nodes = data.user_character_mana_node_list
    if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
        for (const characterId of Object.keys(nodes)) {
            const list = nodes[characterId]
            if (Array.isArray(list)) nodes[characterId] = list.map(node =>
                typeof node === "number" ? { multiplied_id: node, awake_level: 0 } : node)
        }
    }
    // Daily Challenge points: an entry or campaign from global data the CN tables don't have stops
    // the CN client (error C8601, e.g. global campaign 2023013102)
    // shop items from global data the CN shop tables don't have (e.g. general shop 301132) stop the
    // CN shop screen (error C8601): left out of the sales list
    if (Array.isArray(data.sales_list)) {
        data.sales_list = data.sales_list.filter((entry: { shop_type?: number, shop_item_id?: number }) => {
            const ids = cnIds(`shop${entry?.shop_type}`)
            return ids === null || ids.has(Number(entry?.shop_item_id))
        })
    }
    // active missions CN's table doesn't have stop the CN home screen (C8601): the CN client looks
    // every id up in its active mission table. CN's unit awake missions (ids <unit><n><step>, unit 1's
    // are 11-14) are Mission screen missions (category 9, src/nya/manaAwake.ts), not listed here.
    const missionIds = cnIds("activeMission")
    if (missionIds) {
        const known = (id: unknown) => missionIds.has(Number(id))
        if (Array.isArray(data.active_mission_list)) data.active_mission_list = data.active_mission_list.filter((m: any) => known(m?.mission_id))
        const all = data.all_active_mission_list
        if (all && typeof all === "object" && !Array.isArray(all)) for (const id of Object.keys(all)) if (!known(id)) delete all[id]
    }
    const points = data.user_daily_challenge_point_list
    const pointIds = cnIds("dailyChallengePoint"), campaignIds = cnIds("dailyChallengePointCampaign")
    if (Array.isArray(points) && pointIds && campaignIds) {
        data.user_daily_challenge_point_list = points
            .filter(entry => pointIds.has(entry?.id))
            .map(entry => Array.isArray(entry.campaign_list)
                ? { ...entry, campaign_list: entry.campaign_list.filter((c: any) => campaignIds.has(c?.campaign_id)) }
                : entry)
    }
    conformCnReply(api, payload)
    return payload
}

/** The ids a CN game table has (assets/cn_ids.json, scripts/gen_cn_ids.cjs), or null when unknown. */
export function cnTableIds(name: string): ReadonlySet<number> | null {
    return cnIds(name)
}

// ---- the CN client's reply types (assets/cn_reply_schema.json, from scripts/gen_cn_reply_schema.cjs) ----

interface CnCheck { path: string, type: "int" | "float" | "string" | "bool" | "array" | "object", nullable: boolean }
let schemaCache: { common: CnCheck[], apis: Record<string, CnCheck[]> } | null = null
function cnSchema() {
    if (schemaCache === null) {
        try {
            schemaCache = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "assets", "cn_reply_schema.json"), "utf8"))
        } catch {
            schemaCache = { common: [], apis: {} }
        }
    }
    return schemaCache!
}

// "data.a[i].b[k].c" -> ["data", "a", "[i]", "b", "[k]", "c"]
const steps = (p: string) => p.split(/\.|(?=\[)/).filter(s => s.length > 0)

function typeOk(type: CnCheck["type"], value: unknown): boolean {
    switch (type) {
        case "int": return typeof value === "number" && Number.isInteger(value)
        case "float": return typeof value === "number"
        case "string": return typeof value === "string"
        case "bool": return typeof value === "boolean"
        case "array": return Array.isArray(value)
        // the client also takes an empty list where it wants an object
        case "object": return (value !== null && typeof value === "object" && !Array.isArray(value)) || (Array.isArray(value) && value.length === 0)
    }
}

const DEFAULTS: Record<CnCheck["type"], () => unknown> = {
    int: () => 0, float: () => 0, string: () => "", bool: () => false, array: () => [], object: () => ({}),
}

const mismatchLogPath = path.join(__dirname, "..", "..", "logs", "cn_type_mismatch.log")
const loggedMismatches = new Set<string>()
function logMismatch(api: string, check: CnCheck, value: unknown, fixed: boolean) {
    const key = `${api} ${check.path} ${fixed}`
    if (loggedMismatches.has(key)) return
    loggedMismatches.add(key)
    const shown = JSON.stringify(value)?.slice(0, 120)
    const line = `${new Date().toISOString()} ${api} ${check.path}: wants ${check.type}${check.nullable ? " or null" : ""}, got ${shown}${fixed ? " -> filled with default" : ""}`
    console.log(`[cn type] ${line}`)
    try {
        mkdirSync(path.dirname(mismatchLogPath), { recursive: true })
        appendFileSync(mismatchLogPath, line + "\n")
    } catch { }
}

/**
 * Checks a reply against the types the CN client requires for that API (and for every reply). A
 * required field that is missing or null gets a default (0, "", false, [], {}); any other wrong type
 * is written to logs/cn_type_mismatch.log (and the console), since the client stops with an error
 * (C8700-C8707) on it.
 */
export function conformCnReply(api: string, payload: unknown): void {
    const root = payload as Record<string, any> | null
    if (!root || typeof root !== "object" || !root.data || typeof root.data !== "object") return
    const schema = cnSchema()
    const checks = [...schema.common, ...(schema.apis[api] ?? [])]
        .sort((a, b) => steps(a.path).length - steps(b.path).length)
    for (const check of checks) {
        const s = steps(check.path)
        // the containers that hold the checked value
        let holders: any[] = [root]
        for (const step of s.slice(0, -1)) {
            const next: any[] = []
            for (const h of holders) {
                if (h === null || typeof h !== "object") continue
                if (step === "[i]") { if (Array.isArray(h)) next.push(...h) }
                else if (step === "[k]") { if (!Array.isArray(h)) next.push(...Object.values(h)) }
                else if (step in h) next.push(h[step])
            }
            holders = next
        }
        const last = s[s.length - 1]
        for (const h of holders) {
            if (h === null || typeof h !== "object") continue
            const values: [unknown, string | number | null][] = last === "[i]" ? (Array.isArray(h) ? h.map((v, i) => [v, i]) : [])
                : last === "[k]" ? (Array.isArray(h) ? [] : Object.entries(h).map(([k, v]) => [v, k]))
                : [[h[last], last]]
            for (const [value, key] of values) {
                if (value === undefined || value === null) {
                    if (check.nullable || last.startsWith("[")) continue
                    h[key as string] = DEFAULTS[check.type]()
                    logMismatch(api, check, value, true)
                } else if (!typeOk(check.type, value)) {
                    logMismatch(api, check, value, false)
                }
            }
        }
    }
}

/**
 * The years the CN update has yearly campaign copies for (.database/cn_copy_window.json, written by
 * scripts/gen_cn_event_schedule.cjs), or null when it hasn't been built with the window yet.
 */
/**
 * The yearly free pull copies the CN client's current update has (.database/cn_schedule_built.json, written
 * by scripts/gen_cn_event_schedule.cjs), or null for an update built before that was recorded.
 */
export function cnBuiltFreePullCopies(): Set<number> | null {
    try {
        const built = JSON.parse(readFileSync(path.join(process.cwd(), ".database", "cn_schedule_built.json"), "utf8"))
        return Array.isArray(built.freePullCopyIds) ? new Set(built.freePullCopyIds.map(Number)) : null
    } catch {
        return null
    }
}

export function cnCopyWindow(): { from: number, until: number } | null {
    try {
        const w = JSON.parse(readFileSync(path.join(process.cwd(), ".database", "cn_copy_window.json"), "utf8"))
        return typeof w.from === "number" && typeof w.until === "number" ? w : null
    } catch {
        return null
    }
}

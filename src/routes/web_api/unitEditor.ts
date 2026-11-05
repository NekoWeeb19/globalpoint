// The unit editor's API (dashboard page /unit-editor, docs/UNIT_EDITOR.md). The work is in scripts/unit_editor.cjs.
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "path";
import { rebuildCnUpdate } from "../../nya/eventSchedule";

interface Edit {
    abilities?: { key: string, lines: string[][] }[]
    leader?: { key: string, lines: string[][] } | null
    stats?: { level: string, hp: number, atk: number }[]
    skills?: { key: string, gaugeMin: number, gaugeMax: number }[]
    details?: { name?: string, title?: string, description?: string, class?: string, role?: string, leaderName?: string }
}
const UE = require(path.join(__dirname, "..", "..", "..", "scripts", "unit_editor.cjs")) as {
    listUnits: () => Promise<unknown[]>
    getUnit: (id: string) => Promise<unknown | null>
    editorData: () => Promise<unknown>
    unitLines: (id: string) => Promise<unknown | null>
    checkEdit: (edit: Edit, mode: Mode) => Promise<{ ok: boolean }>
    saveUnit: (id: string, edit: Edit, mode: Mode) => Promise<{ file?: string | null, rows?: number, errors?: unknown }>
    resetUnit: (id: string) => boolean
    exportKits: (ids: string[]) => object
    importKits: (data: unknown) => Promise<{ imported: string[], refused: { id: string, why: string }[] }>
    _internal: { gameTable: (logical: string) => Promise<Record<string, string>> }
}

// armaments (scripts/armament_editor.cjs): the same edit shape, abilities = slots
const AE = require(path.join(__dirname, "..", "..", "..", "scripts", "armament_editor.cjs")) as {
    listArmaments: () => Promise<unknown[]>
    getArmament: (id: string) => Promise<unknown | null>
    armamentLines: (id: string) => Promise<unknown | null>
    checkArmament: (id: string, edit: Edit, mode: Mode) => Promise<{ ok: boolean }>
    saveArmament: (id: string, edit: Edit, mode: Mode) => Promise<{ file?: string | null, rows?: number, errors?: unknown }>
    resetArmament: (id: string) => boolean
    exportArmamentKits: (ids: string[]) => object
    importArmamentKits: (data: unknown) => Promise<{ imported: string[], refused: { id: string, why: string }[] }>
}

type Mode = string | boolean
// the editor's mode: "default", "advanced" or "unrestricted" (older pages send advanced: true = unrestricted)
const modeOf = (b: { advanced?: boolean, mode?: string }): Mode => typeof b.mode === "string" ? b.mode : b.advanced === true

const failed = (reply: FastifyReply, e: unknown) =>
    reply.status(500).send({ error: "Unit editor", message: e instanceof Error ? e.message : String(e) })

// the game's items, id -> name (English when translated), for the dashboard's name search; read once
let itemNames: { id: string, name: string }[] | null = null
async function listItems() {
    if (itemNames !== null) return itemNames
    const table = await UE._internal.gameTable("master/item/item.orderedmap")
    const out: { id: string, name: string }[] = []
    for (const [id, text] of Object.entries(table)) {
        if (id.includes("/")) continue
        // dev name, id, name, ...; a quoted name keeps its commas
        const name = /^[^,]*,[^,]*,("(?:[^"]|"")*"|[^,]*)/.exec(text)?.[1]?.replace(/^"|"$/g, "").replace(/""/g, "\"").trim()
        if (name) out.push({ id, name })
    }
    itemNames = out.sort((a, b) => a.name.localeCompare(b.name))
    return itemNames
}

const routes = async (fastify: FastifyInstance) => {
    // id <-> name for units, armaments and items (Give and the Mail tab search by name)
    fastify.get("/names", async (_: FastifyRequest, reply: FastifyReply) => {
        try {
            const [units, armaments, items] = await Promise.all([UE.listUnits(), AE.listArmaments(), listItems()])
            const short = (list: unknown[], note: (x: Record<string, unknown>) => string) =>
                (list as Record<string, unknown>[]).map(x => ({ id: String(x.id), name: String(x.name), note: note(x) }))
            return reply.send({
                chara: short(units, u => [u.title, u.rarity ? u.rarity + "★" : "", u.element].filter(Boolean).join(" · ")),
                equip: short(armaments, a => a.rarity ? a.rarity + "★" : ""),
                item: items.map(i => ({ ...i, note: "" })),
            })
        } catch (e) { return failed(reply, e) }
    })
    fastify.get("/units", async (_: FastifyRequest, reply: FastifyReply) => {
        try { return reply.send(await UE.listUnits()) } catch (e) { return failed(reply, e) }
    })
    // codes, plain words, fields, templates and what CN's units use
    fastify.get("/data", async (_: FastifyRequest, reply: FastifyReply) => {
        try { return reply.send(await UE.editorData()) } catch (e) { return failed(reply, e) }
    })
    fastify.get("/unit/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        try {
            const unit = await UE.getUnit(id)
            return unit === null ? reply.status(404).send({ error: "Not Found", message: `No unit ${id}` }) : reply.send(unit)
        } catch (e) { return failed(reply, e) }
    })
    // another unit's lines, to copy one
    fastify.get("/lines/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        try {
            const lines = await UE.unitLines(id)
            return lines === null ? reply.status(404).send({ error: "Not Found", message: `No unit ${id}` }) : reply.send(lines)
        } catch (e) { return failed(reply, e) }
    })
    fastify.post("/check", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { edit?: Edit, advanced?: boolean, mode?: string }
        try { return reply.send(await UE.checkEdit(body.edit ?? {}, modeOf(body))) } catch (e) { return failed(reply, e) }
    })
    // saves (a change file, or the custom unit's file) and rebuilds the CN game update
    fastify.post("/unit/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const body = (request.body ?? {}) as { edit?: Edit, advanced?: boolean, mode?: string }
        try {
            const result = await UE.saveUnit(id, body.edit ?? {}, modeOf(body))
            if (result.errors) return reply.status(400).send({ error: "Bad Request", message: "Some lines can't be saved", check: result.errors })
            rebuildCnUpdate()
            return reply.send({ saved: result.rows ?? 0, file: result.file ?? null })
        } catch (e) { return failed(reply, e) }
    })
    // the editor's changes as one file (all units, or ?ids=1,2): itself a unit change file
    fastify.get("/kits", async (request: FastifyRequest, reply: FastifyReply) => {
        const { ids } = request.query as { ids?: string }
        const list = (ids ?? "").split(",").map(s => s.trim()).filter(Boolean)
        reply.header("content-disposition", `attachment; filename="unit-kits${list.length === 1 ? "-" + list[0] : ""}.json"`)
        return reply.type("application/json").send(JSON.stringify(UE.exportKits(list), null, 1))
    })
    // a kit file (exportKits' format or any unit change file) back in; rebuilds when anything came in
    fastify.post("/kits", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const result = await UE.importKits(request.body)
            if (result.imported.length > 0) rebuildCnUpdate()
            return reply.send(result)
        } catch (e) { return failed(reply, e) }
    })
    // ---- armaments ----
    fastify.get("/armaments", async (_: FastifyRequest, reply: FastifyReply) => {
        try { return reply.send(await AE.listArmaments()) } catch (e) { return failed(reply, e) }
    })
    fastify.get("/armament/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        try {
            const a = await AE.getArmament(id)
            return a === null ? reply.status(404).send({ error: "Not Found", message: `No armament ${id}` }) : reply.send(a)
        } catch (e) { return failed(reply, e) }
    })
    fastify.get("/armament-lines/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        try { const a = await AE.armamentLines(id); return a === null ? reply.status(404).send({ error: "Not Found", message: `No armament ${id}` }) : reply.send(a) } catch (e) { return failed(reply, e) }
    })
    fastify.post("/armament-check", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { id?: string, edit?: Edit, advanced?: boolean, mode?: string }
        try { return reply.send(await AE.checkArmament(String(body.id ?? ""), body.edit ?? {}, modeOf(body))) } catch (e) { return failed(reply, e) }
    })
    fastify.post("/armament/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const body = (request.body ?? {}) as { edit?: Edit, advanced?: boolean, mode?: string }
        try {
            const result = await AE.saveArmament(id, body.edit ?? {}, modeOf(body))
            if (result.errors) return reply.status(400).send({ error: "Bad Request", message: "Some lines can't be saved", check: result.errors })
            rebuildCnUpdate()
            return reply.send({ saved: result.rows ?? 0, file: result.file ?? null })
        } catch (e) { return failed(reply, e) }
    })
    fastify.post("/armament/:id/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const removed = AE.resetArmament(id)
        if (removed) rebuildCnUpdate()
        return reply.send({ reset: removed })
    })
    fastify.get("/armament-kits", async (request: FastifyRequest, reply: FastifyReply) => {
        const { ids } = request.query as { ids?: string }
        const list = (ids ?? "").split(",").map(s => s.trim()).filter(Boolean)
        reply.header("content-disposition", `attachment; filename="armament-kits${list.length === 1 ? "-" + list[0] : ""}.json"`)
        return reply.type("application/json").send(JSON.stringify(AE.exportArmamentKits(list), null, 1))
    })
    fastify.post("/armament-kits", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const result = await AE.importArmamentKits(request.body)
            if (result.imported.length > 0) rebuildCnUpdate()
            return reply.send(result)
        } catch (e) { return failed(reply, e) }
    })

    fastify.post("/unit/:id/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const removed = UE.resetUnit(id)
        if (removed) rebuildCnUpdate()
        return reply.send({ reset: removed })
    })
}

export default routes;

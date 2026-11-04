// The unit editor's API (dashboard page /unit-editor, docs/UNIT_EDITOR.md). The work is in scripts/unit_editor.cjs.
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "path";
import { rebuildCnUpdate } from "../../nya/eventSchedule";

interface Edit {
    abilities?: { key: string, lines: string[][] }[]
    leader?: { key: string, lines: string[][] } | null
    stats?: { level: string, hp: number, atk: number }[]
    skills?: { key: string, gaugeMin: number, gaugeMax: number }[]
}
const UE = require(path.join(__dirname, "..", "..", "..", "scripts", "unit_editor.cjs")) as {
    listUnits: () => Promise<unknown[]>
    getUnit: (id: string) => Promise<unknown | null>
    editorData: () => Promise<unknown>
    unitLines: (id: string) => Promise<unknown | null>
    checkEdit: (edit: Edit, advanced: boolean) => Promise<{ ok: boolean }>
    saveUnit: (id: string, edit: Edit, advanced: boolean) => Promise<{ file?: string | null, rows?: number, errors?: unknown }>
    resetUnit: (id: string) => boolean
}

const failed = (reply: FastifyReply, e: unknown) =>
    reply.status(500).send({ error: "Unit editor", message: e instanceof Error ? e.message : String(e) })

const routes = async (fastify: FastifyInstance) => {
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
        const body = (request.body ?? {}) as { edit?: Edit, advanced?: boolean }
        try { return reply.send(await UE.checkEdit(body.edit ?? {}, body.advanced === true)) } catch (e) { return failed(reply, e) }
    })
    // saves (a change file, or the custom unit's file) and rebuilds the CN game update
    fastify.post("/unit/:id", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string }
        const body = (request.body ?? {}) as { edit?: Edit, advanced?: boolean }
        try {
            const result = await UE.saveUnit(id, body.edit ?? {}, body.advanced === true)
            if (result.errors) return reply.status(400).send({ error: "Bad Request", message: "Some lines can't be saved", check: result.errors })
            rebuildCnUpdate()
            return reply.send({ saved: result.rows ?? 0, file: result.file ?? null })
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

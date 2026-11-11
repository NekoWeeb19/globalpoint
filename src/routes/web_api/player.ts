import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import "@fastify/multipart"; // adds request.file() to the request type
import { deserializePlayerData, getClientSerializedData } from "../../data/utils";
import { getAllPlayersSync, replacePlayerDataSync } from "../../data/wdfpData";
import { clearMailboxSync, cloneSaveSync, deleteSaveSync, resetPartiesSync, resetSaveSync } from "../../nya/saveTools";

interface SaveQuery {
    id: string | undefined
}

interface GetPlayersQuery {
    page: string | undefined,
    perPage: string | undefined
}

const defaultPerPage = 25

const routes = async (fastify: FastifyInstance) => {
    await saveToolRoutes(fastify)
    fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
        // get page and perPage
        const { page, perPage } = request.query as GetPlayersQuery
        const parsedPage = page === undefined ? 0 : Number.parseInt(page)
        const parsedPerPage = perPage === undefined ? defaultPerPage : Number.parseInt(perPage)
        if (isNaN(parsedPage) || isNaN(parsedPerPage)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        })

        // get players
        const players = getAllPlayersSync(parsedPage * parsedPerPage, Math.min(defaultPerPage, parsedPerPage))

        return reply.status(200).send(players)
    })

    fastify.get("/save", async (request: FastifyRequest, reply: FastifyReply) => {
        // get id
        const { id } = request.query as SaveQuery
        const playerId = Number(id)
        if (isNaN(playerId)) return reply.redirect("/player");

        // get player
        const data = getClientSerializedData(playerId, { serializeRushEventData: true })
        if (data === null) return reply.redirect("/player");

        // otherwise, send
        reply.header("content-disposition", `attachment; filename="save-${playerId}.json"`)
        reply.type('application/json').send(data)
    })

    fastify.post("/save", async (request: FastifyRequest, reply: FastifyReply) => {
        // get id
        const { id } = request.query as SaveQuery
        const playerId = Number(id)
        if (isNaN(playerId)) return reply.redirect("/player");
        
        try {
            // get file
            const file = await request.file()
            if (file === undefined) return reply.redirect(`/player/${id}`);

            const text = (await file.toBuffer()).toString('utf-8')
            const json = JSON.parse(text)

            const saveData = json['data'] === undefined ? json : json['data']
            
            const parsedData = deserializePlayerData(playerId, saveData)

            replacePlayerDataSync(parsedData)

        } catch (error) {
            return reply.redirect(`/player/${id}?error=${error}`);
        }

        return reply.redirect(`/player/${id}`);
    })
}

// ---- save tools (the player page's Save tools box, src/nya/saveTools.ts): POST with { id } ----

const saveTool = (run: (playerId: number) => object) => async (request: FastifyRequest, reply: FastifyReply) => {
    const playerId = Number((request.body as { id?: unknown } | undefined)?.id)
    if (!Number.isSafeInteger(playerId) || playerId <= 0) return reply.status(400).send({ error: "Bad Request", message: "Invalid player id." })
    try {
        return reply.send(run(playerId))
    } catch (error) {
        return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
    }
}

export const saveToolRoutes = async (fastify: FastifyInstance) => {
    fastify.post("/clone", saveTool(playerId => cloneSaveSync(playerId)))
    fastify.post("/delete", saveTool(playerId => deleteSaveSync(playerId)))
    fastify.post("/reset-account", saveTool(playerId => resetSaveSync(playerId)))
    fastify.post("/reset-parties", saveTool(playerId => ({ unitId: resetPartiesSync(playerId) })))
    fastify.post("/clear-mailbox", saveTool(playerId => ({ cleared: clearMailboxSync(playerId) })))
}

export default routes;
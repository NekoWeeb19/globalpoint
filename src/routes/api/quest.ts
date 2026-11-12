import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders } from "../../utils";
import getDatabase, { Database } from "../../data"
import { getAccountPlayers, getPlayerItemSync, getPlayerQuestUnlocksSync, getPlayerSync, getSession, insertPlayerQuestUnlockSync, updatePlayerItemSync } from "../../data/wdfpData";
import questUnlocksData from "../../../assets/quest_unlocks_cn.json"

// Battles the CN app unlocks once with items (its quest tables' battle_startable_use_item_mode "Once" and the item
// ids/counts after it): category -> quest id -> item id -> count. Only CN's 9 world story event big bosses, each
// 1 Proficiency Certificate (item 60001).
const questUnlocks = questUnlocksData as Record<string, Record<string, Record<string, number>>>

const bad = (reply: FastifyReply, message = "Invalid request body.") => reply.status(400).send({ "error": "Bad Request", "message": message })

/** The viewer's player id, or null. */
async function viewerPlayer(viewerId: unknown): Promise<number | null> {
    if (!viewerId || isNaN(Number(viewerId))) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = (await getAccountPlayers(session.accountId))[0]
    return playerId === undefined || isNaN(playerId) || getPlayerSync(playerId) === null ? null : playerId
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_recent_other_player_party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, category: number, quest_id: number };
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: body.viewer_id
            }),
            "data": {
                "recent_other_player_party": [],
            }
        });
    })

    // The game's "unlock this battle" (QuestUnlockFlow, for a battle whose quest row asks for items once): takes the
    // items and saves the battle as unlocked, sent back on every load as quest_progress "unlocked".
    fastify.post("/unlock", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, category: number, quest_id: number }
        const playerId = await viewerPlayer(body?.viewer_id)
        const category = Number(body?.category), questId = Number(body?.quest_id)
        if (playerId === null || isNaN(category) || isNaN(questId)) return bad(reply)
        const cost = questUnlocks[String(category)]?.[String(questId)]
        if (cost === undefined) return bad(reply, `Quest ${category}/${questId} has no unlock.`)

        const result = getDatabase(Database.WDFP_DATA).transaction(() => {
            const already = (getPlayerQuestUnlocksSync(playerId)[String(category)] ?? []).includes(questId)
            const itemList: Record<string, number> = {}
            if (!already) {
                for (const [id, count] of Object.entries(cost))
                    if ((getPlayerItemSync(playerId, Number(id)) ?? 0) < count) return { ok: false as const, message: `not enough of item ${id} (needs ${count})` }
                for (const [id, count] of Object.entries(cost)) {
                    const after = (getPlayerItemSync(playerId, Number(id)) ?? 0) - count
                    updatePlayerItemSync(playerId, Number(id), after)
                    itemList[id] = after
                }
                insertPlayerQuestUnlockSync(playerId, category, questId)
            }
            return { ok: true as const, already, itemList }
        })()
        if (!result.ok) {
            console.log(`[quest unlock] Player ${playerId}: quest ${questId} refused: ${result.message}.`)
            return bad(reply, result.message)
        }
        console.log(`[quest unlock] Player ${playerId}: quest ${questId} ${result.already ? "was already unlocked" : `unlocked (${Object.entries(cost).map(([id, n]) => `${n}x ${id}`).join(", ")})`}.`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: body.viewer_id }),
            "data": { "item_list": result.itemList }
        })
    })
}

export default routes;

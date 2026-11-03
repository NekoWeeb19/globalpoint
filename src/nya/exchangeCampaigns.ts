// The CN client's exchange campaigns (data: assets/cn_exchange_campaigns.json, scripts/gen_cn_exchange_campaigns.cjs):
// - Special Exchange: the player enters a campaign (status 1), buys its selector ticket for paid beads (2), then
//   trades the ticket for one character or armament from the campaign's list (3). Scene 1 campaigns (the
//   newbie packs in the Special Pack shop) can be bought without entering.
// - Start Dash Exchange: a new player gets a window of `days` days from their first login while the campaign
//   runs, tied to the start dash portal running then (gacha_id); they buy its ticket for paid beads (2) and trade
//   it for a 4★/5★ unit of that portal (3).
// Status per player and campaign in players_exchange_campaigns; the client reads the lists from /load and from
// every exchange reply.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import exchangeData from "../../assets/cn_exchange_campaigns.json"
import gachaData from "../../assets/gacha.json"
import getDatabase, { Database } from "../data"
import { getAccountPlayers, getPlayerItemSync, getPlayerSync, getSession, givePlayerItemSync, updatePlayerItemSync, updatePlayerSync } from "../data/wdfpData"
import { givePlayerCharacterSync } from "../lib/character"
import { givePlayerEquipmentSync } from "../lib/equipment"
import { generateDataHeaders, getServerDate } from "../utils"

interface SpecialCampaign { name: string, scene: number, type: number, obtainSource: number, campaignStart: string | null, campaignEnd: string | null, exchangeStart: string | null, exchangeEnd: string | null, ticketItem: number, price: number, characters: number[], equipment: number[] }
interface StartDashCampaign { name: string, start: string | null, end: string | null, days: number, ticketItem: number, price: number, terms: string[], exclude: Record<string, number[]> }
const data = exchangeData as unknown as { special: Record<string, SpecialCampaign>, startDash: Record<string, StartDashCampaign>, startDashGachas: { id: number, start: string | null, end: string | null }[] }

const ms = (text: string | null) => text === null ? NaN : Date.parse(text.replace(" ", "T") + "Z")
const STATUS = { ENTERED: 1, TICKET: 2, EXCHANGED: 3 }
// the wildcard 10-pull tickets (src/routes/api/gacha.ts CN_WILDCARD_TICKETS: draw kinds 9 and 13)
const WILDCARD_TEN_PULL = { character: 999001, equipment: 999004 }

let ready = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!ready) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_exchange_campaigns (
            player_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            campaign_id INTEGER NOT NULL,
            status INTEGER NOT NULL,
            period_start INTEGER NOT NULL DEFAULT 0,
            gacha_id INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, kind, campaign_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        ready = true
    }
    return database
}

interface Row { campaign_id: number, status: number, period_start: number, gacha_id: number }
const rowsOf = (playerId: number, kind: string) =>
    db().prepare("SELECT campaign_id, status, period_start, gacha_id FROM players_exchange_campaigns WHERE player_id = ? AND kind = ?").all(playerId, kind) as Row[]
const rowOf = (playerId: number, kind: string, id: number) =>
    db().prepare("SELECT campaign_id, status, period_start, gacha_id FROM players_exchange_campaigns WHERE player_id = ? AND kind = ? AND campaign_id = ?").get(playerId, kind, id) as Row | undefined
function setRow(playerId: number, kind: string, row: Row) {
    db().prepare(`INSERT INTO players_exchange_campaigns (player_id, kind, campaign_id, status, period_start, gacha_id) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (player_id, kind, campaign_id) DO UPDATE SET status = excluded.status, period_start = excluded.period_start, gacha_id = excluded.gacha_id`)
        .run(playerId, kind, row.campaign_id, row.status, row.period_start, row.gacha_id)
}

/**
 * The client's special_exchange_campaign_list: the player's campaigns, plus every campaign running now as entered
 * (the client shows a campaign, its home banner included, only when the list has it).
 */
export function specialExchangeListSync(playerId: number) {
    const now = getServerDate().getTime()
    const list = new Map(rowsOf(playerId, "special").map(r => [r.campaign_id, { campaign_id: r.campaign_id, status: r.status }]))
    for (const [id, c] of Object.entries(data.special)) {
        if (list.has(Number(id))) continue
        if (ms(c.campaignStart) <= now && now < ms(c.exchangeEnd ?? c.campaignEnd)) list.set(Number(id), { campaign_id: Number(id), status: STATUS.ENTERED })
    }
    return [...list.values()]
}

/**
 * The client's start_dash_exchange_campaign_list. A Start Dash campaign running now gets the player's window on
 * their first look (now to `days` later, the start dash portal running now).
 */
export function startDashListSync(playerId: number) {
    const now = getServerDate().getTime()
    for (const [id, c] of Object.entries(data.startDash)) {
        if (rowOf(playerId, "startDash", Number(id)) !== undefined) continue
        if (!(ms(c.start) <= now && (c.end === null || now < ms(c.end)))) continue
        const gacha = data.startDashGachas.find(g => ms(g.start) <= now && now < ms(g.end)) ?? data.startDashGachas.filter(g => ms(g.start) <= now).pop()
        if (gacha === undefined) continue
        setRow(playerId, "startDash", { campaign_id: Number(id), status: STATUS.ENTERED, period_start: Math.floor(now / 1000), gacha_id: gacha.id })
    }
    return rowsOf(playerId, "startDash").map(r => {
        const c = data.startDash[String(r.campaign_id)]
        const termIndex = Math.max(0, (c?.terms ?? []).filter(t => ms(t) <= r.period_start * 1000).length - 1)
        return {
            campaign_id: r.campaign_id, gacha_id: r.gacha_id, status: r.status, term_index: termIndex,
            period_start_time: r.period_start, period_end_time: r.period_start + (c?.days ?? 7) * 86400,
        }
    })
}

type Body = { viewer_id: number, campaign_id: number, character_id?: number, equipment_id?: number }
const bad = (reply: FastifyReply, message: string) => reply.status(400).send({ error: "Bad Request", message })

async function playerOf(body: Body): Promise<number | null> {
    if (!body || isNaN(Number(body.viewer_id))) return null
    const session = await getSession(String(body.viewer_id))
    if (!session) return null
    const ids = await getAccountPlayers(session.accountId)
    return isNaN(ids[0]) ? null : ids[0]
}

function send(reply: FastifyReply, viewerId: number, payload: Record<string, unknown>) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId }), data: payload })
}

/** Takes the ticket's price in paid beads and gives one ticket; null when the beads aren't enough. */
function buyTicket(playerId: number, ticketItem: number, price: number) {
    const player = getPlayerSync(playerId)
    if (player === null || player.vmoney < price) return null
    updatePlayerSync({ id: playerId, vmoney: player.vmoney - price })
    // givePlayerItemSync adds the item when the player has none (updatePlayerItemSync only changes an existing row)
    const count = givePlayerItemSync(playerId, ticketItem, 1)
    return { user_info: { free_vmoney: player.freeVmoney, vmoney: player.vmoney - price }, item_list: { [ticketItem]: count } as Record<number, number> }
}

/**
 * Uses up one ticket. The campaign's bought status is what counts (a ticket a server before 0.6.17 failed to add
 * isn't required), so this never refuses; returns the count left.
 */
function useTicket(playerId: number, ticketItem: number) {
    const owned = getPlayerItemSync(playerId, ticketItem) ?? 0
    if (owned > 0) updatePlayerItemSync(playerId, ticketItem, owned - 1)
    return Math.max(0, owned - 1)
}

/** The reply part of a given character (as gacha exchanges send it). */
function giveCharacter(playerId: number, characterId: number, items: Record<string, number>) {
    const given = givePlayerCharacterSync(playerId, characterId)
    if (given === null) return null
    if (given.item !== undefined) items[given.item.id] = (getPlayerItemSync(playerId, given.item.id) ?? given.item.count)
    return given.character
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/special_exchange/enter_campaign", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Body
        const playerId = await playerOf(body)
        const campaign = data.special[String(body?.campaign_id)]
        if (playerId === null || campaign === undefined) return bad(reply, "Unknown player or campaign.")
        if (rowOf(playerId, "special", body.campaign_id) === undefined) setRow(playerId, "special", { campaign_id: body.campaign_id, status: STATUS.ENTERED, period_start: 0, gacha_id: 0 })
        return send(reply, body.viewer_id, { special_exchange_campaign_list: specialExchangeListSync(playerId) })
    })

    fastify.post("/special_exchange/buy_ticket", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Body
        const playerId = await playerOf(body)
        const campaign = data.special[String(body?.campaign_id)]
        if (playerId === null || campaign === undefined) return bad(reply, "Unknown player or campaign.")
        const row = rowOf(playerId, "special", body.campaign_id)
        if (row !== undefined && row.status !== STATUS.ENTERED) return bad(reply, "The ticket was already bought.")
        const bought = buyTicket(playerId, campaign.ticketItem, campaign.price)
        if (bought === null) return bad(reply, "Not enough paid beads.")
        // obtain source 0: the bundle also holds a wildcard 10-pull ticket (unit or armament, by the campaign's type)
        if (campaign.obtainSource === 0) {
            const pull = campaign.type === 1 ? WILDCARD_TEN_PULL.equipment : WILDCARD_TEN_PULL.character
            const count = givePlayerItemSync(playerId, pull, 1)
            bought.item_list[pull] = count
        }
        setRow(playerId, "special", { campaign_id: body.campaign_id, status: STATUS.TICKET, period_start: 0, gacha_id: 0 })
        console.log(`[exchange] Player ${playerId}: bought the ticket of special exchange ${body.campaign_id} (${campaign.name}) for ${campaign.price} paid beads`)
        return send(reply, body.viewer_id, { ...bought, special_exchange_campaign_list: specialExchangeListSync(playerId) })
    })

    fastify.post("/special_exchange/exchange_character", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Body
        const playerId = await playerOf(body)
        const campaign = data.special[String(body?.campaign_id)]
        const characterId = Number(body?.character_id)
        if (playerId === null || campaign === undefined) return bad(reply, "Unknown player or campaign.")
        if (!campaign.characters.includes(characterId)) return bad(reply, "That unit isn't in this campaign.")
        if (rowOf(playerId, "special", body.campaign_id)?.status !== STATUS.TICKET) return bad(reply, "No ticket bought for this campaign.")
        const left = useTicket(playerId, campaign.ticketItem)
        if (left === null) return bad(reply, "No ticket.")
        const items: Record<string, number> = { [campaign.ticketItem]: left }
        const character = giveCharacter(playerId, characterId, items)
        if (character === null) return bad(reply, "Could not give the unit.")
        setRow(playerId, "special", { campaign_id: body.campaign_id, status: STATUS.EXCHANGED, period_start: 0, gacha_id: 0 })
        console.log(`[exchange] Player ${playerId}: special exchange ${body.campaign_id} -> unit ${characterId}`)
        return send(reply, body.viewer_id, {
            character_list: [character], equipment_list: [], item_list: items, mail_arrived: false,
            special_exchange_campaign_list: specialExchangeListSync(playerId),
        })
    })

    fastify.post("/special_exchange/exchange_equipment", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Body
        const playerId = await playerOf(body)
        const campaign = data.special[String(body?.campaign_id)]
        const equipmentId = Number(body?.equipment_id)
        if (playerId === null || campaign === undefined) return bad(reply, "Unknown player or campaign.")
        if (!campaign.equipment.includes(equipmentId)) return bad(reply, "That armament isn't in this campaign.")
        if (rowOf(playerId, "special", body.campaign_id)?.status !== STATUS.TICKET) return bad(reply, "No ticket bought for this campaign.")
        const left = useTicket(playerId, campaign.ticketItem)
        if (left === null) return bad(reply, "No ticket.")
        const equipment = givePlayerEquipmentSync(playerId, equipmentId, 1)
        setRow(playerId, "special", { campaign_id: body.campaign_id, status: STATUS.EXCHANGED, period_start: 0, gacha_id: 0 })
        console.log(`[exchange] Player ${playerId}: special exchange ${body.campaign_id} -> armament ${equipmentId}`)
        return send(reply, body.viewer_id, {
            equipment_list: [equipment], item_list: { [campaign.ticketItem]: left }, mail_arrived: false,
            special_exchange_campaign_list: specialExchangeListSync(playerId),
        })
    })

    fastify.post("/start_dash_exchange/buy_ticket", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Body
        const playerId = await playerOf(body)
        const campaign = data.startDash[String(body?.campaign_id)]
        if (playerId === null || campaign === undefined) return bad(reply, "Unknown player or campaign.")
        startDashListSync(playerId)
        const row = rowOf(playerId, "startDash", body.campaign_id)
        if (row === undefined) return bad(reply, "This campaign isn't open for the player.")
        if (row.status !== STATUS.ENTERED) return bad(reply, "The ticket was already bought.")
        const bought = buyTicket(playerId, campaign.ticketItem, campaign.price)
        if (bought === null) return bad(reply, "Not enough paid beads.")
        setRow(playerId, "startDash", { ...row, status: STATUS.TICKET })
        console.log(`[exchange] Player ${playerId}: bought the Start Dash ticket for ${campaign.price} paid beads`)
        return send(reply, body.viewer_id, { ...bought, start_dash_exchange_campaign_list: startDashListSync(playerId) })
    })

    fastify.post("/start_dash_exchange/exchange_character", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Body
        const playerId = await playerOf(body)
        const campaign = data.startDash[String(body?.campaign_id)]
        const characterId = Number(body?.character_id)
        if (playerId === null || campaign === undefined) return bad(reply, "Unknown player or campaign.")
        const row = rowOf(playerId, "startDash", body.campaign_id)
        if (row?.status !== STATUS.TICKET) return bad(reply, "No ticket bought for this campaign.")
        const pool = (gachaData as unknown as Record<string, { pool?: Record<string, { id: number }[]> }>)[String(row.gacha_id)]?.pool ?? {}
        if (![...(pool["1"] ?? []), ...(pool["2"] ?? [])].some(e => e.id === characterId)) return bad(reply, "That unit isn't in this portal.")
        const left = useTicket(playerId, campaign.ticketItem)
        if (left === null) return bad(reply, "No ticket.")
        const items: Record<string, number> = { [campaign.ticketItem]: left }
        const character = giveCharacter(playerId, characterId, items)
        if (character === null) return bad(reply, "Could not give the unit.")
        setRow(playerId, "startDash", { ...row, status: STATUS.EXCHANGED })
        console.log(`[exchange] Player ${playerId}: Start Dash -> unit ${characterId}`)
        return send(reply, body.viewer_id, {
            character_list: [character], equipment_list: [], item_list: items, mail_arrived: false,
            start_dash_exchange_campaign_list: startDashListSync(playerId),
        })
    })
}

export default routes

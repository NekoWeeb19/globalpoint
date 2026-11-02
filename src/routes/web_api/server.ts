import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getServerDate, getServerTimeMode, isServerTimeTicking, setServerTime } from "../../utils";
import { givePlayerCharacterSync } from "../../lib/character";
import { givePlayerEquipmentSync } from "../../lib/equipment";
import { SendMail, MAIL_TYPE } from "../../nya/mail";
import { getBannerRotationStatus, goToBannerRotation, resumeBannerRotation, skipBannerRotation } from "../../lib/bannerRotation";
import { getAccountFromPlayerIdSync, getAllPlayersSync, getPlayerFromAccountIdSync, getPlayerSync } from "../../data/wdfpData";
import { chosenAccount, setChosenAccount } from "../../nya/activeAccounts";
import { cnLinkedAccountId } from "../../lib/cnClient";
import { clearAccountClaim, getAccountClaim, setAccountClaim } from "../../nya/accountClaim";
import { ACCOUNT_CLAIM_MINUTES } from "../../lib/accountClaim";
import { resetPlayerActiveMissionSync, unlockPlayerActiveMissionSync } from "../../nya/activeMissionTools";
import activeMissionData from "../../../assets/active_missions.json";
import { getCampaignOverview, setCampaignSchedule } from "../../nya/campaignSchedule";
import { eventImagePath, getEventOverview, removeEventSchedule, removeEventSchedules, setEventSchedule, setEventSchedules } from "../../nya/eventSchedule";
import { createReadStream } from "fs";
import { allowLoginBonusAgainSync } from "../../nya/loginBonus";
import { withRealTimeOfDay } from "../../lib/serverClock";
import { deleteNews, listNews, NEWS_CATEGORIES, saveNews } from "../../nya/news";
import { DROP_MULTIPLIER_MAX, DROP_MULTIPLIER_MIN, getDropMultiplier, setDropMultiplier } from "../../nya/dropSettings";
import { lanAddresses } from "../../nya/coop";

interface TimeQuery {
    time: string | undefined
}

/**
 * Reads a time from the dashboard's <input type="datetime-local">, which sends "YYYY-MM-DDTHH:MM"
 * (no seconds when they're 0) or "YYYY-MM-DDTHH:MM:SS". Times are UTC.
 *
 * @returns The date, or null if it isn't a real date in that format. `new Date(...)` never throws on
 * bad input: it returns an "Invalid Date" (which would break every page and API response that uses
 * the server time) or silently rolls an impossible date like Feb 30 over to the next month.
 */
const parseServerTime = (value: string): Date | null => {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/.exec(value)
    if (match === null) return null
    const time = new Date(`${match[1]}${match[2] ?? ":00"}.000Z`)
    return isNaN(time.getTime()) || !time.toISOString().startsWith(match[1]) ? null : time
}

const badTimeReply = (reply: FastifyReply) => reply.status(400).send({
    "error": "Bad Request",
    "message": "Invalid time. Use the format YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS (UTC)."
})

/** The banners an entry keeps where they are ({ skipBanners: [gacha ids] }), when given. */
const skipBannersOf = (body: { skipBanners?: unknown }) =>
    Array.isArray(body.skipBanners) && body.skipBanners.length > 0 ? { skipBanners: body.skipBanners.map(String) } : {}

const routes = async (fastify: FastifyInstance) => {

    fastify.get("/resetTime", async (request: FastifyRequest, reply: FastifyReply) => {
        // with the banner rotation on, "reset" hands the date back to the rotation
        if (resumeBannerRotation() === null) {
            try {
                // otherwise the server uses the real time again
                setServerTime(null)
            } catch (error) { }
        }

        return reply.redirect(`/`);
    })

    fastify.get("/time", async (request: FastifyRequest, reply: FastifyReply) => {
        const newTime = (request.query as TimeQuery).time
        if (!newTime) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        })

        const time = parseServerTime(newTime)
        if (time === null) return badTimeReply(reply)

        setServerTime(time)

        return reply.redirect(`/`);
    })

    // keeps the server's date but sets its time of day to the real one (UTC), so the server's day
    // turns over with the real daily reset
    fastify.post("/time/match-real", async (_: FastifyRequest, reply: FastifyReply) => {
        const matched = new Date(withRealTimeOfDay(getServerDate().getTime(), Date.now()))
        setServerTime(matched)
        return reply.send({ "serverDate": getServerDate().toISOString() })
    })

    // the server date right now, whether it ticks, and where it comes from (rotation / set / real)
    fastify.get("/clock", async (_: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
            "serverDate": getServerDate().toISOString(),
            "ticking": isServerTimeTicking(),
            "mode": getServerTimeMode()
        })
    })

    // ---- quest drop amount (src/nya/dropSettings.ts) ----

    const dropsReply = () => ({ multiplier: getDropMultiplier(), min: DROP_MULTIPLIER_MIN, max: DROP_MULTIPLIER_MAX })
    fastify.get("/drops", async (_: FastifyRequest, reply: FastifyReply) => reply.send(dropsReply()))
    fastify.post("/drops", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            setDropMultiplier(Number((request.body as { multiplier?: unknown } | undefined)?.multiplier))
        } catch (error) {
            return reply.status(400).send({ error: "Bad Request", message: (error as Error).message })
        }
        return reply.send(dropsReply())
    })

    // ---- phone connection file (server.txt, read by game build 23+): plays a phone against this
    // server over Wi-Fi. Only useful when the server listens on the network (LISTEN_HOST 0.0.0.0). ----

    const listenPort = () => Number.parseInt(process.env.LISTEN_PORT ?? "8000") || 8000
    const onNetwork = () => !["127.0.0.1", "localhost", "::1", ""].includes((process.env.LISTEN_HOST ?? "localhost").trim())
    fastify.get("/phone-connection", async (request: FastifyRequest, reply: FastifyReply) => {
        // opened from another device by the PC's address: that address works, so list it first
        const asked = (request.headers.host ?? "").replace(/:\d+$/, "")
        const addresses = lanAddresses()
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(asked) && !asked.startsWith("127.") && !addresses.includes(asked)) addresses.unshift(asked)
        // STARPOINT_COMPANION=1: the server runs inside the phone companion app, where this doesn't apply
        const onPhone = process.env.STARPOINT_COMPANION === "1"
        return reply.send({ onPhone, onNetwork: onNetwork(), listenHost: process.env.LISTEN_HOST ?? "localhost", port: listenPort(), addresses })
    })
    fastify.get("/phone-connection/server.txt", async (request: FastifyRequest, reply: FastifyReply) => {
        const host = String((request.query as { host?: string }).host ?? lanAddresses()[0] ?? "")
        if (!/^[A-Za-z0-9.-]+$/.test(host)) return reply.status(400).send({ error: "Bad Request", message: "Pick this PC's address first." })
        return reply
            .header("content-disposition", `attachment; filename="server.txt"`)
            .type("text/plain; charset=utf-8")
            .send(`# StarPoint server for World Flipper (game build 23 or newer)\r\n# Put this file in Android/obb/com.leiting.wf/ on the phone\r\n${host}:${listenPort()}\r\n`)
    })

    // ---- event schedule (see src/lib/eventSchedule.ts) ----

    // every event with its original and scheduled dates
    fastify.get("/events", async (_: FastifyRequest, reply: FastifyReply) => {
        return reply.send(getEventOverview())
    })

    // schedules an event: { key, start, end, moveBanners } with ISO dates (UTC)
    fastify.post("/events/schedule", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { key?: unknown, start?: unknown, end?: unknown, moveBanners?: unknown, skipBanners?: unknown }
        const problem = await setEventSchedule({
            ...skipBannersOf(body),
            key: String(body.key ?? ""),
            start: String(body.start ?? ""),
            end: String(body.end ?? ""),
            moveBanners: body.moveBanners !== false
        })
        if (problem !== null) return reply.status(400).send({ "error": "Bad Request", "message": problem })
        return reply.send(getEventOverview())
    })

    // schedules several events at once: { entries: [{ key, start, end, moveBanners }] }
    fastify.post("/events/schedule-many", async (request: FastifyRequest, reply: FastifyReply) => {
        const list = ((request.body ?? {}) as { entries?: unknown }).entries
        if (!Array.isArray(list)) return reply.status(400).send({ "error": "Bad Request", "message": "No events were picked." })
        const problem = await setEventSchedules(list.map(item => {
            const body = (item ?? {}) as { key?: unknown, start?: unknown, end?: unknown, moveBanners?: unknown, skipBanners?: unknown }
            return { ...skipBannersOf(body), key: String(body.key ?? ""), start: String(body.start ?? ""), end: String(body.end ?? ""), moveBanners: body.moveBanners !== false }
        }))
        if (problem !== null) return reply.status(400).send({ "error": "Bad Request", "message": problem })
        return reply.send(getEventOverview())
    })

    // puts several events back on their original dates: { keys: [...] }
    fastify.post("/events/unschedule-many", async (request: FastifyRequest, reply: FastifyReply) => {
        const keys = ((request.body ?? {}) as { keys?: unknown }).keys
        if (!Array.isArray(keys) || (await removeEventSchedules(keys.map(String))) === 0) return reply.status(400).send({ "error": "Bad Request", "message": "None of those events are moved." })
        return reply.send(getEventOverview())
    })

    // an event or summon banner picture (copied from the game's files by scripts/gen_event_catalog.cjs)
    fastify.get("/event-image/:file", async (request: FastifyRequest, reply: FastifyReply) => {
        const file = (request.params as { file: string }).file
        const found = file.endsWith(".png") ? eventImagePath(file.slice(0, -4)) : null
        if (found === null) return reply.status(404).send({ "error": "Not Found" })
        reply.header("content-type", "image/png")
        reply.header("cache-control", "public, max-age=86400")
        return reply.send(createReadStream(found))
    })

    // ---- yearly seasonal campaigns (see src/lib/campaignSchedule.ts) ----

    fastify.get("/campaigns", async (_: FastifyRequest, reply: FastifyReply) => reply.send(getCampaignOverview()))

    // which seasonal login bonuses and free pulls repeat every year: { yearlyLoginBonuses: [...], yearlyFreePulls: [...] }
    fastify.post("/campaigns", async (request: FastifyRequest, reply: FastifyReply) => {
        const problem = await setCampaignSchedule(request.body ?? {})
        if (problem !== null) return reply.status(400).send({ "error": "Bad Request", "message": problem })
        return reply.send(getCampaignOverview())
    })

    // ---- News (the dashboard's News tab, src/nya/news.ts) ----

    fastify.get("/news", async (_: FastifyRequest, reply: FastifyReply) => reply.send({ posts: listNews(), categories: NEWS_CATEGORIES }))

    // adds a post ({ title, body, category, apps }) or changes one (with its id)
    fastify.post("/news", async (request: FastifyRequest, reply: FastifyReply) => {
        const saved = saveNews(request.body ?? {})
        if (typeof saved === "string") return reply.status(400).send({ "error": "Bad Request", "message": saved })
        return reply.send({ posts: listNews(), categories: NEWS_CATEGORIES, saved })
    })

    fastify.post("/news/delete", async (request: FastifyRequest, reply: FastifyReply) => {
        const id = Number(((request.body ?? {}) as { id?: unknown }).id)
        if (!deleteNews(id)) return reply.status(400).send({ "error": "Bad Request", "message": "That post doesn't exist." })
        return reply.send({ posts: listNews(), categories: NEWS_CATEGORIES })
    })

    // puts an event back on its original dates: { key }
    fastify.post("/events/unschedule", async (request: FastifyRequest, reply: FastifyReply) => {
        const key = String(((request.body ?? {}) as { key?: unknown }).key ?? "")
        if (!(await removeEventSchedule(key))) return reply.status(400).send({ "error": "Bad Request", "message": "That event isn't scheduled." })
        return reply.send(getEventOverview())
    })

    // ---- banner rotation (see src/lib/bannerRotation.ts) ----

    const rotationOffReply = (reply: FastifyReply) => reply.status(400).send({
        "error": "Bad Request",
        "message": "Banner rotation is not turned on. Set BANNER_ROTATION=\"true\" in the .env file and restart."
    })

    // shows the rotation's position, the server date, and the banners that are live right now
    fastify.get("/rotation", async (_: FastifyRequest, reply: FastifyReply) => {
        return reply.send(getBannerRotationStatus() ?? { "enabled": false })
    })

    // moves to the next banner now
    fastify.get("/rotation/next", async (_: FastifyRequest, reply: FastifyReply) => {
        const status = skipBannerRotation(1)
        return status === null ? rotationOffReply(reply) : reply.send(status)
    })

    // moves back to the previous banner now
    fastify.get("/rotation/previous", async (_: FastifyRequest, reply: FastifyReply) => {
        const status = skipBannerRotation(-1)
        return status === null ? rotationOffReply(reply) : reply.send(status)
    })

    // moves to the banner that started at or before a date (UTC), and keeps rotating from there
    fastify.get("/rotation/goto", async (request: FastifyRequest, reply: FastifyReply) => {
        const time = parseServerTime((request.query as TimeQuery).time ?? "")
        if (time === null) return badTimeReply(reply)
        const status = goToBannerRotation(time)
        return status === null ? rotationOffReply(reply) : reply.send(status)
    })

    // hands the date back to the rotation after it was set by hand
    fastify.get("/rotation/resume", async (_: FastifyRequest, reply: FastifyReply) => {
        const status = resumeBannerRotation()
        return status === null ? rotationOffReply(reply) : reply.send(status)
    })

    // testing tool: lets a player collect today's login bonus again at their next login: { playerId }
    fastify.post("/loginBonus/again", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number(((request.body ?? {}) as { playerId?: unknown }).playerId)
        if (!Number.isInteger(playerId)) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid player." })
        const reset = allowLoginBonusAgainSync(playerId)
        return reply.send({ reset, message: reset
            ? "Done. Close and reopen the game to get the next day of your login bonuses."
            : "No login bonus was collected today yet, so the next login gives one anyway." })
    })

    // reinstalled game: the next NEW guest login takes over this player's account: { playerId }
    fastify.post("/account/claim", async (request: FastifyRequest, reply: FastifyReply) => {
        const playerId = Number(((request.body ?? {}) as { playerId?: unknown }).playerId)
        const account = Number.isInteger(playerId) ? getAccountFromPlayerIdSync(playerId) : null
        if (account === null) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid player." })
        const claim = setAccountClaim(account.id)
        return reply.send({ accountId: account.id, expiresMs: claim.expiresMs, message:
            `Done. Open the reinstalled game within ${ACCOUNT_CLAIM_MINUTES} minutes and log in as a guest: it will load this player.` })
    })
    // which account each app plays on (Players tab): { app: "global" | "cn", playerId: number | null }
    fastify.get("/account/active", async (_: FastifyRequest, reply: FastifyReply) => reply.send(activeAccountsReply()))
    fastify.post("/account/active", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { app?: unknown, playerId?: unknown }
        if (body.app !== "global" && body.app !== "cn") return reply.status(400).send({ "error": "Bad Request", "message": "Pick an app." })
        let accountId: number | null = null
        if (body.playerId !== null && body.playerId !== undefined && body.playerId !== "") {
            const account = getAccountFromPlayerIdSync(Number(body.playerId))
            if (account === null) return reply.status(400).send({ "error": "Bad Request", "message": "That player doesn't exist." })
            accountId = account.id
        }
        setChosenAccount(body.app, accountId)
        return reply.send(activeAccountsReply())
    })
    fastify.get("/account/claim", async (_: FastifyRequest, reply: FastifyReply) => reply.send({ claim: getAccountClaim() }))
    fastify.post("/account/claim/cancel", async (_: FastifyRequest, reply: FastifyReply) => {
        clearAccountClaim()
        return reply.send({ claim: null })
    })

    // testing tool for active missions: makes one claimable for a player, or resets it
    fastify.get("/activeMission", async (request: FastifyRequest, reply: FastifyReply) => {
        const q = request.query as { playerId?: string, missionId?: string, action?: string };
        const playerId = Number(q.playerId);
        const missionId = Number(q.missionId);
        if (!q.playerId || !q.missionId || !Number.isInteger(playerId) || !Number.isInteger(missionId)
            || (q.action !== "unlock" && q.action !== "reset")) return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid query parameters."
            });

        const missions = (activeMissionData as unknown as { missions: Record<string, { title: string }> }).missions;
        const mission = missions[String(missionId)];
        if (!mission) return reply.status(400).send({
            "error": "Bad Request",
            "message": `Unknown active mission: ${missionId}`
        });
        if (getPlayerSync(playerId) === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Player not found."
        });

        if (q.action === "reset") {
            resetPlayerActiveMissionSync(playerId, missionId);
            return reply.send({
                "error": "Success",
                "message": `Reset mission ${missionId} (${mission.title}). It can be unlocked again.`
            });
        }

        const result = unlockPlayerActiveMissionSync(playerId, missionId);
        return reply.send({
            "error": "Success",
            "message": result === "unlocked"
                ? `Unlocked mission ${missionId} (${mission.title}). Restart the game to see it, then claim it from the missions screen.`
                : `Mission ${missionId} (${mission.title}) was already received. Reset it first to unlock it again.`
        });
    });

    fastify.get("/give", async (request: FastifyRequest, reply: FastifyReply) => {
        const q = request.query as { playerId: string, type: string, typeId: string, number?: string };
        if (!q.playerId || !q.type || !q.typeId) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        });
        const playerId = parseInt(q.playerId);
        const typeId = parseInt(q.typeId);
        const number = q.number ? parseInt(q.number) : 1;
        if (isNaN(playerId) || isNaN(typeId) || isNaN(number)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid query parameters."
        });
        
        switch (q.type) {
            case "chara":
                SendMail(playerId, {
                    subject: "Give Character",
                    description: "From Web API",
                    type: MAIL_TYPE.CHARACTER,
                    type_id: typeId,
                    number: number
                })
                break;
            case "equip":
                SendMail(playerId, {
                    subject: "Give Equipment",
                    description: "From Web API",
                    type: MAIL_TYPE.EQUIPMENT,
                    type_id: typeId,
                    number: number
                })
                break;
            case "item":
                SendMail(playerId, {
                    subject: "Give Item",
                    description: "From Web API",
                    type: MAIL_TYPE.ITEM,
                    type_id: typeId,
                    number: number
                })
                break;
            default:
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Invalid query parameters."
                });
        }

        return reply.send({
            "error": "Success",
            "message": "Operation successful."
        });
    });
}

/** Every player, and the player each app plays on (null: the app's own login). */
function activeAccountsReply() {
    const playerOf = (accountId: number | null | undefined) => accountId == null ? null : getPlayerFromAccountIdSync(accountId)?.id ?? null
    return {
        players: getAllPlayersSync(0, 1000).map(player => ({ id: player.id, name: player.name })),
        global: playerOf(chosenAccount("global")),
        cn: playerOf(cnLinkedAccountId()),
    }
}

export default routes;

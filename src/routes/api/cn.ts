// API calls only the CN client makes (registered under /latest/api/index.php; the CN client's
// /cn/api/index.php is rewritten to it). Reply shapes from the Chinese StarPoint fork
// (startpoint-cn src/routes/cn and src/cn-server.ts). See src/lib/cnClient.ts.
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cnNewsItem, listNews } from "../../nya/news";
import { SessionType } from "../../data/types";
import { generateViewerIdSession, getAccount, getAccountFromIdpIdSync, getAccountSessionsOfType, getPlayerFromAccountIdSync, insertAccount, insertDefaultPlayerSync, updateAccount } from "../../data/wdfpData";
import { generateDataHeaders } from "../../utils";
import { getAccountPlayers, getSession } from "../../data/wdfpData";
import { trackActiveMissionProgress } from "../../nya/activeMissionProgress";
import { PATTERN } from "../../lib/activeMissionProgress";
import { cnLinkedAccountId, cnVersionInfo } from "../../lib/cnClient";

function sendMsgpack(reply: FastifyReply, data: unknown, headers: Record<string, any> = {}) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ data_headers: generateDataHeaders(headers), data })
}

interface CnSignupBody {
    device_id: number
    channelNo?: string
}

/**
 * The CN client's /tool/signup (no Kakao login: the patched client uses a dummy Leiting user). The
 * account is CN_ACCOUNT_ID when set (the same save as the global client), else one account per CN
 * device (idp_code "cn", idp_id "cn:<device id>"). The viewer id is the account's existing one, so
 * the global client signed in to the same account keeps working.
 */
export async function cnSignup(request: FastifyRequest, reply: FastifyReply) {
    const body = (request.body ?? {}) as CnSignupBody
    const udid = String(request.headers["udid"] ?? "unknown")
    const deviceId = body.device_id
    if (!deviceId) return reply.status(400).send({ error: "Bad Request", message: "Missing device_id." })

    let accountId: number | null = null
    let newAccount = false
    const linked = cnLinkedAccountId()
    if (linked !== null && await getAccount(linked) !== null) {
        accountId = linked
    } else {
        if (linked !== null) console.log(`[cn] CN_ACCOUNT_ID ${linked} has no account; using the device's own account.`)
        const idpId = `cn:${deviceId}`
        const existing = getAccountFromIdpIdSync(idpId)
        if (existing) {
            accountId = existing.id
        } else {
            const account = await insertAccount({ appId: "wf_cn", idpAlias: idpId, idpCode: "cn", idpId, status: "normal" })
            accountId = account.id
            newAccount = true
        }
    }

    if (getPlayerFromAccountIdSync(accountId) === null) {
        insertDefaultPlayerSync(accountId)
        newAccount = true
    }
    await updateAccount({ id: accountId, lastLoginTime: new Date() })

    const viewerSessions = await getAccountSessionsOfType(accountId, SessionType.VIEWER)
    const viewerId = Number.parseInt((viewerSessions[0] ?? await generateViewerIdSession(accountId)).token)
    console.log(`[cn] signup: device ${deviceId} -> account ${accountId}, viewer ${viewerId}${newAccount ? " (new)" : ""}`)

    return sendMsgpack(reply, {
        login_token: Math.random().toString(36).slice(2).padEnd(32, "0").slice(0, 32),
        newAccount: newAccount ? 1 : 0,
        roleName: `Player${accountId}`,
        accountName: `Player${accountId}`,
        sign: "dummy_sign",
        createDate: new Date().toISOString(),
        serverName: "StarPoint",
        serverId: 1,
    }, { viewer_id: viewerId, short_udid: 0, udid })
}

const routes = async (fastify: FastifyInstance) => {
    // Leiting (the CN publisher) login: the patched client sends a dummy user; always accepted
    fastify.post("/channels/channel_leiting/leiting_login", async (request, reply) => {
        const body = (request.body ?? {}) as { userId?: string }
        return sendMsgpack(reply, {
            status: "success",
            userId: body.userId,
            data: { idCard: "123456", age: 18, isGuest: 0, auth: 1 },
            online_server_check: true,
            heart_beat_interval: 240,
        })
    })
    // anti-addiction play-time limits: never limited
    fastify.post("/channels/channel_leiting/leiting_antiaddiction_login", async (_request, reply) =>
        sendMsgpack(reply, { status: 0, message: "success", data: { onlineTime: 0, limitTime: 999999, usableTime: 999999 } }))
    fastify.post("/channels/channel_leiting/leiting_antiaddiction_logout", async (_request, reply) => sendMsgpack(reply, {}))
    fastify.post("/channels/channel_leiting/leiting_update", async (_request, reply) => sendMsgpack(reply, {}))

    // purchases (none here)
    fastify.post("/channels/channel_leiting_pay/query_unfinish_order", async (_request, reply) => sendMsgpack(reply, { order_id: "" }))
    fastify.post("/channels/channel_leiting_pay/query_purcharge", async (_request, reply) => sendMsgpack(reply, { status: 3 }))
    fastify.post("/channels/channel_leiting_pay/set_unfinish_order_status", async (_request, reply) => sendMsgpack(reply, {}))
    fastify.post("/channels/channel_leiting_pay/set_unfinish_order_error", async (_request, reply) => sendMsgpack(reply, {}))

    // CN-only tool calls (the shared ones, signup and get_header_response, are in tool.ts)
    fastify.post("/tool/auth", async (_request, reply) => sendMsgpack(reply, {}))
    fastify.post("/tool/check_social_link_enable", async (_request, reply) => sendMsgpack(reply, { enable: false }))
    fastify.post("/tool/contact_active", async (_request, reply) => sendMsgpack(reply, { enable_customer_service: false }))
    fastify.post("/tool/check_enable_customer_service", async (_request, reply) => sendMsgpack(reply, { enable_customer_service: false }))
    fastify.post("/tool/check_enable_gift", async (_request, reply) => sendMsgpack(reply, { enable_gift: false }))
    fastify.post("/tool/custom_notify", async (_request, reply) => sendMsgpack(reply, {}))
    fastify.post("/tool/change_active", async (_request, reply) => sendMsgpack(reply, {}))
    fastify.post("/tool/get_qq_group_url", async (_request, reply) => sendMsgpack(reply, { url: "" }))
    fastify.post("/tool/get_survey_url", async (_request, reply) => sendMsgpack(reply, { url: "" }))
    fastify.post("/tool/get_bug_report_url", async (_request, reply) => sendMsgpack(reply, { url: "" }))

    // the title screen's game-file check (msgpack, unlike /asset/version_info)
    fastify.post("/assetintitle/version_info_in_title", async (request, reply) =>
        sendMsgpack(reply, cnVersionInfo(request.headers.host ?? "127.0.0.1:8000")))

    // the News board: the posts written on the dashboard's News tab for the CN app (src/nya/news.ts),
    // by tab: news/index { category: 1 Topics, 2 Events, 3 Bugs & maintenance }, news/system_index
    // (category 4); 10 a page. A post opens with news/get_info (src/routes/api/news.ts).
    const PAGE = 10
    const newsPage = (category: number, page: number) => {
        const posts = listNews("cn").filter(post => post.category === category)
        const index = Math.max(1, page)
        return { current_page: index, news: posts.slice((index - 1) * PAGE, index * PAGE).map(cnNewsItem), news_count: posts.length }
    }
    fastify.post("/news/index", async (request, reply) => {
        const body = (request.body ?? {}) as { category?: number, page_index?: number }
        return sendMsgpack(reply, newsPage(Number(body.category) || 1, Number(body.page_index) || 1))
    })
    fastify.post("/news/system_index", async (request, reply) => {
        const body = (request.body ?? {}) as { page_index?: number }
        return sendMsgpack(reply, newsPage(4, Number(body.page_index) || 1))
    })

    // character story trial reading
    fastify.post("/episode_trial_reading/finish", async (_request, reply) => sendMsgpack(reply, {}))

    // the Content Guide ("Next Recommendation" on the home screen, CN active mission event 2): opening it
    // sends "start", which completes the guide's first mission (20001, src/nya/activeMissionData.ts)
    fastify.post("/contents_guide/start", async (request, reply) => {
        const body = (request.body ?? {}) as { viewer_id?: number }
        const session = body.viewer_id === undefined ? null : await getSession(String(body.viewer_id))
        const playerId = session === null ? NaN : (await getAccountPlayers(session.accountId))[0]
        const activeMissionList = isNaN(playerId) ? [] : trackActiveMissionProgress(playerId, { add: { [PATTERN.CONTENTS_GUIDE_START]: 1 } })
        return sendMsgpack(reply, { active_mission_list: activeMissionList }, { viewer_id: body.viewer_id })
    })
}

export default routes;

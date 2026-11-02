import Fastify, { FastifyRequest } from "fastify";
import { ContentTypeParserDoneFunction } from "fastify/types/content-type-parser";
import fastifyStatic from "@fastify/static";
import { pack, unpack } from "msgpackr";
import path from "path";
import { appendFileSync, mkdirSync } from "fs";
// api routes
import apiPlugin from "./routes/api";
import assetApiPlugin from "./routes/api/asset";
import toolApiPlugin from "./routes/api/tool";
import reproduceApiPlugin from "./routes/api/reproduce"
import tutorialApiPlugin from "./routes/api/tutorial"
import gachaApiPlugin from "./routes/api/gacha"
import partyApiPlugin from "./routes/api/party"
import expodApiPlugin from "./routes/api/expod"
import storyQuestApiPlugin from "./routes/api/storyQuest"
import optionApiPlugin from "./routes/api/option"
import singleBattleQuestApiPlugin from "./routes/api/singleBattleQuest"
import multiBattleQuestApiPlugin from "./routes/api/multiBattleQuest"
import attentionApiPlugin from "./routes/api/attention"
import characterApiPlugin from "./routes/api/character"
import partyGroupApiPlugin from "./routes/api/partyGroup"
import equipmentApiPlugin from "./routes/api/equipment"
import exBoostApiPlugin from "./routes/api/exBoost"
import boxGachaApiPlugin from "./routes/api/boxGacha"
import shopApiPlugin, { howToGetRoutes as howToGetApiPlugin } from "./routes/api/shop"
import comicApiPlugin from "./routes/api/comic"
import encyclopediaApiPlugin from "./routes/api/encyclopedia"
import mailApiPlugin from "./routes/api/mail"
import rankingEventApiPlugin from "./routes/api/rankingEvent"
import missionApiPlugin from "./routes/api/mission"
import activeMissionApiPlugin from "./routes/api/activeMission"
import paymentApiPlugin from "./routes/api/payment"
import newsApiPlugin from "./routes/api/news"
import profileApiPlugin from "./routes/api/profile"
import itemApiPlugin from "./routes/api/item"
import exchangeApiPlugin from "./routes/api/exchange"
import historyApiPlugin from "./routes/api/history"
import raidEventApiPlugin from "./routes/api/raidEvent"
import rushEventApiPlugin from "./routes/api/rushEvent"
import carnivalEventApiPlugin from "./routes/api/carnivalEvent"
import passCardApiPlugin from "./routes/api/passCard"
import growthFundApiPlugin from "./routes/api/growthFund"
import quest from "./routes/api/quest";
import stubsApiPlugin from "./routes/api/stubs"
import { startCoopServer } from "./coop/tcp"
import { coopPort } from "./nya/coop"
import { initBannerRotation } from "./lib/bannerRotation"
import { initServerClock } from "./utils"
import { initEventSchedule } from "./nya/eventSchedule"
import { initCampaignSchedule } from "./nya/campaignSchedule"
// web routes
import indexWebPlugin from "./routes/web"
// web api routes
import indexWebApiPlugin from "./routes/web_api"
// misc routes
import openapiPlugin from "./routes/openapi";
import battleLogPlugin from "./routes/battleLog";
import infodeskPlugin from "./routes/infodesk";
import companionPlugin from "./routes/companion";
import { cnApiUrl, isCnRequest, runInCnContext, CN_INTERNAL_HEADER, CN_PREFIX, CN_CDN_PREFIX, cnCdnRoot, adaptCnReply, cnApiPath, CN_PATCH_PREFIX, cnPatchDir } from "./lib/cnClient";
import { fixUint32Tags } from "./lib/msgpackCompat";
import cnApiPlugin from "./routes/api/cn";
import { existsSync } from "fs";
import cnVersionPlugin from "./routes/cnVersion";

// gc-openapi-zinny3.kakaogames.com
// gc-infodesk-zinny3.kakaogames.com
// na.wdfp.kakaogames.com

// initialize server
const fastify = Fastify({
    logger: false,
    // the patched CN client calls /cn/api/index.php/...; it is served by the same API as global
    rewriteUrl: (req) => cnApiUrl(req.url ?? "/") ?? req.url ?? "/"
})

// lets code without the request (the mission data) tell CN requests apart
// CN_INTERNAL_HEADER: a route passing a CN request on to another route (co-op runs the solo battle
// routes with fastify.inject) keeps it a CN request
fastify.addHook('onRequest', (request, reply, done) => runInCnContext(isCnRequest(request.originalUrl) || request.headers[CN_INTERNAL_HEADER] === "1", done))

// CN client log: every request the CN client makes, with its reply status, to see what it needs.
// Written to logs/cn_requests.log.
const cnLogPath = path.join(__dirname, "..", "logs", "cn_requests.log")
fastify.addHook('onResponse', (request, reply, done) => {
    if (isCnRequest(request.originalUrl)) {
        try {
            mkdirSync(path.dirname(cnLogPath), { recursive: true })
            appendFileSync(cnLogPath, `${new Date().toISOString()} ${request.method} ${request.originalUrl} -> ${reply.statusCode} (${Math.round(reply.elapsedTime)} ms)\n  ${JSON.stringify(request.body ?? null)}\n`)
        } catch { }
    }
    done()
})

// download log: the game's asset version checks and mod downloads, to see whether a changed mod
// (translations, event schedule) reaches the game. Written to logs/asset_requests.log.
const assetLogPath = path.join(__dirname, "..", "logs", "asset_requests.log")
fastify.addHook('onResponse', (request, reply, done) => {
    const url = request.url
    if (url.includes("/asset/") || url.includes("/mods/") || url.endsWith("/load") || url.includes("/version_info")) {
        const resVer = request.headers["res_ver"] ?? "-"
        const size = request.headers["asset_size"] ?? "-"
        try {
            mkdirSync(path.dirname(assetLogPath), { recursive: true })
            appendFileSync(assetLogPath, `${new Date().toISOString()} ${request.method} ${url} res_ver=${resVer} asset_size=${size} -> ${reply.statusCode}\n`)
        } catch { }
    }
    done()
})

// serializers
fastify.addHook('onSend', (request, reply, payload, done) => {
    try {
        switch (reply.getHeader('content-type')) {
            case "application/x-msgpack": {
                // the CN client's decoder can't read msgpack uint32 (src/lib/msgpackCompat.ts)
                // and some fields have another shape there (adaptCnReply)
                const cn = isCnRequest(request.originalUrl)
                const packed = pack(cn ? adaptCnReply(payload, cnApiPath(request.originalUrl)) : payload)
                done(null, (cn ? fixUint32Tags(packed) : packed).toString('base64'))
                break;
            }
            default:
                done(null, payload)
        }
    } catch (error) {
        done(null, payload)
    }

})


// error handling
// not found
fastify.setNotFoundHandler((request, reply) => {
    console.log(`[404] ${request.method} ${request.url}\n  ${JSON.stringify(request.body)}`)
    reply.status(404).send({ "error": "Not Found" })
})

// server error
fastify.setErrorHandler((error, request, reply) => {
    console.error(`[500] ${request.method} ${request.url}\n  ${JSON.stringify(request.body)}`)
    console.error(error)
    reply.status(500).send({ "error": "Internal Server Error" })
})

// content-type parsers
function jsonParser(_: FastifyRequest, body: string, done: ContentTypeParserDoneFunction) {
    try {
        var json = JSON.parse(body)
        done(null, json)
    } catch (err) {
        done(null, undefined)
    }
}

fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: 'string' }, (request: FastifyRequest, body: string, done) => {
    // on IOS, for some reason, requests to infodesk and openapi are JSON, but the content-type header is set as 'application/x-www-form-urlencoded'
    const routeUrl = request.routeOptions.url || ''
    if (routeUrl.startsWith("/openapi") || routeUrl.startsWith("/infodesk"))
        return jsonParser(request, body, done);

    try {
        const unpacked = unpack(Buffer.from(body, "base64"))
        done(null, unpacked)
    } catch (err) {
        // the CN client sends its crash reports (/cn/crash) as a plain form
        if (isCnRequest(request.originalUrl)) return done(null, Object.fromEntries(new URLSearchParams(body)))
        done(err as Error, undefined)
    }
})
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, jsonParser)

// register plugins

//api
const apiPrefix = "/latest/api/index.php"
fastify.register(apiPlugin, { prefix: apiPrefix })
fastify.register(assetApiPlugin, { prefix: `${apiPrefix}/asset` })
fastify.register(toolApiPlugin, { prefix: `${apiPrefix}/tool` })
fastify.register(reproduceApiPlugin, { prefix: `${apiPrefix}/reproduce` })
fastify.register(tutorialApiPlugin, { prefix: `${apiPrefix}/tutorial` })
fastify.register(gachaApiPlugin, { prefix: `${apiPrefix}/gacha` })
fastify.register(partyApiPlugin, { prefix: `${apiPrefix}/party` })
fastify.register(expodApiPlugin, { prefix: `${apiPrefix}/expod` })
fastify.register(storyQuestApiPlugin, { prefix: `${apiPrefix}/story_quest` })
fastify.register(optionApiPlugin, { prefix: `${apiPrefix}/option` })
fastify.register(singleBattleQuestApiPlugin, { prefix: `${apiPrefix}/single_battle_quest` })
fastify.register(multiBattleQuestApiPlugin, { prefix: `${apiPrefix}/multi_battle_quest` })
fastify.register(attentionApiPlugin, { prefix: `${apiPrefix}/attention` })
fastify.register(characterApiPlugin, { prefix: `${apiPrefix}/character` })
fastify.register(partyGroupApiPlugin, { prefix: `${apiPrefix}/party_group` })
fastify.register(equipmentApiPlugin, { prefix: `${apiPrefix}/equipment` })
fastify.register(exBoostApiPlugin, { prefix: `${apiPrefix}/ex_boost` })
fastify.register(boxGachaApiPlugin, { prefix: `${apiPrefix}/box_gacha` })
fastify.register(shopApiPlugin, { prefix: `${apiPrefix}/shop` })
fastify.register(howToGetApiPlugin, { prefix: apiPrefix })
fastify.register(comicApiPlugin, { prefix: `${apiPrefix}/comic` })
fastify.register(encyclopediaApiPlugin, { prefix: `${apiPrefix}/encyclopedia` })
fastify.register(mailApiPlugin, { prefix: `${apiPrefix}/mail` })
fastify.register(rankingEventApiPlugin, { prefix: `${apiPrefix}/ranking_event` })
fastify.register(missionApiPlugin, { prefix: `${apiPrefix}/mission` })
fastify.register(activeMissionApiPlugin, { prefix: `${apiPrefix}/active_mission` })
fastify.register(paymentApiPlugin, { prefix: `${apiPrefix}/payment` })
fastify.register(newsApiPlugin, { prefix: `${apiPrefix}/news` })
fastify.register(profileApiPlugin, { prefix: `${apiPrefix}/profile` })
fastify.register(itemApiPlugin, { prefix: `${apiPrefix}/item` })
fastify.register(exchangeApiPlugin, { prefix: `${apiPrefix}/exchange` })
fastify.register(historyApiPlugin, { prefix: `${apiPrefix}/history` })
fastify.register(raidEventApiPlugin, { prefix: `${apiPrefix}/event/raid` })
fastify.register(rushEventApiPlugin, { prefix: `${apiPrefix}/event/rush` })
fastify.register(carnivalEventApiPlugin, { prefix: `${apiPrefix}/carnival_event` })
// the CN client asks for "Pass_card/..." (capital P)
fastify.register(passCardApiPlugin, { prefix: `${apiPrefix}/Pass_card` })
fastify.register(growthFundApiPlugin, { prefix: `${apiPrefix}/growth_fund` })
fastify.register(quest, { prefix: `${apiPrefix}/quest` })
fastify.register(stubsApiPlugin, { prefix: apiPrefix })
// calls only the CN client makes (Leiting login, CN tool calls, title-screen file check)
fastify.register(cnApiPlugin, { prefix: apiPrefix })

// battle log from the StarPoint-patched game client
fastify.register(battleLogPlugin, { prefix: "/starpoint" })

// the patched CN client's version check
fastify.register(cnVersionPlugin, { prefix: CN_PREFIX })

// openapi
fastify.register(openapiPlugin, { prefix: "/openapi/service" })

// infodesk
fastify.register(infodeskPlugin, { prefix: "/infodesk" })
// the phone companion app copies its slim data set from here (src/routes/companion.ts)
fastify.register(companionPlugin, { prefix: "/companion" })

// web routes
fastify.register(indexWebPlugin, { prefix: "/" })

// web api routes
fastify.register(indexWebApiPlugin, { prefix: "/api" })

// web static
fastify.register(fastifyStatic, {
    root: path.join(__dirname, "..", "web/public"),
    prefix: "/public",
    decorateReply: false
})

// static CDN
const cdnDir = process.env.CDN_DIR || ".cdn"
fastify.register(fastifyStatic, {
    root: path.isAbsolute(cdnDir) ? cdnDir : path.join(__dirname, "..", process.env.CDN_DIR || ".cdn"),
    prefix: "/patch/Live/2.0.0",
    decorateReply: false
})

// CN game files (the CN client downloads them from here; see src/lib/cnClient.ts)
if (existsSync(cnCdnRoot())) fastify.register(fastifyStatic, {
    root: cnCdnRoot(),
    prefix: CN_CDN_PREFIX + "/",
    decorateReply: false
})
else console.log(`CN game files not found at ${cnCdnRoot()} (CN_CDN_DIR); the CN client can't download them.`)
// StarPoint's own CN updates (scripts/build_cn_patch.cjs)
mkdirSync(cnPatchDir(), { recursive: true })
fastify.register(fastifyStatic, {
    root: cnPatchDir(),
    prefix: CN_PATCH_PREFIX + "/",
    decorateReply: false
})

// listen
// event schedule (moves events set on the dashboard's Events tab; before the rotation reads the banners)
initEventSchedule()
// yearly seasonal login bonuses and free pulls (the dashboard's Campaigns tab), after the event schedule
initCampaignSchedule()
// banner rotation (does nothing unless BANNER_ROTATION is turned on in the .env file)
initBannerRotation()
// ticking server time (does nothing unless SERVER_TIME_TICKS is turned on in the .env file)
initServerClock()
const listenHost = process.env.LISTEN_HOST ?? "localhost"

const envListenPort = process.env.LISTEN_PORT === undefined ? 8000 : Number.parseInt(process.env.LISTEN_PORT)
const listenPort = isNaN(envListenPort) ? 8000 : envListenPort
fastify.listen({ port: listenPort, host: listenHost }, (err, address) => {
    if (err) {
        console.error(err)
        fastify.log.error(err)
        process.exit(1)
    }
    console.log(`StarPoint is listening on http://${listenHost}:${listenPort}`)
})

// co-op battle connection (multiplayer with COM partners): the game connects to it directly, at the
// address /multi_battle_quest/select_room gives (COOP_HOST, or this PC's network address) and COOP_PORT
startCoopServer(coopPort())

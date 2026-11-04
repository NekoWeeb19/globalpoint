import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import playerRoutePlugin from "./player"
import { getServerDate } from "../../utils";
import { newsBoardPage } from "../../nya/news";

export const staticPagesDir = "../../../web/pages"

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_: FastifyRequest, reply: FastifyReply) => {
        const currentServerTime = getServerDate().toISOString().replace(/\.\d\d\dZ/, "")
        let html = readFileSync(path.join(__dirname, staticPagesDir, "index.html")).toString("utf-8")

        // replace values
        html = html.replace("{{currentServerTime}}", currentServerTime)

        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(html)
    })

    // the Events and Summons tabs are one page in two modes (events, or summon banners)
    const schedulePage = (mode: "events" | "summons") => async (_: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(readFileSync(path.join(__dirname, staticPagesDir, "events.html")).toString("utf-8").replace("{{pageMode}}", mode))
    }
    fastify.get("/events", schedulePage("events"))
    fastify.get("/summons", schedulePage("summons"))
    // yearly seasonal login bonuses and free pulls
    fastify.get("/campaigns", async (_: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(readFileSync(path.join(__dirname, staticPagesDir, "campaigns.html")).toString("utf-8"))
    })

    // the News tab (posts shown in both apps), and the page global's News button opens
    fastify.get("/news", async (_: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(readFileSync(path.join(__dirname, staticPagesDir, "news.html")).toString("utf-8"))
    })
    fastify.get("/news/board", async (_: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(newsBoardPage())
    })

    // the unit editor: ability lines, numbers (scripts/unit_editor.cjs, docs/UNIT_EDITOR.md)
    fastify.get("/unit-editor", async (_: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(readFileSync(path.join(__dirname, staticPagesDir, "unit-editor.html")).toString("utf-8"))
    })

    fastify.register(playerRoutePlugin, { prefix: "/player" })
}

export default routes;
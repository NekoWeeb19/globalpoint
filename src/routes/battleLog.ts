// Receives the battle log from the StarPoint-patched game client (scripts/client_mod): plain-text lines
// such as "12345 BUFF+ m0 ..." / "ABILITY ..." / "DASH ready after 90 frames ...", posted about once a
// second during battles to https://na.wdfp.kakaogames.com/starpoint/battle_log (mitmproxy sends that
// host here). Lines are appended to logs/battle.log, each prefixed with the time it arrived.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { appendFileSync, mkdirSync } from "fs";
import path from "path";

export const BATTLE_LOG_PATH = path.join(process.cwd(), "logs", "battle.log")

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/battle_log", async (request: FastifyRequest, reply: FastifyReply) => {
        const text = typeof request.body === "string" ? request.body : ""
        if (text.length > 0) {
            const stamp = new Date().toISOString()
            const lines = text.split("\n").filter(l => l.length > 0).map(l => `${stamp} ${l}`).join("\n")
            try {
                mkdirSync(path.dirname(BATTLE_LOG_PATH), { recursive: true })
                appendFileSync(BATTLE_LOG_PATH, lines + "\n")
            } catch { }
        }
        return reply.status(200).send("ok")
    })
}

export default routes;

// The patched CN client's calls outside the API (registered under /cn): the version check it makes
// before anything else, its crash/debug reports, and the empty file-recovery list. See src/lib/cnClient.ts.
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import { cnVersionFile } from "../lib/cnClient";

const crashLogPath = path.join(__dirname, "..", "..", "logs", "cn_crash.log")
function logCrash(kind: string, body: unknown) {
    const text = (typeof body === "string" ? body : JSON.stringify(body ?? null)).slice(0, 20000)
    console.log(`[cn ${kind}] ${text.slice(0, 500)}`)
    try {
        mkdirSync(path.dirname(crashLogPath), { recursive: true })
        appendFileSync(crashLogPath, `${new Date().toISOString()} ${kind} ${text}\n`)
    } catch { }
}

const routes = async (fastify: FastifyInstance) => {
    for (const platform of ["android", "ios"]) {
        fastify.get(`/shijtswy/version/client_release_${platform}.dis`, async (request: FastifyRequest, reply: FastifyReply) => {
            reply.header("content-type", "text/plain; charset=utf-8")
            reply.status(200).send(cnVersionFile(request.headers.host ?? "127.0.0.1:8000"))
        })
    }

    // the client's crash reports (cn_crash_url in /load) and debug beacons: logged to logs/cn_crash.log
    fastify.post("/crash", async (request, reply) => { logCrash("crash", request.body); return reply.status(200).send("OK") })
    fastify.post("/debug", async (request, reply) => { logCrash("debug", request.body); return reply.status(200).send("OK") })
    fastify.get("/debug", async (request, reply) => { logCrash("debug", request.query); return reply.status(200).send("OK") })

    // the file-recovery list version_info points at: nothing to recover
    fastify.get("/cdn/recovery/empty.csv", async (_request, reply) => reply.type("text/csv").send(""))
}

export default routes;

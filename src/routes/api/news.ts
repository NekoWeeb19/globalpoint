// news/get_info and news/get_system_info: one post of the dashboard's News tab (src/nya/news.ts),
// for either app. The CN client opens them from its News board; the global client from a home banner
// that links to a post. The global client's html is a whole page, the CN client's rich text.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/wdfpData";
import { generateDataHeaders, getServerDate } from "../../utils";
import { inCnRequest } from "../../lib/cnClient";
import { cnNewsItem, getNews, newsHtml } from "../../nya/news";
import { clientSerializeDate } from "../../data/utils";

interface GetInfoBody {
    api_count: number,
    viewer_id: number,
    news_id: number
}

const routes = async (fastify: FastifyInstance) => {
    for (const route of ["/get_info", "/get_system_info"]) fastify.post(route, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetInfoBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const cn = inCnRequest()
        const found = getNews(Number(body.news_id))
        // a home banner can link to one of the official posts (e.g. CN's banner for news 2245), which this
        // server doesn't have: a 404 sends the client back to its title screen (H404), so a short note is
        // shown instead
        const post = found !== null && found.apps.includes(cn ? "cn" : "global") ? found : {
            id: Number(body.news_id) || 0,
            title: "News",
            body: "This announcement was on the official servers and isn't available here.",
            category: 1 as const,
            apps: [cn ? "cn" as const : "global" as const],
            date: getServerDate().toISOString(),
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": cn ? cnNewsItem(post) : {
                "id": post.id,
                "title": post.title,
                "date": clientSerializeDate(new Date(post.date)),
                "label": cnNewsItem(post).label,
                "thumbnail": cnNewsItem(post).thumbnail,
                "html": `<!DOCTYPE html><html lang="en"><body>${newsHtml(post)}</body></html>`
            }
        })
    })
}

export default routes;

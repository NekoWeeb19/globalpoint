// CN's rank cap over time, from its official posts: the CN app's player rank stops at the cap of the server date, as
// it did in CN (rank points stop at the cap rank's total, like at a max rank; nothing is banked). Before CN's launch
// (the JP-only 2020 dates) the launch cap applies. The global app isn't capped. A dashboard switch turns it off
// (Game settings, src/nya/serverSettings.ts cnRankCapOn).

import player_rank_data from "../../assets/player_rank.json"
import { getServerDate } from "../utils"
import { inCnRequest } from "./cnClient"
import { cnRankCapOn } from "../nya/serverSettings"

/** [from (UTC; CN time - 8 h), rank cap], oldest first. */
export const CN_RANK_CAPS: readonly [string, number][] = [
    ["2021-10-26T02:00:00Z", 100], // launch (the first raise was "100 -> 125")
    ["2021-12-16T04:00:00Z", 125],
    ["2022-06-16T04:00:00Z", 150], // planned for 06-09, delayed a week
    ["2023-02-02T04:00:00Z", 175],
    ["2024-05-09T04:00:00Z", 250],
]

/** CN's rank cap at a time (ms): the launch cap before launch. */
export function cnRankCapAt(ms: number): number {
    let cap = CN_RANK_CAPS[0][1]
    for (const [from, rank] of CN_RANK_CAPS) if (ms >= Date.parse(from)) cap = rank
    return cap
}

/** The total rank points of a rank (the points a save has when it just reached it). */
export function rankTotalPoints(rank: number): number {
    const row = player_rank_data[Math.min(Math.max(rank, 1), player_rank_data.length) - 1]
    return row.total_rp
}

/**
 * The most rank points a save may have now: the CN app's cap rank's total at the server date, or null for no limit
 * (the global app, or the cap turned off on the dashboard). cn: whether it's for the CN app (default: this request).
 */
export function rankPointLimit(now = getServerDate().getTime(), cn = inCnRequest()): number | null {
    if (!cn || !cnRankCapOn()) return null
    const cap = cnRankCapAt(now)
    if (cap >= player_rank_data.length) return null
    return rankTotalPoints(cap)
}

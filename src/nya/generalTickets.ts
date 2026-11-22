// Old summon banners' own tickets, turned into the general ones at /load (CN app). The CN client offers the general
// tickets (999001/999003 unit, 999004/999005 armament) only on banners without tickets of their own, so in the
// 2019-2022 part of the schedule a general ticket showed on no banner (player report 2026-11-22). The update builder
// clears those banners' own tickets (scripts/gen_cn_event_schedule.cjs), so a save's tickets for them would show
// nowhere: they become general tickets, 1-pull for 1-pull and 10-pull for 10-pull. Launch Gala's (banner 1) stay.
// The list: assets/cn_general_ticket_banners.json (scripts/gen_cn_gacha_tickets.cjs).
import generalTickets from "../../assets/cn_general_ticket_banners.json"
import { getPlayerItemSync, givePlayerItemSync, updatePlayerItemSync } from "../data/wdfpData"

const SWAP = (generalTickets as { swap: Record<string, number> }).swap

/** Turns the player's old banner tickets into general ones. Returns how many tickets changed. */
export function swapOldBannerTicketsSync(playerId: number): number {
    let swapped = 0
    for (const [ticket, general] of Object.entries(SWAP)) {
        const count = getPlayerItemSync(playerId, ticket)
        if (!count || count <= 0) continue
        updatePlayerItemSync(playerId, ticket, 0)
        givePlayerItemSync(playerId, general, count)
        swapped += count
    }
    return swapped
}

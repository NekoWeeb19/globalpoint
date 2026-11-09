import player_rank_data from "../../assets/player_rank.json";
import { Player } from "../data/types";
import { updatePlayerSync } from "../data/wdfpData";
import { onPlayerRankUp } from "./delegates";
import { STAMINA_OVERFLOW_MAX, currentStamina, recoverySeconds } from "../lib/stamina";
import { getServerDate } from "../utils";
import { realStaminaOn } from "./serverSettings";
import { bisect } from "./utils";

/**
 * The rank a player with these rank points has: the highest rank whose total_rp they reached (as the game shows it).
 * It used to be the first rank at or above the points, a rank too high unless the points were exactly a rank's
 * total_rp: rank-ups refilled stamina to the next rank's cap (26/25), and rank missions and the Growth Fund came early.
 */
export const getRankByPt = (rankPoint: number) => {
    const i_rank = bisect(player_rank_data, rankPoint, (el) => el.total_rp);
    const exact = i_rank < player_rank_data.length && player_rank_data[i_rank].total_rp === rankPoint
    const index = exact ? i_rank : i_rank - 1
    return player_rank_data[Math.min(Math.max(index, 0), player_rank_data.length - 1)];
}

export const getRank = (rank: number) => player_rank_data[rank - 1]; // rank is 1-indexed

interface PlayerEx extends Player {
    _modified?: Set<keyof Player>
}

export const modifyPlayer = <K extends keyof Player>(player: Player, name: K, value: Player[K]) => {
    player[name] = value;
    const plex = player as PlayerEx;
    if (!plex._modified) plex._modified = new Set();
    plex._modified.add(name);
}

export const commitPlayer = (player: Player) => {
    const plex = player as PlayerEx;
    if (!plex._modified) return;
    const modified = plex._modified;
    delete plex._modified;
    if (!modified.size) return;
    const param: Partial<Player> & Pick<Player, 'id'> = Object.fromEntries([
        ['id', player.id],
        ...Array.from(modified).map(key => [key, player[key]])
    ]);
    return updatePlayerSync(param);
}

export const givePlayerRankPoint = (playerData: Player, rankPoint: number) => {
    // modify playerData in place
    if (!playerData) throw new Error("Player not found");
    const currentRank = getRankByPt(playerData.rankPoint);
    modifyPlayer(playerData, 'rankPoint', playerData.rankPoint + rankPoint);
    const newRank = getRankByPt(playerData.rankPoint);
    if (newRank.rank > currentRank.rank) {
        if (realStaminaOn()) {
            // real stamina (src/nya/stamina.ts): each new rank's maximum is added to the stamina now, as the game does
            const now = getServerDate().getTime()
            const before = currentStamina({ stamina: playerData.stamina, healTimeMs: playerData.staminaHealTime.getTime() }, now,
                currentRank.stamina, recoverySeconds(currentRank.stamina_heal_time_decrease_rate))
            let gained = 0
            for (let rank = currentRank.rank + 1; rank <= newRank.rank; rank++) gained += getRank(rank).stamina
            modifyPlayer(playerData, 'stamina', Math.min(STAMINA_OVERFLOW_MAX, before + gained));
            modifyPlayer(playerData, 'staminaHealTime', new Date(now));
        } else {
            // stamina isn't spent: a rank-up fills it to the new rank's maximum
            modifyPlayer(playerData, 'stamina', newRank.stamina);
        }
        onPlayerRankUp.call(playerData, newRank.rank);
    }
    return playerData;
}

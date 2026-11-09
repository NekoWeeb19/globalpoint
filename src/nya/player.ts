import player_rank_data from "../../assets/player_rank.json";
import { Player } from "../data/types";
import { updatePlayerSync } from "../data/wdfpData";
import { onPlayerRankUp } from "./delegates";
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
    // a rank-up refills stamina to the new rank's cap
    const newRank = getRankByPt(playerData.rankPoint);
    if (newRank.rank > currentRank.rank) {
        modifyPlayer(playerData, 'stamina', newRank.stamina);
        onPlayerRankUp.call(playerData, newRank.rank);
    }
    return playerData;
}

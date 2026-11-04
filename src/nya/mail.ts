import { getPlayerItemSync, getPlayerSync, givePlayerItemSync, updatePlayerSync } from "../data/wdfpData"
import { givePlayerCharacterSync } from "../lib/character"
import { givePlayerEquipmentSync } from "../lib/equipment"
import { epochOf, getServerDate } from "../utils"
import { ClientError } from "./utils"
import { recordReceivedSync } from "./receiveHistory"
import { InfiniteMail, infiniteMailOn } from "./serverSettings"

export interface Mail_ {
    "id": number,
    "create_time": string,
    "description"?: string,
    "number": number,
    "reason_id": number,
    "receive_time": string,
    "reward_limit_time"?: string,
    "reward_period_limited": boolean,
    "subject"?: string,
    "type": number,
    "type_id"?: number,
}

export interface Mail {
    "subject"?: string,
    "description"?: string,
    "reason_id"?: number,
    "type": number,
    "type_id"?: number,
    "number": number,
}

enum SPECIAL_MAIL_ID {
    START = 90000000,
    BREAD_1500,
    MANA_1500,
    EXP_1500,
}

export enum MAIL_TYPE {
    ITEM = 1, // with type_id
    PAID_VIRTUAL_MONEY = 3,
    FREE_VIRTUAL_MONEY = 4,
    CHARACTER = 5, // with type_id
    EQUIPMENT = 6, // with type_id
    STAR_CRUMB = 7,
    FREE_MANA = 8,
    POOL_EXP = 9,
    BOND_TOKEN = 10,
    BOSS_BOOST_POINT = 11,
    BOOST_POINT = 12,
    DEGREE = 13,  // with type_id
    DAILY_CHALLENGE_POINT = 14,  // with type_id
    RANK_POINT = 15,
    PERIODIC_REWARD_POINT = 16,  // with type_id
}

const SpecialMails: Mail_[] = [
    {
        "id": SPECIAL_MAIL_ID.BREAD_1500,
        "create_time": "2020-01-01 12:00:00",
        "reason_id": 1,
        "receive_time": "0000-00-00 00:00:00",
        "reward_limit_time": "2099-01-01 12:00:00",
        "reward_period_limited": false,
        "type": MAIL_TYPE.PAID_VIRTUAL_MONEY,
        "number": 1500,
        "subject": "Bread * 1500",
        "description": "^W^",
    },
    {
        "id": SPECIAL_MAIL_ID.MANA_1500,
        "create_time": "2020-01-01 12:00:00",
        "reason_id": 1,
        "receive_time": "0000-00-00 00:00:00",
        "reward_limit_time": "2099-01-01 12:00:00",
        "reward_period_limited": false,
        "type": MAIL_TYPE.FREE_MANA,
        "number": 1500,
        "subject": "Mana * 1500",
        "description": "^W^",
    },
    {
        "id": SPECIAL_MAIL_ID.EXP_1500,
        "create_time": "2020-01-01 12:00:00",
        "reason_id": 1,
        "receive_time": "0000-00-00 00:00:00",
        "reward_limit_time": "2099-01-01 12:00:00",
        "reward_period_limited": false,
        "type": MAIL_TYPE.POOL_EXP,
        "number": 1500,
        "subject": "Exp * 1500",
        "description": "^W^",
    },
]

// which dashboard switch each never-ending mail follows (src/nya/serverSettings.ts)
const SPECIAL_MAIL_SWITCH: Record<number, InfiniteMail> = {
    [SPECIAL_MAIL_ID.BREAD_1500]: "bread",
    [SPECIAL_MAIL_ID.MANA_1500]: "mana",
    [SPECIAL_MAIL_ID.EXP_1500]: "exp",
}
/** The never-ending mails switched on on the dashboard. */
const activeSpecialMails = () => SpecialMails.filter(mail => infiniteMailOn(SPECIAL_MAIL_SWITCH[mail.id]))

let MailIdCounter = 10000000
const CachedMails: Record<number, Mail_[]> = {}


const date2str = (date: Date) => {
    return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")
}

/** Drops a player's unclaimed mails that give this unit (removing a unit from a save). Returns how many. */
export function removeCharacterMails(playerId: number, characterId: number): number {
    const mails = CachedMails[playerId]
    if (!mails) return 0
    const kept = mails.filter(m => !(m.type === MAIL_TYPE.CHARACTER && Number(m.type_id) === characterId))
    const removed = mails.length - kept.length
    CachedMails[playerId] = kept
    return removed
}

export const SendMail = (player_id: number, mail: Mail) => {
    if (!CachedMails[player_id]) CachedMails[player_id] = []
    const mail_ = {
        "id": MailIdCounter++,
        // the server's clock, not the real one: the game shows "N days ago" from its own date
        "create_time": date2str(getServerDate()),
        "reason_id": 1,
        "receive_time": "0000-00-00 00:00:00",
        "reward_limit_time": "2099-01-01 12:00:00",
        "reward_period_limited": false,
        ...mail,
    }
    CachedMails[player_id].push(mail_)
    console.log(`Mail sent to player ${player_id}: ${JSON.stringify(mail_)}`)
}

// the built-in mails never run out; they're shown as just sent (server time) (their fixed
// 2020 date showed as "2194 days ago")
export const GetMails = (player_id: number) => {
    const now = new Date(getServerDate().getTime() - 60_000)
    return activeSpecialMails().map(mail => ({ ...mail, "create_time": date2str(now) })).concat(CachedMails[player_id] || [])
}

interface MailResult {
    user_info?: { [key: string]: number },
    item_list?: { [itemId: string]: number },
    character_list?: Object[],
    equipment_list?: Object[],
}

const mailTotalCount = (player_id: number) => activeSpecialMails().length + (CachedMails[player_id]?.length ?? 0)

const process_mail = (player_id: number, mail: Mail): MailResult => {
    const result = give_mail(player_id, mail)
    recordReceivedSync(player_id, [{ type: mail.type, type_id: mail.type_id ?? null, number: mail.number, reason_id: mail.reason_id, subject: mail.subject, description: mail.description }])
    return result
}

const give_mail = (player_id: number, { type, type_id, number }: Mail): MailResult => {
    const player = getPlayerSync(player_id);
    if (!player) throw new ClientError(`Player not found: ${player_id}`)
    switch (type) {
        case MAIL_TYPE.ITEM:
            {
                if (!type_id) throw new ClientError(`Mail type_id not found: ${type_id}`);
                return { "item_list": { [type_id]: givePlayerItemSync(player_id, type_id, number) } };
            }
        case MAIL_TYPE.PAID_VIRTUAL_MONEY:
            {
                const new_vmoney = player.vmoney + number;
                updatePlayerSync({
                    id: player_id,
                    vmoney: new_vmoney,
                });
                return { "user_info": { "vmoney": new_vmoney } };
            }
        case MAIL_TYPE.FREE_VIRTUAL_MONEY:
            {
                const new_vmoney = player.freeVmoney + number;
                updatePlayerSync({
                    id: player_id,
                    freeVmoney: new_vmoney,
                });
                return { "user_info": { "free_vmoney": new_vmoney } };
            }
        case MAIL_TYPE.CHARACTER:
            {
                if (!type_id) throw new ClientError(`Mail type_id not found: ${type_id}`)
                const characters: Map<number, Object> = new Map();
                // the game expects the player's NEW TOTAL of each item here, not the amount given
                const items: { [itemId: string]: number } = {};
                for (let i = 0; i < number; i++) {
                    const giveResult = givePlayerCharacterSync(player_id, type_id);
                    if (!giveResult)
                        throw new ClientError(`Could not give player character: ${type_id} at ${i}`)
                    const giveItem = giveResult.item
                    if (giveItem !== undefined) {
                        items[giveItem.id] = getPlayerItemSync(player_id, giveItem.id) ?? giveItem.count
                    }
                    // merge, so a later duplicate (stack + 1) doesn't drop the full first-time fields
                    characters.set(type_id, { ...(characters.get(type_id) ?? {}), ...giveResult.character })
                };
                const result: MailResult = { "character_list": Array.from(characters.values()) };
                if (Object.keys(items).length > 0) result.item_list = items;
                return result;
            }
        case MAIL_TYPE.EQUIPMENT:
            {
                if (!type_id) throw new ClientError(`Mail type_id not found: ${type_id}`);
                const giveResult = givePlayerEquipmentSync(player_id, type_id, number);
                return { "equipment_list": [giveResult] };
            }
        case MAIL_TYPE.FREE_MANA:
            {
                const new_mana = player.freeMana + number;
                updatePlayerSync({
                    id: player_id,
                    freeMana: new_mana,
                });
                return { "user_info": { "free_mana": new_mana } };
            }
        case MAIL_TYPE.POOL_EXP:
            {
                const new_pool_exp = player.expPool + number;
                updatePlayerSync({
                    id: player_id,
                    expPool: new_pool_exp,
                });
                return {
                    "user_info": {
                        "exp_pool": new_pool_exp,
                        "exp_pooled_time": epochOf(player.expPooledTime),
                    }
                };
            }
        default:
            throw new ClientError(`Mail type not implemented: ${type}`)
    }
}

/**
 * Claims a single mail. Matches the recorded /mail/receive response.
 */
export const ProcessMail = (player_id: number, mail_id: number) => {
    let data: MailResult;
    if (mail_id >= SPECIAL_MAIL_ID.START) {
        const mail = activeSpecialMails().find(mail => mail.id === mail_id)
        if (!mail) throw new ClientError(`Mail not found: ${mail_id}`)
        data = process_mail(player_id, mail)
    } else {
        const mail = CachedMails[player_id]?.find(mail => mail.id === mail_id)
        if (!mail) throw new ClientError(`Mail not found: ${mail_id}`)
        data = process_mail(player_id, mail) // throws before removal, so a failed claim keeps the mail
        CachedMails[player_id] = CachedMails[player_id]?.filter(mail => mail.id !== mail_id)
        if (CachedMails[player_id]?.length === 0) delete CachedMails[player_id]
    }
    const total_count = mailTotalCount(player_id)
    return {
        auto_sale_expired_mail: false,
        dispose_expired_mail: false,
        total_count,
        ...data,
        mail_arrived: total_count > 0,
    }
}

/**
 * Claims the mails the client asked for (mail_ids), or every mail if no list is given.
 * Matches the recorded /mail/receive_all response. A mail that fails is left in the list
 * (and left out of the returned mail_ids) instead of aborting the whole claim.
 * The built-in special mails are never claimed here, since they never get used up.
 */
export const ProcessAllMails = (player_id: number, mail_ids?: number[]) => {
    const requested = mail_ids ? new Set(mail_ids) : null
    const pending = (CachedMails[player_id] ?? []).filter(mail => requested === null || requested.has(mail.id))

    const user_info: { [key: string]: number } = {};
    const character_list: Map<number, Object> = new Map();
    const item_list: { [itemId: string]: number } = {};
    const equipment_list: Map<number, Object> = new Map();
    const claimed = new Set<number>();

    for (const mail of pending) {
        let result: MailResult;
        try {
            result = process_mail(player_id, mail);
        } catch (e) {
            console.error(`Could not claim mail ${mail.id} for player ${player_id}:`, e)
            continue
        }
        claimed.add(mail.id)
        Object.assign(user_info, result.user_info)
        Object.assign(item_list, result.item_list)
        for (const character of result.character_list ?? []) {
            const { character_id } = (character as { character_id: number })
            character_list.set(character_id, { ...(character_list.get(character_id) ?? {}), ...character })
        }
        for (const equipment of result.equipment_list ?? []) {
            const { equipment_id } = (equipment as { equipment_id: number })
            equipment_list.set(equipment_id, equipment)
        }
    }

    if (claimed.size > 0) {
        const remaining = (CachedMails[player_id] ?? []).filter(mail => !claimed.has(mail.id))
        if (remaining.length > 0) CachedMails[player_id] = remaining
        else delete CachedMails[player_id]
    }

    const total_count = mailTotalCount(player_id)
    const res: { [k: string]: any } = {
        mail_ids: Array.from(claimed),
        deleted_mail_count: 0,
        already_mail_count: 0,
        outdated_mail_count: 0,
        dispose_expired_mail_count: 0,
        auto_sale_expired_mail_count: 0,
        max_overed_mail_count: 0,
        total_count,
        mail_arrived: total_count > 0,
    }
    if (Object.keys(user_info).length > 0) res.user_info = user_info;
    if (character_list.size > 0) res.character_list = Array.from(character_list.values());
    if (Object.keys(item_list).length > 0) res.item_list = item_list;
    if (equipment_list.size > 0) res.equipment_list = Array.from(equipment_list.values());
    return res;
}

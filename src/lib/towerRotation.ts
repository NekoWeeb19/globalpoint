/**
 * The Haunt (the CN client's tower dungeon event) changes its floors every month on the 12th, 05:00 China time.
 * CN's table has 48 monthly floor sets of 10 quests (quest ids 1001-1480: set n is 1000 + 10(n-1) + floor), for
 * 2022-05-12 to 2026-05-12. StarPoint opens The Haunt a year earlier (2021-05-12) and keeps it open, so the months
 * outside CN's get copies of the sets that carry on the same loop (2022-05 is set 1, 2022-06 set 2, ..., so
 * 2021-05 is set 37 and 2026-05 set 1 again). A copy has its own quest ids, so its floors start uncleared like a
 * new month's do. scripts/gen_cn_event_schedule.cjs adds the copies to the game's table (for the game clock's
 * year -1 to +1, like the yearly campaign copies); the server maps a copy's quest id back to its floor's rewards.
 *
 * The game takes a floor's quest id from its row's key in the table (quest id = 1000 + key, for The Haunt's
 * event 1), not from the row's id column, so every copy month has fixed keys: after CN's 480 rows come the 12
 * months before CN's (2021-05 to 2022-04, keys 481-600), then every month from 2026-05 on (keys 601 up), 10 each.
 */

const SETS = 48
const FLOORS = 10
const FIRST_SET_QUEST = 1001

const monthIndex = (year: number, month: number) => year * 12 + (month - 1)
/** the first month StarPoint opens The Haunt (from 2021-05-12 12:00, China time) */
export const TOWER_FIRST_MONTH = { year: 2021, month: 5 }
const FIRST = monthIndex(TOWER_FIRST_MONTH.year, TOWER_FIRST_MONTH.month)
/** CN's own months: 2022-05 (set 1) up to 2026-04 (set 48) */
const REAL_FROM = monthIndex(2022, 5)
const REAL_UNTIL = monthIndex(2026, 4)

/** The floor set (1-48) the month starting on the 12th of year/month shows. */
export function towerSetForMonth(year: number, month: number): number {
    const d = monthIndex(year, month) - REAL_FROM
    return ((d % SETS) + SETS) % SETS + 1
}

/** Whether CN's table already has this month (no copy needed). */
export function isCnTowerMonth(year: number, month: number): boolean {
    const i = monthIndex(year, month)
    return i >= REAL_FROM && i <= REAL_UNTIL
}

/** Whether a copy exists for this month at all (StarPoint's Haunt starts 2021-05). */
export function isTowerCopyMonth(year: number, month: number): boolean {
    return monthIndex(year, month) >= FIRST && !isCnTowerMonth(year, month)
}

/** CN's quest id of a floor (1-10) of a set (1-48). */
export function towerQuestId(set: number, floor: number): number {
    return FIRST_SET_QUEST + (set - 1) * FLOORS + (floor - 1)
}

/** months before CN's that get copies (2021-05 to 2022-04) */
const EARLY_MONTHS = REAL_FROM - FIRST
/** the quest id the game gives a row: 1000 (event 1) + its key */
const KEY_TO_QUEST = 1000
const CN_ROWS = SETS * FLOORS

/** A copy month's place among all copy months (0 = 2021-05, 12 = 2026-05). */
function copySlot(year: number, month: number): number {
    const i = monthIndex(year, month)
    return i < REAL_FROM ? i - FIRST : EARLY_MONTHS + (i - REAL_UNTIL - 1)
}

/** The table key of a floor (1-10) in a copy month (CN's own rows are keys 1-480). */
export function towerCopyKey(year: number, month: number, floor: number): number {
    return CN_ROWS + copySlot(year, month) * FLOORS + floor
}

/** The quest id of a floor (1-10) in a copy month (what the game sends: 1000 + its key). */
export function towerCopyQuestId(year: number, month: number, floor: number): number {
    return KEY_TO_QUEST + towerCopyKey(year, month, floor)
}

/** For a copy's quest id: the CN quest id it copies (same floor of the month's set). CN's own ids come back as they are. */
export function towerOriginalQuestId(questId: number): number {
    const k = questId - KEY_TO_QUEST - CN_ROWS - 1
    if (k < 0) return questId
    const slot = Math.floor(k / FLOORS)
    const index = slot < EARLY_MONTHS ? FIRST + slot : REAL_UNTIL + 1 + (slot - EARLY_MONTHS)
    const year = Math.floor(index / 12), month = index % 12 + 1
    return towerQuestId(towerSetForMonth(year, month), k % FLOORS + 1)
}

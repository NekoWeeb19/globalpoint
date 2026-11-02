// How many times a player bought each shop item: today, this month and in total, as the shop list
// reports them (today_purchase_num, this_month_purchase_num, total_purchase_num). The game reads the
// count that fits the item's limit (daily, monthly or for good) and shows "N/limit" from it.
// Days start at the daily reset (05:00 UTC, like the missions) on the server's date.

import getDatabase, { Database } from "../data"
import { dayNumber } from "../lib/mission"
import { getServerDate } from "../utils"

let tableReady = false
function db() {
    const database = getDatabase(Database.WDFP_DATA)
    if (!tableReady) {
        database.prepare(`CREATE TABLE IF NOT EXISTS players_shop_purchases (
            player_id INTEGER NOT NULL,
            shop_type INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,
            day_key INTEGER NOT NULL DEFAULT 0,
            day_count INTEGER NOT NULL DEFAULT 0,
            month_key TEXT NOT NULL DEFAULT '',
            month_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, shop_type, item_id),
            FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
        )`).run()
        tableReady = true
    }
    return database
}

function periods() {
    const ms = getServerDate().getTime()
    const day = dayNumber(ms)
    // the month the reset-shifted day falls in
    const month = new Date(ms - 5 * 60 * 60 * 1000).toISOString().slice(0, 7)
    return { day, month }
}

export interface PurchaseCounts { today: number, month: number, total: number }

interface Row { shop_type: number, item_id: number, total: number, day_key: number, day_count: number, month_key: string, month_count: number }

/** Every item the player bought, by "<shop type>:<item id>". */
export function getPlayerShopPurchasesSync(playerId: number): Map<string, PurchaseCounts> {
    const { day, month } = periods()
    const rows = db().prepare(`SELECT shop_type, item_id, total, day_key, day_count, month_key, month_count
        FROM players_shop_purchases WHERE player_id = ?`).all(playerId) as Row[]
    return new Map(rows.map(r => [`${r.shop_type}:${r.item_id}`, {
        today: r.day_key === day ? r.day_count : 0,
        month: r.month_key === month ? r.month_count : 0,
        total: r.total,
    }]))
}

/** Adds a purchase of `amount` of an item. */
export function recordShopPurchaseSync(playerId: number, shopType: number, itemId: number, amount: number) {
    const { day, month } = periods()
    const current = getPlayerShopPurchasesSync(playerId).get(`${shopType}:${itemId}`) ?? { today: 0, month: 0, total: 0 }
    db().prepare(`INSERT INTO players_shop_purchases (player_id, shop_type, item_id, total, day_key, day_count, month_key, month_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (player_id, shop_type, item_id) DO UPDATE SET
            total = excluded.total, day_key = excluded.day_key, day_count = excluded.day_count,
            month_key = excluded.month_key, month_count = excluded.month_count`)
        .run(playerId, shopType, itemId, current.total + amount, day, current.today + amount, month, current.month + amount)
}

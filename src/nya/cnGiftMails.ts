// CN's own gift and compensation mails (assets/cn_gift_mails.json, from CN's official Bilibili posts), sent to every
// save of the CN app on CN's dates, on by default. Each item of a gift is one built-in scheduled mail
// (src/nya/mailSchedule.ts): it arrives when the server time reaches the gift's time, can be claimed for 30 days, and
// a gift more than 30 days old when a save first looks is skipped (moving the date far ahead doesn't pour out years
// of gifts). The dashboard's Mail tab turns them all off, or removes single gifts:
//
// .database/cn_gift_mails.json   { off?: true, removed?: [gift ids] }

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import path from "path"
import type { MailKind, MailSchedule } from "./mailSchedule"

const ASSET = path.join(__dirname, "..", "..", "assets", "cn_gift_mails.json")
const DIR = path.join(process.cwd(), ".database")
const SETTINGS_FILE = path.join(DIR, "cn_gift_mails.json")

/** Schedule ids of the gifts: FIRST_ID + gift id × 100 + the item's place (far above the Mail tab's own ids). */
export const FIRST_ID = 1_000_000_000
const PER_GIFT = 100

export interface CnGiftItem { kind: MailKind, typeId?: number, amount: number }
export interface CnGift { id: number, post: string, at: string, title: string, titleZh?: string, items: CnGiftItem[] }
interface GiftFile { message: string, messageZh?: string, mails: CnGift[] }
export interface CnGiftSettings { off?: boolean, removed?: number[] }

let assetCache: GiftFile | null = null
export function cnGifts(): GiftFile {
    if (assetCache === null) {
        try { assetCache = JSON.parse(readFileSync(ASSET, "utf8")) as GiftFile } catch { assetCache = { message: "", mails: [] } }
    }
    return assetCache
}

let settingsCache: { mtimeMs: number, value: CnGiftSettings } | null = null
export function cnGiftSettings(): CnGiftSettings {
    try {
        if (!existsSync(SETTINGS_FILE)) return {}
        const mtimeMs = statSync(SETTINGS_FILE).mtimeMs
        if (settingsCache === null || settingsCache.mtimeMs !== mtimeMs) settingsCache = { mtimeMs, value: JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) }
        return { ...settingsCache.value }
    } catch {
        return {}
    }
}
function saveSettings(value: CnGiftSettings) {
    mkdirSync(DIR, { recursive: true })
    const clean: CnGiftSettings = {}
    if (value.off) clean.off = true
    if (value.removed && value.removed.length) clean.removed = [...new Set(value.removed)].sort((a, b) => a - b)
    writeFileSync(SETTINGS_FILE, JSON.stringify(clean, null, 1))
    settingsCache = null
}

/** Turns all of CN's gifts on or off. */
export function setCnGiftsOn(on: boolean) {
    saveSettings({ ...cnGiftSettings(), off: !on })
}
/** Removes one gift (it won't be sent) or puts it back. Throws for an unknown gift. */
export function setCnGiftRemoved(id: number, removed: boolean) {
    if (!cnGifts().mails.some(g => g.id === id)) throw new Error("There's no such gift.")
    const s = cnGiftSettings()
    const list = new Set(s.removed ?? [])
    if (removed) list.add(id)
    else list.delete(id)
    saveSettings({ ...s, removed: [...list] })
}

/** A gift mail's Chinese title and message (the game set to Chinese: src/nya/gameLanguage.ts), or null. */
export function cnGiftTextZh(scheduleId: number): { title: string, message: string } | null {
    if (!isCnGiftScheduleId(scheduleId)) return null
    const file = cnGifts()
    const gift = file.mails.find(g => g.id === giftIdOf(scheduleId))
    return gift?.titleZh && file.messageZh ? { title: gift.titleZh, message: file.messageZh } : null
}

/** The schedule id of a gift's item, and back. */
export const scheduleIdOf = (giftId: number, item: number) => FIRST_ID + giftId * PER_GIFT + item
export const isCnGiftScheduleId = (id: number) => id >= FIRST_ID
export const giftIdOf = (scheduleId: number) => Math.floor((scheduleId - FIRST_ID) / PER_GIFT)

/** Every gift item as a built-in schedule (none when turned off; removed gifts left out). */
export function cnGiftSchedules(): MailSchedule[] {
    const settings = cnGiftSettings()
    if (settings.off) return []
    const removed = new Set(settings.removed ?? [])
    const file = cnGifts()
    return file.mails.filter(g => !removed.has(g.id)).flatMap(g => g.items.map((item, i): MailSchedule => ({
        id: scheduleIdOf(g.id, i),
        kind: item.kind,
        typeId: item.typeId ?? null,
        amount: item.amount,
        title: g.title,
        message: file.message,
        start: g.at,
        every: 0,
        unit: "day",
        times: 1,
        everyone: true,
        // no mail "right away" when it's already past: each one comes at its own time, or not at all
        catchUp: false,
        savedAt: 0,
    })))
}

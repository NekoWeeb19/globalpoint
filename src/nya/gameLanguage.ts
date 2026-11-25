// The CN game's language, set on the dashboard's Game settings tab (.database/game_language.json, read with
// scripts/game_language.cjs): "en" (GlobalPoint's English, the default) or "zh" (CN's own Simplified Chinese).
// A change rebuilds the CN game update: in Chinese every table the game has goes back to CN's own text, with
// GlobalPoint's data changes kept (scripts/cn_language.cjs); back in English the English copies are sent again.
// The server's own text for the game (mail titles, the automatic news posts) follows the setting too.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import { rebuildCnUpdate } from "./eventSchedule"
import { inCnRequest } from "../lib/cnClient"

const GL = require(path.join(__dirname, "..", "..", "scripts", "game_language.cjs")) as {
    LANGUAGES: readonly string[]
    DEFAULT_LANGUAGE: string
    FILE_NAME: string
    readGameLanguage: (dataDir: string) => string
}

export type GameLanguage = "en" | "zh"
export const GAME_LANGUAGES: readonly GameLanguage[] = ["en", "zh"]
const DATA_DIR = path.join(process.cwd(), ".database")
const FILE = path.join(DATA_DIR, GL.FILE_NAME)

/** The language the game is set to. */
export function getGameLanguage(): GameLanguage {
    return GL.readGameLanguage(DATA_DIR) as GameLanguage
}

/** Whether the game is set to Chinese. */
export const isChineseGame = (): boolean => getGameLanguage() === "zh"

/** Sets the game's language; a change rebuilds the CN game update. Throws for an unknown language. */
export function setGameLanguage(value: unknown): GameLanguage {
    if (typeof value !== "string" || !(GAME_LANGUAGES as readonly string[]).includes(value)) throw new Error("The language must be \"en\" or \"zh\".")
    const before = getGameLanguage()
    if (value === GL.DEFAULT_LANGUAGE) {
        try { if (existsSync(FILE)) unlinkSync(FILE) } catch { }
    } else {
        mkdirSync(DATA_DIR, { recursive: true })
        writeFileSync(FILE, JSON.stringify({ language: value }))
    }
    const after = getGameLanguage()
    if (after !== before) rebuildCnUpdate()
    return after
}

/** Whether this request's text should be Chinese: the CN app, with the game set to Chinese (the global app stays English). */
export const chineseForRequest = (): boolean => isChineseGame() && inCnRequest()

/** Picks the text for this request: Chinese for the CN app when the game is set to Chinese, else English. */
export const gameText = (en: string, zh: string): string => chineseForRequest() ? zh : en

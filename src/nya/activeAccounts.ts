// Which account each app plays on, picked on the dashboard's Players tab (.database/active_accounts.json).
//  - global: when set, the global app's sign-in (/tool/signup) opens this account instead of the one its
//    own guest login belongs to. Nothing about the login itself changes, so clearing it goes back.
//  - cn: the account the CN app plays on. When the file doesn't say, CN_ACCOUNT_ID in .env decides;
//    null means each CN device uses its own account.
// The game picks up a change the next time it's opened (back to the title screen and in again).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

export type AccountApp = "global" | "cn"
type Stored = Partial<Record<AccountApp, number | null>>

const FILE = path.join(process.cwd(), ".database", "active_accounts.json")

function read(): Stored {
    try {
        if (!existsSync(FILE)) return {}
        const raw = JSON.parse(readFileSync(FILE, "utf8"))
        return typeof raw === "object" && raw !== null ? raw : {}
    } catch {
        return {}
    }
}

const valid = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null

/** The account an app is switched to on the dashboard: a number, null (its own login), or undefined (not set). */
export function chosenAccount(app: AccountApp): number | null | undefined {
    const stored = read()
    if (!(app in stored)) return undefined
    return valid(stored[app])
}

/** Switches an app to an account (null: its own login). */
export function setChosenAccount(app: AccountApp, accountId: number | null) {
    const stored = read()
    stored[app] = accountId === null ? null : valid(accountId)
    mkdirSync(path.dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(stored, null, 1))
}

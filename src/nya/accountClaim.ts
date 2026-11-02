// Stores the pending account claim (src/lib/accountClaim.ts) in .database/account_claim.json, so it
// survives a server restart while the game is being reinstalled. A claim is used once.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { AccountClaim, claimedAccount, newAccountClaim, parseAccountClaim } from "../lib/accountClaim"

const CLAIM_FILE = path.join(process.cwd(), ".database", "account_claim.json")

function readClaim(): AccountClaim | null {
    try {
        return existsSync(CLAIM_FILE) ? parseAccountClaim(JSON.parse(readFileSync(CLAIM_FILE, "utf-8"))) : null
    } catch {
        return null
    }
}

export function setAccountClaim(accountId: number, nowMs = Date.now()): AccountClaim {
    const claim = newAccountClaim(accountId, nowMs)
    mkdirSync(path.dirname(CLAIM_FILE), { recursive: true })
    writeFileSync(CLAIM_FILE, JSON.stringify(claim))
    return claim
}

export function clearAccountClaim(): void {
    rmSync(CLAIM_FILE, { force: true })
}

/** The pending claim, if still valid (for the dashboard). */
export function getAccountClaim(nowMs = Date.now()): AccountClaim | null {
    const claim = readClaim()
    return claimedAccount(claim, nowMs) === null ? null : claim
}

/** Uses up the claim: the account a new login should take over, or null. */
export function takeAccountClaim(nowMs = Date.now()): number | null {
    const claim = readClaim()
    if (claim === null) return null
    clearAccountClaim()
    return claimedAccount(claim, nowMs)
}

// Account claim: lets the next NEW guest login take over an existing account instead of creating a
// fresh one. Needed after reinstalling the game (for example the re-signed StarPoint client): the guest
// login's device key changes, so the server would otherwise see a brand-new player.

export interface AccountClaim {
    accountId: number
    /** the claim is only used before this time (ms since epoch) */
    expiresMs: number
}

/** How long a claim waits for the reinstalled game's first login. */
export const ACCOUNT_CLAIM_MINUTES = 30

export function newAccountClaim(accountId: number, nowMs: number, minutes = ACCOUNT_CLAIM_MINUTES): AccountClaim {
    return { accountId, expiresMs: nowMs + minutes * 60_000 }
}

/** Reads a stored claim; anything malformed counts as no claim. */
export function parseAccountClaim(raw: unknown): AccountClaim | null {
    if (typeof raw !== "object" || raw === null) return null
    const { accountId, expiresMs } = raw as Record<string, unknown>
    if (!Number.isInteger(accountId) || typeof expiresMs !== "number" || !Number.isFinite(expiresMs)) return null
    return { accountId: accountId as number, expiresMs }
}

/** The account a new login should take over, or null (no claim, or it expired). */
export function claimedAccount(claim: AccountClaim | null, nowMs: number): number | null {
    return claim !== null && nowMs < claim.expiresMs ? claim.accountId : null
}

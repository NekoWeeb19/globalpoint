// Tests src/lib/accountClaim.ts (built to out/). Run: npm run build && node scripts/test_account_claim.mjs
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { newAccountClaim, parseAccountClaim, claimedAccount, ACCOUNT_CLAIM_MINUTES } = require("../out/lib/accountClaim.js")

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log("ok", name) }

const now = Date.UTC(2026, 9, 30, 12)
check("a new claim lasts the set minutes", () => {
    const c = newAccountClaim(5, now)
    assert.equal(c.accountId, 5)
    assert.equal(c.expiresMs, now + ACCOUNT_CLAIM_MINUTES * 60_000)
})
check("claim is used before it expires", () => {
    const c = newAccountClaim(5, now)
    assert.equal(claimedAccount(c, now + 1000), 5)
})
check("expired claim is ignored", () => {
    const c = newAccountClaim(5, now)
    assert.equal(claimedAccount(c, c.expiresMs), null)
})
check("no claim -> null", () => assert.equal(claimedAccount(null, now), null))
check("stored claim round-trips", () => {
    const c = newAccountClaim(7, now)
    assert.deepEqual(parseAccountClaim(JSON.parse(JSON.stringify(c))), c)
})
check("malformed stored claims are ignored", () => {
    for (const raw of [null, 3, "x", {}, { accountId: "5", expiresMs: now }, { accountId: 5.5, expiresMs: now }, { accountId: 5, expiresMs: "soon" }])
        assert.equal(parseAccountClaim(raw), null)
})
console.log(`${checks} checks passed`)

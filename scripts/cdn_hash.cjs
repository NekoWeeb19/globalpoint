// The game's file names: every CDN file is stored under SHA1(<logical path> + SALT), split after the
// first two hex digits (production/upload/ab/cdef...). Same rule in global and CN (from the Chinese
// StarPoint fork, src/content/cdn/asset-path-hash.ts). The server has its own copy in src/nya/eventSchedule.ts.
const crypto = require("crypto")

const SALT = "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy"

/** The full SHA1 hex of a logical path. */
const hashHex = logical => crypto.createHash("sha1").update(logical + SALT).digest("hex")

/** "ab/cdef..." for a logical path (the part after production/<folder>/). */
const hashName = logical => { const h = hashHex(logical); return `${h.slice(0, 2)}/${h.slice(2)}` }

/** "production/upload/ab/cdef..." (or another folder, e.g. medium_upload) for a logical path. */
// (folder only when given as a name, so .map(uploadPath) works)
const uploadPath = (logical, folder) => `production/${typeof folder === "string" ? folder : "upload"}/${hashName(logical)}`

module.exports = { SALT, hashHex, hashName, uploadPath }

// Opens a SQLite database with better-sqlite3 when it loads (the PC), or with Node's built-in
// node:sqlite (Node 22.5+) when it doesn't, as on the phone companion (companion/README.md), where
// no better-sqlite3 build exists. SQLITE_DRIVER="node" forces node:sqlite for testing.
// The node:sqlite side covers only what the server uses: pragma, exec, prepare().run/get/all/iterate,
// transaction() and close().

import type { Database as BetterSqlite3Database } from "better-sqlite3"

export function openDatabase(file: string): BetterSqlite3Database {
    if (process.env.SQLITE_DRIVER !== "node") {
        try {
            const BetterSqlite3 = require("better-sqlite3")
            return new BetterSqlite3(file)
        } catch (error) {
            console.warn(`[sqlite] better-sqlite3 not usable (${(error as Error).message.split("\n")[0]}); using node:sqlite`)
        }
    }
    return new NodeSqliteDatabase(file) as unknown as BetterSqlite3Database
}

// node:sqlite gives rows with no prototype and blobs as Uint8Array; better-sqlite3 gives plain objects and Buffers
function plainRow(row: any): any {
    if (row === undefined || row === null) return row
    const out: any = {}
    for (const key in row) {
        const value = row[key]
        out[key] = value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : value
    }
    return out
}

// better-sqlite3 takes arrays as lists of values (`.run([a, b])`), which node:sqlite would read as
// named values; binds undefined as NULL, which node:sqlite refuses; and ignores keys of a named-value
// object that the SQL doesn't use, where node:sqlite throws
const nullish = (value: any) => value === undefined ? null : value
function flat(params: any[], names: Set<string>): any[] {
    return params.flat().map(p => {
        if (p === null || typeof p !== "object" || ArrayBuffer.isView(p)) return nullish(p)
        const named: any = {}
        for (const key in p) if (names.has(key)) named[key] = nullish(p[key])
        return named
    })
}

// the @name / :name / $name parameters in a statement, skipping quoted text and comments
function parameterNames(source: string): Set<string> {
    const names = new Set<string>()
    const pattern = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[@:$]([A-Za-z_][A-Za-z0-9_]*)/g
    for (const m of source.matchAll(pattern)) if (m[1] !== undefined) names.add(m[1])
    return names
}

// node:sqlite throws on integers beyond 2^53 where better-sqlite3 returns a rounded number
const isTooBig = (error: any) => error?.code === "ERR_OUT_OF_RANGE"
const roundBig = (row: any) => {
    if (row === undefined || row === null) return row
    for (const key in row) if (typeof row[key] === "bigint") row[key] = Number(row[key])
    return row
}

class NodeSqliteStatement {
    private readonly names: Set<string>
    constructor(private readonly statement: any, source: string) { this.names = parameterNames(source) }

    private read<T>(fn: () => T, fix: (value: T) => T): T {
        try {
            return fn()
        } catch (error) {
            if (!isTooBig(error)) throw error
            this.statement.setReadBigInts(true)
            try { return fix(fn()) } finally { this.statement.setReadBigInts(false) }
        }
    }

    run(...params: any[]) { return this.statement.run(...flat(params, this.names)) }
    get(...params: any[]) {
        const args = flat(params, this.names)
        return plainRow(this.read(() => this.statement.get(...args), roundBig))
    }
    all(...params: any[]) {
        const args = flat(params, this.names)
        return this.read(() => this.statement.all(...args), (rows: any[]) => rows.map(roundBig)).map(plainRow)
    }
    *iterate(...params: any[]) { yield* this.all(...params) }
}

class NodeSqliteDatabase {
    private readonly db: any
    private readonly statements = new Map<string, NodeSqliteStatement>()
    private depth = 0

    constructor(file: string) {
        const { DatabaseSync } = require("node:sqlite")
        this.db = new DatabaseSync(file)
    }

    pragma(source: string) { return this.db.prepare(`PRAGMA ${source}`).all().map(plainRow) }
    exec(source: string) { this.db.exec(source); return this }
    close() { this.db.close() }

    // better-sqlite3 code often prepares the same SQL in every call; keep compiled statements
    prepare(source: string) {
        let statement = this.statements.get(source)
        if (statement === undefined) {
            if (this.statements.size >= 1000) this.statements.clear()
            statement = new NodeSqliteStatement(this.db.prepare(source), source)
            this.statements.set(source, statement)
        }
        return statement
    }

    // like better-sqlite3: BEGIN/COMMIT at the outer level, savepoints when nested, rollback on throw;
    // .deferred/.immediate/.exclusive pick the BEGIN kind
    transaction<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R {
        const make = (begin: string) => (...args: A) => {
            const savepoint = `sp${this.depth}`
            this.db.exec(this.depth === 0 ? begin : `SAVEPOINT ${savepoint}`)
            this.depth++
            try {
                const result = fn(...args)
                this.depth--
                this.db.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`)
                return result
            } catch (error) {
                this.depth--
                if (this.depth === 0) this.db.exec("ROLLBACK")
                else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
                throw error
            }
        }
        return Object.assign(make("BEGIN"), { deferred: make("BEGIN DEFERRED"), immediate: make("BEGIN IMMEDIATE"), exclusive: make("BEGIN EXCLUSIVE") })
    }
}

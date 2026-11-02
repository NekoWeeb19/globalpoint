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
// named values, and binds undefined as NULL, which node:sqlite refuses
const nullish = (value: any) => value === undefined ? null : value
function flat(params: any[]): any[] {
    return params.flat().map(p => {
        if (p === null || typeof p !== "object" || ArrayBuffer.isView(p)) return nullish(p)
        const named: any = {}
        for (const key in p) named[key] = nullish(p[key])
        return named
    })
}

class NodeSqliteStatement {
    constructor(private readonly statement: any) {}
    run(...params: any[]) { return this.statement.run(...flat(params)) }
    get(...params: any[]) { return plainRow(this.statement.get(...flat(params))) }
    all(...params: any[]) { return this.statement.all(...flat(params)).map(plainRow) }
    *iterate(...params: any[]) { for (const row of this.statement.iterate(...flat(params))) yield plainRow(row) }
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
            statement = new NodeSqliteStatement(this.db.prepare(source))
            this.statements.set(source, statement)
        }
        return statement
    }

    // like better-sqlite3: BEGIN/COMMIT at the outer level, savepoints when nested, rollback on throw
    transaction<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R {
        return (...args: A) => {
            const savepoint = `sp${this.depth}`
            this.db.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`)
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
    }
}

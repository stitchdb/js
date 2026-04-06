export interface StitchDBConfig {
  url?: string
  apiKey: string
}

export interface QueryResult<T = Record<string, unknown>> {
  results: T[]
  meta: {
    rows_read: number
    rows_written: number
    last_row_id?: number | null
    duration_ms: number
    cached?: boolean
  }
}

export interface BatchResult {
  results: Record<string, unknown>[][]
  meta: {
    rows_read: number
    rows_written: number
    duration_ms: number
    queries_count: number
  }
}

export interface ExecResult {
  meta: {
    rows_read: number
    rows_written: number
    duration_ms: number
  }
}

export class StitchDBError extends Error {
  status: number
  constructor(message: string, status: number = 0) {
    super(message)
    this.name = 'StitchDBError'
    this.status = status
  }
}

/**
 * StitchDB client.
 *
 * Uses HTTP/2 with persistent connections (via fetch keep-alive).
 * All requests share one TCP connection — no repeated TLS handshakes.
 * Batch API sends multiple queries in one request.
 */
export class StitchDB {
  private url: string
  private apiKey: string
  private headers: Record<string, string>

  constructor(config: StitchDBConfig) {
    this.url = (config.url || 'https://db.stitchdb.com').replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /** Run a SQL query with parameterized bindings. */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.post<QueryResult<T>>('/v1/query', { sql, params })
  }

  /**
   * Run multiple queries in a single HTTP request.
   * All queries execute atomically. One Worker invocation for N queries.
   */
  async batch(queries: { sql: string; params?: unknown[] }[]): Promise<BatchResult> {
    return this.post<BatchResult>('/v1/batch', { queries })
  }

  /** Run a DDL statement (CREATE TABLE, ALTER TABLE, DROP TABLE, etc.) */
  async run(sql: string): Promise<ExecResult> {
    return this.post<ExecResult>('/v1/exec', { sql })
  }

  /** Insert a row. */
  async insert(table: string, data: Record<string, unknown>): Promise<QueryResult> {
    const cols = Object.keys(data)
    const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    return this.query(sql, Object.values(data))
  }

  /**
   * Insert multiple rows in a single request using batch API.
   * One Worker invocation regardless of how many rows.
   */
  async insertMany(table: string, rows: Record<string, unknown>[]): Promise<BatchResult> {
    if (rows.length === 0) return { results: [], meta: { rows_read: 0, rows_written: 0, duration_ms: 0, queries_count: 0 } }
    const cols = Object.keys(rows[0])
    const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    return this.batch(rows.map(row => ({ sql, params: cols.map(c => row[c]) })))
  }

  /** Update rows matching a WHERE clause. */
  async update(table: string, data: Record<string, unknown>, where: string, whereParams?: unknown[]): Promise<QueryResult> {
    const set = Object.keys(data).map(c => `"${c}" = ?`).join(', ')
    return this.query(`UPDATE "${table}" SET ${set} WHERE ${where}`, [...Object.values(data), ...(whereParams || [])])
  }

  /** Delete rows matching a WHERE clause. */
  async remove(table: string, where: string, whereParams?: unknown[]): Promise<QueryResult> {
    return this.query(`DELETE FROM "${table}" WHERE ${where}`, whereParams)
  }

  /** Find one row by ID. */
  async find<T = Record<string, unknown>>(table: string, id: unknown, idColumn = 'id'): Promise<T | null> {
    const { results } = await this.query<T>(`SELECT * FROM "${table}" WHERE "${idColumn}" = ? LIMIT 1`, [id])
    return results[0] || null
  }

  /** Select rows with optional WHERE, ORDER BY, LIMIT, OFFSET. */
  async select<T = Record<string, unknown>>(
    table: string,
    where?: string,
    params?: unknown[],
    opts?: { orderBy?: string; limit?: number; offset?: number }
  ): Promise<T[]> {
    let sql = `SELECT * FROM "${table}"`
    if (where) sql += ` WHERE ${where}`
    if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`
    if (opts?.limit) sql += ` LIMIT ${opts.limit}`
    if (opts?.offset) sql += ` OFFSET ${opts.offset}`
    const { results } = await this.query<T>(sql, params)
    return results
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      // @ts-ignore — keepalive hint for HTTP/2 connection reuse
      keepalive: true,
    })

    const data = await res.json() as T & { error?: string }

    if (!res.ok || data.error) {
      throw new StitchDBError(data.error || `Request failed: ${res.status}`, res.status)
    }

    return data
  }
}

/** Create a StitchDB client. */
export function createClient(config: StitchDBConfig): StitchDB {
  return new StitchDB(config)
}

export default StitchDB

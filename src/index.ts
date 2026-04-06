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

export class StitchDB {
  private url: string
  private wsUrl: string
  private apiKey: string
  private ws: WebSocket | null = null
  private pending: Map<string, { resolve: (v: any) => void; reject: (e: any) => void }> = new Map()
  private msgId = 0
  private connecting: Promise<void> | null = null
  private useWebSocket: boolean

  constructor(config: StitchDBConfig) {
    this.url = (config.url || 'https://db.stitchdb.com').replace(/\/$/, '')
    this.wsUrl = this.url.replace('https://', 'wss://').replace('http://', 'ws://')
    this.apiKey = config.apiKey
    // WebSocket only works in environments with global WebSocket (Node 22+, Bun, Deno, browsers)
    this.useWebSocket = typeof WebSocket !== 'undefined'
  }

  private async connect(): Promise<void> {
    if (this.ws?.readyState === 1) return // OPEN
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(`${this.wsUrl}/ws/query?key=${this.apiKey}`)

        ws.onopen = () => {
          this.ws = ws
          this.connecting = null
          resolve()
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(typeof event.data === 'string' ? event.data : '')
            const pending = this.pending.get(data.id)
            if (pending) {
              this.pending.delete(data.id)
              if (data.error) {
                pending.reject(new StitchDBError(data.error))
              } else {
                pending.resolve(data)
              }
            }
          } catch { /* ignore non-JSON */ }
        }

        ws.onclose = () => {
          this.ws = null
          this.connecting = null
          // Reject all pending
          for (const [id, p] of this.pending) {
            p.reject(new StitchDBError('Connection closed'))
            this.pending.delete(id)
          }
        }

        ws.onerror = () => {
          this.ws = null
          this.connecting = null
          reject(new StitchDBError('WebSocket connection failed'))
        }
      } catch {
        this.connecting = null
        this.useWebSocket = false // Fallback to HTTP
        resolve()
      }
    })

    return this.connecting
  }

  private async wsSend(msg: any): Promise<any> {
    await this.connect()

    if (!this.ws || this.ws.readyState !== 1) {
      // Fallback to HTTP
      this.useWebSocket = false
      return this.httpQuery(msg)
    }

    const id = String(++this.msgId)
    msg.id = id

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new StitchDBError('Query timeout'))
      }, 30000)

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      this.ws!.send(JSON.stringify(msg))
    })
  }

  private async httpQuery(msg: any): Promise<any> {
    let path = '/v1/query'
    let body: any = { sql: msg.sql, params: msg.params }

    if (msg.action === 'batch') {
      path = '/v1/batch'
      body = { queries: msg.queries }
    } else if (msg.action === 'exec') {
      path = '/v1/exec'
      body = { sql: msg.sql }
    }

    const res = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json() as any
    if (!res.ok || data.error) {
      throw new StitchDBError(data.error || `Request failed: ${res.status}`, res.status)
    }
    return data
  }

  /** Run a SQL query with parameterized bindings. */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (this.useWebSocket) {
      return this.wsSend({ action: 'query', sql, params })
    }
    return this.httpQuery({ action: 'query', sql, params })
  }

  /** Run multiple queries atomically in a single batch. */
  async batch(queries: { sql: string; params?: unknown[] }[]): Promise<BatchResult> {
    if (this.useWebSocket) {
      return this.wsSend({ action: 'batch', queries })
    }
    return this.httpQuery({ action: 'batch', queries })
  }

  /** Run a DDL statement (CREATE TABLE, ALTER TABLE, DROP TABLE, etc.) */
  async run(sql: string): Promise<ExecResult> {
    if (this.useWebSocket) {
      return this.wsSend({ action: 'exec', sql })
    }
    return this.httpQuery({ action: 'exec', sql })
  }

  /** Insert a row. */
  async insert(table: string, data: Record<string, unknown>): Promise<QueryResult> {
    const cols = Object.keys(data)
    const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    return this.query(sql, Object.values(data))
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

  /** Close the WebSocket connection. */
  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

/** Create a StitchDB client. */
export function createClient(config: StitchDBConfig): StitchDB {
  return new StitchDB(config)
}

export default StitchDB

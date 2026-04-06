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
 * Uses WebSocket for queries (1 connection, unlimited queries, $0.019/M cost).
 * Falls back to HTTP if WebSocket unavailable.
 */
export class StitchDB {
  private url: string
  private wsUrl: string
  private apiKey: string
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private msgId = 0
  private connecting: Promise<void> | null = null
  private wsSupported: boolean
  private wsFailed = false

  constructor(config: StitchDBConfig) {
    this.url = (config.url || 'https://db.stitchdb.com').replace(/\/$/, '')
    this.wsUrl = this.url.replace('https://', 'wss://').replace('http://', 'ws://')
    this.apiKey = config.apiKey
    this.wsSupported = typeof WebSocket !== 'undefined'
  }

  // ---- WebSocket ----

  private async connect(): Promise<void> {
    if (this.ws?.readyState === 1) return
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(`${this.wsUrl}/ws/query?key=${this.apiKey}`)
        ws.onopen = () => { this.ws = ws; this.connecting = null; resolve() }
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(typeof e.data === 'string' ? e.data : '')
            const p = this.pending.get(data.id)
            if (p) { this.pending.delete(data.id); data.error ? p.reject(new StitchDBError(data.error)) : p.resolve(data) }
          } catch {}
        }
        ws.onclose = () => {
          this.ws = null; this.connecting = null
          for (const [, p] of this.pending) p.reject(new StitchDBError('Connection closed'))
          this.pending.clear()
        }
        ws.onerror = () => { this.ws = null; this.connecting = null; this.wsFailed = true; resolve() }
      } catch { this.connecting = null; this.wsFailed = true; resolve() }
    })
    return this.connecting
  }

  private async wsSend(msg: any): Promise<any> {
    if (this.wsFailed) return this.httpPost(msg)
    await this.connect()
    if (!this.ws || this.ws.readyState !== 1) { this.wsFailed = true; return this.httpPost(msg) }

    const id = String(++this.msgId)
    msg.id = id

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new StitchDBError('Query timeout')) }, 30000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })
      try {
        this.ws!.send(JSON.stringify(msg))
      } catch {
        clearTimeout(timeout); this.pending.delete(id); this.wsFailed = true
        this.httpPost(msg).then(resolve, reject)
      }
    })
  }

  // ---- HTTP fallback ----

  private async httpPost(msg: any): Promise<any> {
    let path = '/v1/query', body: any = { sql: msg.sql, params: msg.params }
    if (msg.action === 'batch') { path = '/v1/batch'; body = { queries: msg.queries } }
    else if (msg.action === 'exec') { path = '/v1/exec'; body = { sql: msg.sql } }

    const res = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as any
    if (!res.ok || data.error) throw new StitchDBError(data.error || `HTTP ${res.status}`, res.status)
    return data
  }

  // ---- Public API ----

  private async send(action: string, data: any): Promise<any> {
    const msg = { action, ...data }
    if (this.wsSupported && !this.wsFailed) return this.wsSend(msg)
    return this.httpPost(msg)
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.send('query', { sql, params })
  }

  async batch(queries: { sql: string; params?: unknown[] }[]): Promise<BatchResult> {
    return this.send('batch', { queries })
  }

  async run(sql: string): Promise<ExecResult> {
    return this.send('exec', { sql })
  }

  async insert(table: string, data: Record<string, unknown>): Promise<QueryResult> {
    const cols = Object.keys(data)
    return this.query(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(data))
  }

  async insertMany(table: string, rows: Record<string, unknown>[]): Promise<BatchResult> {
    if (!rows.length) return { results: [], meta: { rows_read: 0, rows_written: 0, duration_ms: 0, queries_count: 0 } }
    const cols = Object.keys(rows[0])
    const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    return this.batch(rows.map(row => ({ sql, params: cols.map(c => row[c]) })))
  }

  async update(table: string, data: Record<string, unknown>, where: string, whereParams?: unknown[]): Promise<QueryResult> {
    return this.query(`UPDATE "${table}" SET ${Object.keys(data).map(c => `"${c}" = ?`).join(', ')} WHERE ${where}`, [...Object.values(data), ...(whereParams || [])])
  }

  async remove(table: string, where: string, whereParams?: unknown[]): Promise<QueryResult> {
    return this.query(`DELETE FROM "${table}" WHERE ${where}`, whereParams)
  }

  async find<T = Record<string, unknown>>(table: string, id: unknown, idColumn = 'id'): Promise<T | null> {
    const { results } = await this.query<T>(`SELECT * FROM "${table}" WHERE "${idColumn}" = ? LIMIT 1`, [id])
    return results[0] || null
  }

  async select<T = Record<string, unknown>>(table: string, where?: string, params?: unknown[], opts?: { orderBy?: string; limit?: number; offset?: number }): Promise<T[]> {
    let sql = `SELECT * FROM "${table}"`
    if (where) sql += ` WHERE ${where}`
    if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`
    if (opts?.limit) sql += ` LIMIT ${opts.limit}`
    if (opts?.offset) sql += ` OFFSET ${opts.offset}`
    const { results } = await this.query<T>(sql, params)
    return results
  }

  close(): void { if (this.ws) { this.ws.close(); this.ws = null } }
}

export function createClient(config: StitchDBConfig): StitchDB { return new StitchDB(config) }
export default StitchDB

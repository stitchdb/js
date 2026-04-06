// src/index.ts
var StitchDBError = class extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "StitchDBError";
    this.status = status;
  }
};
var StitchDB = class {
  constructor(config) {
    this.ws = null;
    this.pending = /* @__PURE__ */ new Map();
    this.msgId = 0;
    this.connecting = null;
    this.wsFailed = false;
    this.url = (config.url || "https://db.stitchdb.com").replace(/\/$/, "");
    this.wsUrl = this.url.replace("https://", "wss://").replace("http://", "ws://");
    this.apiKey = config.apiKey;
    this.wsSupported = typeof WebSocket !== "undefined";
  }
  // ---- WebSocket ----
  async connect() {
    if (this.ws?.readyState === 1) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(`${this.wsUrl}/ws/query?key=${this.apiKey}`);
        ws.onopen = () => {
          this.ws = ws;
          this.connecting = null;
          resolve();
        };
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(typeof e.data === "string" ? e.data : "");
            const p = this.pending.get(data.id);
            if (p) {
              this.pending.delete(data.id);
              data.error ? p.reject(new StitchDBError(data.error)) : p.resolve(data);
            }
          } catch {
          }
        };
        ws.onclose = () => {
          this.ws = null;
          this.connecting = null;
          for (const [, p] of this.pending) p.reject(new StitchDBError("Connection closed"));
          this.pending.clear();
        };
        ws.onerror = () => {
          this.ws = null;
          this.connecting = null;
          this.wsFailed = true;
          resolve();
        };
      } catch {
        this.connecting = null;
        this.wsFailed = true;
        resolve();
      }
    });
    return this.connecting;
  }
  async wsSend(msg) {
    if (this.wsFailed) return this.httpPost(msg);
    await this.connect();
    if (!this.ws || this.ws.readyState !== 1) {
      this.wsFailed = true;
      return this.httpPost(msg);
    }
    const id = String(++this.msgId);
    msg.id = id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new StitchDBError("Query timeout"));
      }, 3e4);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        }
      });
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        clearTimeout(timeout);
        this.pending.delete(id);
        this.wsFailed = true;
        this.httpPost(msg).then(resolve, reject);
      }
    });
  }
  // ---- HTTP fallback ----
  async httpPost(msg) {
    let path = "/v1/query", body = { sql: msg.sql, params: msg.params };
    if (msg.action === "batch") {
      path = "/v1/batch";
      body = { queries: msg.queries };
    } else if (msg.action === "exec") {
      path = "/v1/exec";
      body = { sql: msg.sql };
    }
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new StitchDBError(data.error || `HTTP ${res.status}`, res.status);
    return data;
  }
  // ---- Public API ----
  async send(action, data) {
    const msg = { action, ...data };
    if (this.wsSupported && !this.wsFailed) return this.wsSend(msg);
    return this.httpPost(msg);
  }
  async query(sql, params) {
    return this.send("query", { sql, params });
  }
  async batch(queries) {
    return this.send("batch", { queries });
  }
  async run(sql) {
    return this.send("exec", { sql });
  }
  async insert(table, data) {
    const cols = Object.keys(data);
    return this.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, Object.values(data));
  }
  async insertMany(table, rows) {
    if (!rows.length) return { results: [], meta: { rows_read: 0, rows_written: 0, duration_ms: 0, queries_count: 0 } };
    const cols = Object.keys(rows[0]);
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    return this.batch(rows.map((row) => ({ sql, params: cols.map((c) => row[c]) })));
  }
  async update(table, data, where, whereParams) {
    return this.query(`UPDATE "${table}" SET ${Object.keys(data).map((c) => `"${c}" = ?`).join(", ")} WHERE ${where}`, [...Object.values(data), ...whereParams || []]);
  }
  async remove(table, where, whereParams) {
    return this.query(`DELETE FROM "${table}" WHERE ${where}`, whereParams);
  }
  async find(table, id, idColumn = "id") {
    const { results } = await this.query(`SELECT * FROM "${table}" WHERE "${idColumn}" = ? LIMIT 1`, [id]);
    return results[0] || null;
  }
  async select(table, where, params, opts) {
    let sql = `SELECT * FROM "${table}"`;
    if (where) sql += ` WHERE ${where}`;
    if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
    if (opts?.limit) sql += ` LIMIT ${opts.limit}`;
    if (opts?.offset) sql += ` OFFSET ${opts.offset}`;
    const { results } = await this.query(sql, params);
    return results;
  }
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
};
function createClient(config) {
  return new StitchDB(config);
}
var index_default = StitchDB;
export {
  StitchDB,
  StitchDBError,
  createClient,
  index_default as default
};

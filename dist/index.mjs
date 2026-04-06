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
    this.url = (config.url || "https://db.stitchdb.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.headers = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
  }
  /** Run a SQL query with parameterized bindings. */
  async query(sql, params) {
    return this.post("/v1/query", { sql, params });
  }
  /**
   * Run multiple queries in a single HTTP request.
   * All queries execute atomically. One Worker invocation for N queries.
   */
  async batch(queries) {
    return this.post("/v1/batch", { queries });
  }
  /** Run a DDL statement (CREATE TABLE, ALTER TABLE, DROP TABLE, etc.) */
  async run(sql) {
    return this.post("/v1/exec", { sql });
  }
  /** Insert a row. */
  async insert(table, data) {
    const cols = Object.keys(data);
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    return this.query(sql, Object.values(data));
  }
  /**
   * Insert multiple rows in a single request using batch API.
   * One Worker invocation regardless of how many rows.
   */
  async insertMany(table, rows) {
    if (rows.length === 0) return { results: [], meta: { rows_read: 0, rows_written: 0, duration_ms: 0, queries_count: 0 } };
    const cols = Object.keys(rows[0]);
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    return this.batch(rows.map((row) => ({ sql, params: cols.map((c) => row[c]) })));
  }
  /** Update rows matching a WHERE clause. */
  async update(table, data, where, whereParams) {
    const set = Object.keys(data).map((c) => `"${c}" = ?`).join(", ");
    return this.query(`UPDATE "${table}" SET ${set} WHERE ${where}`, [...Object.values(data), ...whereParams || []]);
  }
  /** Delete rows matching a WHERE clause. */
  async remove(table, where, whereParams) {
    return this.query(`DELETE FROM "${table}" WHERE ${where}`, whereParams);
  }
  /** Find one row by ID. */
  async find(table, id, idColumn = "id") {
    const { results } = await this.query(`SELECT * FROM "${table}" WHERE "${idColumn}" = ? LIMIT 1`, [id]);
    return results[0] || null;
  }
  /** Select rows with optional WHERE, ORDER BY, LIMIT, OFFSET. */
  async select(table, where, params, opts) {
    let sql = `SELECT * FROM "${table}"`;
    if (where) sql += ` WHERE ${where}`;
    if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
    if (opts?.limit) sql += ` LIMIT ${opts.limit}`;
    if (opts?.offset) sql += ` OFFSET ${opts.offset}`;
    const { results } = await this.query(sql, params);
    return results;
  }
  async post(path, body) {
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      // @ts-ignore — keepalive hint for HTTP/2 connection reuse
      keepalive: true
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new StitchDBError(data.error || `Request failed: ${res.status}`, res.status);
    }
    return data;
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

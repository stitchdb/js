"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  StitchDB: () => StitchDB,
  StitchDBError: () => StitchDBError,
  createClient: () => createClient,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
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
    this.url = (config.url || "https://db.stitchdb.com").replace(/\/$/, "");
    this.wsUrl = this.url.replace("https://", "wss://").replace("http://", "ws://");
    this.apiKey = config.apiKey;
    this.useWebSocket = typeof WebSocket !== "undefined";
  }
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
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(typeof event.data === "string" ? event.data : "");
            const pending = this.pending.get(data.id);
            if (pending) {
              this.pending.delete(data.id);
              if (data.error) {
                pending.reject(new StitchDBError(data.error));
              } else {
                pending.resolve(data);
              }
            }
          } catch {
          }
        };
        ws.onclose = () => {
          this.ws = null;
          this.connecting = null;
          for (const [id, p] of this.pending) {
            p.reject(new StitchDBError("Connection closed"));
            this.pending.delete(id);
          }
        };
        ws.onerror = () => {
          this.ws = null;
          this.connecting = null;
          reject(new StitchDBError("WebSocket connection failed"));
        };
      } catch {
        this.connecting = null;
        this.useWebSocket = false;
        resolve();
      }
    });
    return this.connecting;
  }
  async wsSend(msg) {
    await this.connect();
    if (!this.ws || this.ws.readyState !== 1) {
      this.useWebSocket = false;
      return this.httpQuery(msg);
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
      this.ws.send(JSON.stringify(msg));
    });
  }
  async httpQuery(msg) {
    let path = "/v1/query";
    let body = { sql: msg.sql, params: msg.params };
    if (msg.action === "batch") {
      path = "/v1/batch";
      body = { queries: msg.queries };
    } else if (msg.action === "exec") {
      path = "/v1/exec";
      body = { sql: msg.sql };
    }
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new StitchDBError(data.error || `Request failed: ${res.status}`, res.status);
    }
    return data;
  }
  /** Run a SQL query with parameterized bindings. */
  async query(sql, params) {
    if (this.useWebSocket) {
      return this.wsSend({ action: "query", sql, params });
    }
    return this.httpQuery({ action: "query", sql, params });
  }
  /** Run multiple queries atomically in a single batch. */
  async batch(queries) {
    if (this.useWebSocket) {
      return this.wsSend({ action: "batch", queries });
    }
    return this.httpQuery({ action: "batch", queries });
  }
  /** Run a DDL statement (CREATE TABLE, ALTER TABLE, DROP TABLE, etc.) */
  async run(sql) {
    if (this.useWebSocket) {
      return this.wsSend({ action: "exec", sql });
    }
    return this.httpQuery({ action: "exec", sql });
  }
  /** Insert a row. */
  async insert(table, data) {
    const cols = Object.keys(data);
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    return this.query(sql, Object.values(data));
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
  /** Close the WebSocket connection. */
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StitchDB,
  StitchDBError,
  createClient
});

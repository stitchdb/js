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
  constructor(message, status) {
    super(message);
    this.name = "StitchDBError";
    this.status = status;
  }
};
var StitchDB = class {
  constructor(config) {
    this.url = (config.url || "https://db.stitchdb.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }
  /** Run a SQL query with parameterized bindings. */
  async query(sql, params) {
    return this.post("/v1/query", { sql, params });
  }
  /** Run multiple queries atomically in a single batch. */
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

interface StitchDBConfig {
    url?: string;
    apiKey: string;
}
interface QueryResult<T = Record<string, unknown>> {
    results: T[];
    meta: {
        rows_read: number;
        rows_written: number;
        last_row_id?: number | null;
        duration_ms: number;
        cached?: boolean;
    };
}
interface BatchResult {
    results: Record<string, unknown>[][];
    meta: {
        rows_read: number;
        rows_written: number;
        duration_ms: number;
        queries_count: number;
    };
}
interface ExecResult {
    meta: {
        rows_read: number;
        rows_written: number;
        duration_ms: number;
    };
}
declare class StitchDBError extends Error {
    status: number;
    constructor(message: string, status?: number);
}
declare class StitchDB {
    private url;
    private wsUrl;
    private apiKey;
    private ws;
    private pending;
    private msgId;
    private connecting;
    private useWebSocket;
    constructor(config: StitchDBConfig);
    private connect;
    private wsSend;
    private httpQuery;
    /** Run a SQL query with parameterized bindings. */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
    /** Run multiple queries atomically in a single batch. */
    batch(queries: {
        sql: string;
        params?: unknown[];
    }[]): Promise<BatchResult>;
    /** Run a DDL statement (CREATE TABLE, ALTER TABLE, DROP TABLE, etc.) */
    run(sql: string): Promise<ExecResult>;
    /** Insert a row. */
    insert(table: string, data: Record<string, unknown>): Promise<QueryResult>;
    /** Update rows matching a WHERE clause. */
    update(table: string, data: Record<string, unknown>, where: string, whereParams?: unknown[]): Promise<QueryResult>;
    /** Delete rows matching a WHERE clause. */
    remove(table: string, where: string, whereParams?: unknown[]): Promise<QueryResult>;
    /** Find one row by ID. */
    find<T = Record<string, unknown>>(table: string, id: unknown, idColumn?: string): Promise<T | null>;
    /** Select rows with optional WHERE, ORDER BY, LIMIT, OFFSET. */
    select<T = Record<string, unknown>>(table: string, where?: string, params?: unknown[], opts?: {
        orderBy?: string;
        limit?: number;
        offset?: number;
    }): Promise<T[]>;
    /** Close the WebSocket connection. */
    close(): void;
}
/** Create a StitchDB client. */
declare function createClient(config: StitchDBConfig): StitchDB;

export { type BatchResult, type ExecResult, type QueryResult, StitchDB, type StitchDBConfig, StitchDBError, createClient, StitchDB as default };

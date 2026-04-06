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
/**
 * StitchDB client.
 *
 * Uses WebSocket for queries (1 connection, unlimited queries, $0.019/M cost).
 * Falls back to HTTP if WebSocket unavailable.
 */
declare class StitchDB {
    private url;
    private wsUrl;
    private apiKey;
    private ws;
    private pending;
    private msgId;
    private connecting;
    private wsSupported;
    private wsFailed;
    constructor(config: StitchDBConfig);
    private connect;
    private wsSend;
    private httpPost;
    private send;
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
    batch(queries: {
        sql: string;
        params?: unknown[];
    }[]): Promise<BatchResult>;
    run(sql: string): Promise<ExecResult>;
    insert(table: string, data: Record<string, unknown>): Promise<QueryResult>;
    insertMany(table: string, rows: Record<string, unknown>[]): Promise<BatchResult>;
    update(table: string, data: Record<string, unknown>, where: string, whereParams?: unknown[]): Promise<QueryResult>;
    remove(table: string, where: string, whereParams?: unknown[]): Promise<QueryResult>;
    find<T = Record<string, unknown>>(table: string, id: unknown, idColumn?: string): Promise<T | null>;
    select<T = Record<string, unknown>>(table: string, where?: string, params?: unknown[], opts?: {
        orderBy?: string;
        limit?: number;
        offset?: number;
    }): Promise<T[]>;
    close(): void;
}
declare function createClient(config: StitchDBConfig): StitchDB;

export { type BatchResult, type ExecResult, type QueryResult, StitchDB, type StitchDBConfig, StitchDBError, createClient, StitchDB as default };

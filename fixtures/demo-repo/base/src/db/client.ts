import { Pool } from "pg";

/**
 * Thin data-access layer. SQL is always executed through parameterized
 * queries: pass user-supplied values as params, never by string building.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export interface QueryResult<T> {
  rows: T[];
}

export const db = {
  /** Parameterized query. `sql` contains placeholders ($1, ?), values go in `params`. */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  },

  async close(): Promise<void> {
    await pool.end();
  },
};

/**
 * D1 query helpers.
 *
 * Cloudflare D1 is a SQLite-based database. All queries use the
 * D1 binding's prepare().bind().all() pattern.
 */

/** Insert a single row. Returns { success, error? } */
export async function d1Insert(
  db: D1Database,
  table: string,
  row: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
  try {
    const result = await db.prepare(sql).bind(...Object.values(row)).run();
    return { success: result.success };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Insert multiple rows in a batch. Returns { success, error? } */
export async function d1InsertBatch(
  db: D1Database,
  table: string,
  rows: Record<string, unknown>[]
): Promise<{ success: boolean; error?: string }> {
  if (rows.length === 0) return { success: true };
  const keys = Object.keys(rows[0]);
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
  try {
    const stmts = rows.map((row) =>
      db.prepare(sql).bind(...keys.map((k) => row[k]))
    );
    const result = await db.batch(stmts);
    return { success: result.length > 0 };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Run a SELECT query with optional WHERE clauses. Returns parsed rows. */
export async function d1Query<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  try {
    const result = await db.prepare(sql).bind(...bindings).all();
    return result.results as T[];
  } catch (e) {
    console.error("D1 query error:", e);
    return [];
  }
}

/** Run a single SELECT and return first row or null. */
export async function d1QueryOne<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  try {
    const result = await db.prepare(sql).bind(...bindings).first<T>();
    return result;
  } catch (e) {
    console.error("D1 queryOne error:", e);
    return null;
  }
}

/** Run a write statement (UPDATE, DELETE, etc.). */
export async function d1Run(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await db.prepare(sql).bind(...bindings).run();
    return { success: result.success };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

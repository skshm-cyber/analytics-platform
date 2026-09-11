import { Env, EventPayload } from "../types";
import { d1Insert, d1QueryOne, d1Query } from "../services/d1";
import { jsonResponse, errorResponse } from "../middleware/cors";

/**
 * Resolve site_id from site_key (cached per request via closure).
 */
async function resolveSiteId(db: D1Database, siteKey: string): Promise<string | null> {
  const site = await d1QueryOne<{ id: string }>(
    db,
    "SELECT id FROM sites WHERE site_key = ? AND is_active = 1",
    siteKey
  );
  return site ? site.id : null;
}

/**
 * POST /api/event — Receive interaction event from tracker.js
 */
export async function handleEvent(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: EventPayload;

  try {
    body = await request.json();
  } catch {
    return errorResponse(env, "Invalid JSON", 400, origin);
  }

  if (!body.site_key || !body.visitor_id || !body.session_id || !body.event_type) {
    return errorResponse(env, "Missing required fields", 400, origin);
  }

  const site_id = await resolveSiteId(env.DB, body.site_key);
  if (!site_id) {
    return errorResponse(env, "Invalid site key", 403, origin);
  }

  const now = new Date().toISOString();

  // If this is a page_leave event with time/scroll data, update the last page_view
  if (body.event_type === "page_leave" && (body.time_on_page || body.scroll_percentage)) {
    const pvRows = await d1Query<{ id: string }>(
      env.DB,
      "SELECT id FROM page_views WHERE site_id = ? AND visitor_id = ? AND session_id = ? ORDER BY timestamp DESC LIMIT 1",
      site_id, body.visitor_id, body.session_id
    );

    if (pvRows.length > 0) {
      await env.DB.prepare(
        "UPDATE page_views SET time_on_page = ?, scroll_percentage = ? WHERE id = ?"
      ).bind(body.time_on_page || 0, body.scroll_percentage || 0, pvRows[0].id).run();
    }

    // Accumulate session duration
    const sessRows = await d1Query<{ id: string; duration_seconds: number }>(
      env.DB,
      "SELECT id, duration_seconds FROM sessions WHERE site_id = ? AND session_id = ?",
      site_id, body.session_id
    );
    if (sessRows.length > 0 && body.time_on_page && body.time_on_page > 0) {
      const current = Number(sessRows[0].duration_seconds) || 0;
      await env.DB.prepare(
        "UPDATE sessions SET duration_seconds = ? WHERE id = ?"
      ).bind(Math.round((current + body.time_on_page) * 10) / 10, sessRows[0].id).run();
    }
  }

  // Insert the event
  const insertResult = await d1Insert(env.DB, "events", {
    id: crypto.randomUUID(),
    site_id,
    visitor_id: body.visitor_id,
    session_id: body.session_id,
    timestamp: body.timestamp || now,
    event_type: body.event_type,
    event_target: body.event_target || "",
    page_url: body.page_url || "",
    browser: body.browser || "",
    os: body.os || "",
    device_type: body.device_type || "",
    properties: JSON.stringify(body.properties || {}),
  });

  // Self-heal: if visitor row doesn't exist, create it and retry
  if (!insertResult.success && insertResult.error && insertResult.error.includes("FOREIGN KEY")) {
    await d1Insert(env.DB, "visitors", {
      id: crypto.randomUUID(),
      site_id,
      visitor_id: body.visitor_id,
      first_seen: body.timestamp || now,
      last_seen: now,
    });
    await d1Insert(env.DB, "events", {
      id: crypto.randomUUID(),
      site_id,
      visitor_id: body.visitor_id,
      session_id: body.session_id,
      timestamp: body.timestamp || now,
      event_type: body.event_type,
      event_target: body.event_target || "",
      page_url: body.page_url || "",
      browser: body.browser || "",
      os: body.os || "",
      device_type: body.device_type || "",
      properties: JSON.stringify(body.properties || {}),
    });
  }

  return jsonResponse(env, { status: "ok" }, 200, origin);
}

/**
 * POST /api/events/batch — Receive multiple events at once
 * Body: { site_key, events: EventPayload[] }
 */
export async function handleEventBatch(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: { site_key?: string; events?: EventPayload[] };

  try {
    body = await request.json();
  } catch {
    return errorResponse(env, "Invalid JSON", 400, origin);
  }

  if (!body.site_key || !body.events || !Array.isArray(body.events) || body.events.length === 0) {
    return errorResponse(env, "Missing site_key or events array", 400, origin);
  }

  const site_id = await resolveSiteId(env.DB, body.site_key);
  if (!site_id) {
    return errorResponse(env, "Invalid site key", 403, origin);
  }

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (const ev of body.events.slice(0, 50)) {
    if (!ev.visitor_id || !ev.session_id || !ev.event_type) continue;

    rows.push({
      id: crypto.randomUUID(),
      site_id,
      visitor_id: ev.visitor_id,
      session_id: ev.session_id,
      timestamp: ev.timestamp || now,
      event_type: ev.event_type,
      event_target: ev.event_target || "",
      page_url: ev.page_url || "",
      browser: ev.browser || "",
      os: ev.os || "",
      device_type: ev.device_type || "",
      properties: JSON.stringify(ev.properties || {}),
    });
  }

  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT INTO events (${keys.join(", ")}) VALUES (${placeholders})`;
    const stmts = rows.map((row) =>
      env.DB.prepare(sql).bind(...keys.map((k) => row[k]))
    );
    await env.DB.batch(stmts);
  }

  return jsonResponse(env, { status: "ok", count: rows.length }, 200, origin);
}

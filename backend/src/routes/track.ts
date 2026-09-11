import { Env, TrackPayload } from "../types";
import { d1Insert, d1QueryOne } from "../services/d1";
import { jsonResponse, errorResponse } from "../middleware/cors";

/**
 * POST /api/track — Receive page view from tracker.js
 *
 * 1. Validate payload + site_key
 * 2. Look up site_id from site_key
 * 3. Upsert visitor
 * 4. Upsert session
 * 5. Insert page_view
 * 6. Insert device + location
 */
export async function handleTrack(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: TrackPayload;

  try {
    body = await request.json();
  } catch {
    return errorResponse(env, "Invalid JSON", 400, origin);
  }

  if (!body.site_key || !body.visitor_id || !body.session_id || !body.page_url) {
    return errorResponse(env, "Missing required fields: site_key, visitor_id, session_id, page_url", 400, origin);
  }

  // Look up site_id from site_key
  const site = await d1QueryOne<{ id: string }>(
    env.DB,
    "SELECT id FROM sites WHERE site_key = ? AND is_active = 1",
    body.site_key
  );
  if (!site) {
    return errorResponse(env, "Invalid site key", 403, origin);
  }
  const site_id = site.id;

  const now = new Date().toISOString();

  // 1. Upsert visitor
  const existingVisitor = await d1QueryOne<{ id: string }>(
    env.DB,
    "SELECT id FROM visitors WHERE site_id = ? AND visitor_id = ?",
    site_id, body.visitor_id
  );

  if (!existingVisitor) {
    await d1Insert(env.DB, "visitors", {
      id: crypto.randomUUID(),
      site_id,
      visitor_id: body.visitor_id,
      first_seen: body.timestamp || now,
      last_seen: now,
    });
  } else {
    await env.DB.prepare(
      "UPDATE visitors SET last_seen = ? WHERE site_id = ? AND visitor_id = ?"
    ).bind(now, site_id, body.visitor_id).run();
  }

  // 2. Upsert session
  const existingSession = await d1QueryOne<{ id: string; page_count: number }>(
    env.DB,
    "SELECT id, page_count FROM sessions WHERE site_id = ? AND session_id = ?",
    site_id, body.session_id
  );

  if (!existingSession) {
    await d1Insert(env.DB, "sessions", {
      id: crypto.randomUUID(),
      site_id,
      session_id: body.session_id,
      visitor_id: body.visitor_id,
      started_at: body.timestamp || now,
      entry_page: body.page_url,
      exit_page: body.page_url,
      page_count: 1,
      is_bounce: 1,
      referrer: body.referrer || "",
      utm_source: body.utm_source || "",
      utm_campaign: body.utm_campaign || "",
    });
  } else {
    const pageCount = existingSession.page_count || 0;
    await env.DB.prepare(
      "UPDATE sessions SET exit_page = ?, page_count = ?, is_bounce = ? WHERE site_id = ? AND session_id = ?"
    ).bind(
      body.page_url,
      pageCount + 1,
      pageCount + 1 <= 1 ? 1 : 0,
      site_id,
      body.session_id
    ).run();
  }

  // 3. Insert page view
  const pvId = crypto.randomUUID();
  const pvResult = await d1Insert(env.DB, "page_views", {
    id: pvId,
    site_id,
    visitor_id: body.visitor_id,
    session_id: body.session_id,
    timestamp: body.timestamp || now,
    page_url: body.page_url,
    page_title: body.page_title || "",
    referrer: body.referrer || "",
    is_first_visit: body.is_first_visit === 1 ? 1 : 0,
    scroll_percentage: body.scroll_percentage || 0,
    time_on_page: body.time_on_page || 0,
    utm_source: body.utm_source || "",
    utm_medium: body.utm_medium || "",
    utm_campaign: body.utm_campaign || "",
    utm_content: body.utm_content || "",
  });

  if (pvResult.success) {
    // 4. Insert device
    await d1Insert(env.DB, "devices", {
      id: crypto.randomUUID(),
      page_view_id: pvId,
      browser: body.browser || "",
      browser_version: body.browser_version || "",
      os: body.os || "",
      device_type: body.device_type || "",
      screen_width: body.screen_width || 0,
      screen_height: body.screen_height || 0,
      language: body.language || "",
      timezone: body.timezone || "",
    });

    // 5. Insert location from CF-IPCountry header
    const country = request.headers.get("CF-IPCountry");
    if (country && country !== "XX" && country !== "T1") {
      await d1Insert(env.DB, "locations", {
        id: crypto.randomUUID(),
        page_view_id: pvId,
        country,
        city: "",
        latitude: null,
        longitude: null,
      });
    }
  }

  return jsonResponse(env, { status: "ok" }, 200, origin);
}

import { Env } from "../types";
import { d1Query, d1QueryOne } from "../services/d1";
import { jsonResponse, errorResponse } from "../middleware/cors";
import { getWindow, istDateStr, istHour } from "../utils/time";

// ── helpers ──────────────────────────────────────────────────────────────────

function conversionVisitors(events: Record<string, unknown>[]): Set<string> {
  const converted = new Set<string>();
  for (const e of events) {
    const vid = e.visitor_id as string;
    const type = e.event_type as string;
    const props = (typeof e.properties === "string" ? JSON.parse(e.properties || "{}") : e.properties) as Record<string, unknown>;
    const target = (e.event_target as string) || "";

    if (type === "cta_click") converted.add(vid);
    else if (type === "form_submit") converted.add(vid);
    else if (type === "link_click" && target) converted.add(vid);
  }
  return converted;
}

function parseProps(e: Record<string, unknown>): Record<string, unknown> {
  if (typeof e.properties === "string") {
    try { return JSON.parse(e.properties); } catch { return {}; }
  }
  return (e.properties as Record<string, unknown>) || {};
}

// ── Helper: require site_id from query param ─────────────────────────────────

function getSiteId(url: URL): string | null {
  return url.searchParams.get("site_id");
}

// ── GET /api/stats/overview ──────────────────────────────────────────────────

export async function handleOverview(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url, 1);

  const [visitors, pageViews, sessions] = await Promise.all([
    d1Query(env.DB, "SELECT visitor_id FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end),
    d1Query(env.DB, "SELECT id FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end),
    d1Query(env.DB, "SELECT session_id FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at <= ?", site_id, start, end),
  ]);

  const uniqueVisitors = new Set(visitors.map((r) => r.visitor_id)).size;

  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const liveRows = await d1Query(env.DB, "SELECT visitor_id FROM page_views WHERE site_id = ? AND timestamp >= ?", site_id, fiveMinAgo);
  const liveCount = new Set(liveRows.map((r) => r.visitor_id)).size;

  return jsonResponse(env, {
    visitors_today: uniqueVisitors,
    live_visitors: liveCount,
    page_views_today: pageViews.length,
    sessions_today: sessions.length,
  }, 200, origin);
}

// ── GET /api/stats/secondary ─────────────────────────────────────────────────

export async function handleSecondary(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url, 1);

  const [visitors, sessions, events] = await Promise.all([
    d1Query(env.DB, "SELECT visitor_id, is_first_visit FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end),
    d1Query(env.DB, "SELECT session_id, is_bounce, duration_seconds FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at <= ?", site_id, start, end),
    d1Query(env.DB, "SELECT visitor_id, event_type, event_target, properties FROM events WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end),
  ]);

  const uniqueVisitors = new Set(visitors.map((r) => r.visitor_id)).size;
  const newVisitors = new Set(
    visitors.filter((r) => r.is_first_visit === 1).map((r) => r.visitor_id)
  ).size;
  const returningVisitors = uniqueVisitors - newVisitors;

  const totalSessions = sessions.length;
  const bounced = sessions.filter((r) => r.is_bounce === 1).length;
  const bounceRate = totalSessions > 0 ? (bounced / totalSessions) * 100 : 0;

  const totalDuration = sessions.reduce((sum, r) => sum + ((r.duration_seconds as number) || 0), 0);
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

  const booked = conversionVisitors(events).size;
  const conversionRate = uniqueVisitors > 0 ? (booked / uniqueVisitors) * 100 : 0;

  return jsonResponse(env, {
    unique_visitors_today: uniqueVisitors,
    avg_session_duration: Math.round(avgDuration * 10) / 10,
    bounce_rate: Math.round(bounceRate * 10) / 10,
    conversion_rate: Math.round(conversionRate * 10) / 10,
    returning_visitors_today: returningVisitors,
    new_visitors_today: newVisitors,
  }, 200, origin);
}

// ── GET /api/stats/hourly ────────────────────────────────────────────────────

export async function handleHourly(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const rows = await d1Query(env.DB, "SELECT timestamp FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end);

  const hourMap = new Map<number, number>();
  for (let h = 0; h < 24; h++) hourMap.set(h, 0);
  for (const row of rows) {
    const hour = istHour(row.timestamp as string);
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
  }

  return jsonResponse(env, {
    hourly: Array.from(hourMap.entries()).map(([hour, visits]) => ({ hour, visits })),
  }, 200, origin);
}

// ── GET /api/stats/pages ─────────────────────────────────────────────────────

export async function handlePages(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  const rows = await d1Query(env.DB,
    "SELECT page_url, visitor_id, time_on_page, scroll_percentage FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?",
    site_id, start, end
  );

  const pageMap = new Map<string, { visits: number; visitors: Set<string>; totalTime: number; totalScroll: number }>();
  for (const row of rows) {
    const pUrl = row.page_url as string;
    if (!pageMap.has(pUrl)) pageMap.set(pUrl, { visits: 0, visitors: new Set(), totalTime: 0, totalScroll: 0 });
    const entry = pageMap.get(pUrl)!;
    entry.visits++;
    entry.visitors.add(row.visitor_id as string);
    entry.totalTime += (row.time_on_page as number) || 0;
    entry.totalScroll += (row.scroll_percentage as number) || 0;
  }

  const pages = Array.from(pageMap.entries())
    .map(([page_url, data]) => ({
      page_url,
      visits: data.visits,
      unique_visitors: data.visitors.size,
      avg_time_on_page: Math.round((data.totalTime / data.visits) * 10) / 10,
      avg_scroll: Math.round(data.totalScroll / data.visits),
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit);

  return jsonResponse(env, { pages }, 200, origin);
}

// ── GET /api/stats/referrers ─────────────────────────────────────────────────

export async function handleReferrers(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);

  const rows = await d1Query(env.DB,
    "SELECT referrer FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ? AND referrer != ''",
    site_id, start, end
  );

  const refMap = new Map<string, number>();
  for (const row of rows) {
    const ref = (row.referrer as string) || "";
    if (ref) refMap.set(ref, (refMap.get(ref) || 0) + 1);
  }

  const referrers = Array.from(refMap.entries())
    .map(([referrer, visits]) => ({ referrer, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit);

  return jsonResponse(env, { referrers }, 200, origin);
}

// ── GET /api/stats/browsers ──────────────────────────────────────────────────

export async function handleBrowsers(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const browsers = await d1Query<{ browser: string; count: number }>(
    env.DB,
    `SELECT d.browser, COUNT(*) as count
     FROM devices d
     JOIN page_views pv ON d.page_view_id = pv.id
     WHERE pv.site_id = ? AND pv.timestamp >= ? AND pv.timestamp <= ? AND d.browser != ''
     GROUP BY d.browser ORDER BY count DESC`,
    site_id, start, end
  );

  const total = browsers.reduce((s, b) => s + b.count, 0) || 1;
  const result = browsers.map((b) => ({
    browser: b.browser,
    count: b.count,
    percentage: Math.round((b.count / total) * 1000) / 10,
  }));

  return jsonResponse(env, { browsers: result }, 200, origin);
}

// ── GET /api/stats/devices ───────────────────────────────────────────────────

export async function handleDevices(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const devices = await d1Query<{ device_type: string; count: number }>(
    env.DB,
    `SELECT d.device_type, COUNT(*) as count
     FROM devices d
     JOIN page_views pv ON d.page_view_id = pv.id
     WHERE pv.site_id = ? AND pv.timestamp >= ? AND pv.timestamp <= ? AND d.device_type != ''
     GROUP BY d.device_type ORDER BY count DESC`,
    site_id, start, end
  );

  const total = devices.reduce((s, d) => s + d.count, 0) || 1;
  const result = devices.map((d) => ({
    device_type: d.device_type,
    count: d.count,
    percentage: Math.round((d.count / total) * 1000) / 10,
  }));

  return jsonResponse(env, { devices: result }, 200, origin);
}

// ── GET /api/stats/os ────────────────────────────────────────────────────────

export async function handleOS(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const osList = await d1Query<{ os: string; count: number }>(
    env.DB,
    `SELECT d.os, COUNT(*) as count
     FROM devices d
     JOIN page_views pv ON d.page_view_id = pv.id
     WHERE pv.site_id = ? AND pv.timestamp >= ? AND pv.timestamp <= ? AND d.os != ''
     GROUP BY d.os ORDER BY count DESC`,
    site_id, start, end
  );

  const total = osList.reduce((s, o) => s + o.count, 0) || 1;
  const result = osList.map((o) => ({
    os: o.os,
    count: o.count,
    percentage: Math.round((o.count / total) * 1000) / 10,
  }));

  return jsonResponse(env, { os: result }, 200, origin);
}

// ── GET /api/stats/live ──────────────────────────────────────────────────────

export async function handleLive(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const pvs = await d1Query(env.DB,
    "SELECT visitor_id, page_url, timestamp FROM page_views WHERE site_id = ? AND timestamp >= ? ORDER BY timestamp DESC",
    site_id, fiveMinAgo
  );

  const seen = new Set<string>();
  const visitors: Record<string, unknown>[] = [];
  for (const pv of pvs) {
    const vid = pv.visitor_id as string;
    if (!seen.has(vid)) {
      seen.add(vid);
      visitors.push({ visitor_id: vid, last_page: pv.page_url, last_seen: pv.timestamp });
    }
  }

  return jsonResponse(env, { visitors }, 200, origin);
}

// ── GET /api/stats/trends ────────────────────────────────────────────────────

export async function handleTrends(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url, 30);

  const [rows, sessionRows] = await Promise.all([
    d1Query(env.DB, "SELECT timestamp, visitor_id FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end),
    d1Query(env.DB, "SELECT started_at FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at <= ?", site_id, start, end),
  ]);

  const dayMap = new Map<string, { visitors: Set<string>; views: number; sessions: number }>();
  for (const row of rows) {
    const dateStr = istDateStr(row.timestamp as string);
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { visitors: new Set(), views: 0, sessions: 0 });
    const entry = dayMap.get(dateStr)!;
    entry.visitors.add(row.visitor_id as string);
    entry.views++;
  }
  for (const s of sessionRows) {
    const dateStr = istDateStr(s.started_at as string);
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { visitors: new Set(), views: 0, sessions: 0 });
    dayMap.get(dateStr)!.sessions++;
  }

  const trends = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      visitors: data.visitors.size,
      page_views: data.views,
      sessions: data.sessions,
    }));

  return jsonResponse(env, { trends }, 200, origin);
}

// ── GET /api/stats/events ────────────────────────────────────────────────────

export async function handleEvents(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);

  const [events, pvs] = await Promise.all([
    d1Query(env.DB,
      "SELECT id, visitor_id, timestamp, event_type, event_target, page_url, browser, os, device_type, properties FROM events WHERE site_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?",
      site_id, start, end, limit
    ),
    d1Query(env.DB,
      "SELECT id, timestamp, page_url, visitor_id FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?",
      site_id, start, end, limit
    ),
  ]);

  // Parse event properties
  const parsedEvents = events.map((e) => ({
    ...e,
    properties: parseProps(e),
  }));

  return jsonResponse(env, { events: [...parsedEvents, ...pvs] }, 200, origin);
}

// ── GET /api/stats/events/summary ────────────────────────────────────────────

export async function handleEventsSummary(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const events = await d1Query(env.DB,
    "SELECT event_type FROM events WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?",
    site_id, start, end
  );

  const typeMap = new Map<string, number>();
  for (const e of events) {
    const t = (e.event_type as string) || "unknown";
    typeMap.set(t, (typeMap.get(t) || 0) + 1);
  }

  const result = Array.from(typeMap.entries())
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count);

  return jsonResponse(env, { events: result }, 200, origin);
}

// ── GET /api/stats/daily ─────────────────────────────────────────────────────

export async function handleDaily(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url, 30);

  const [pageViews, sessions] = await Promise.all([
    d1Query(env.DB, "SELECT timestamp, visitor_id FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?", site_id, start, end),
    d1Query(env.DB, "SELECT started_at, is_bounce, duration_seconds FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at <= ?", site_id, start, end),
  ]);

  const pvByDate = new Map<string, { visitors: Set<string>; views: number }>();
  for (const pv of pageViews) {
    const d = istDateStr(pv.timestamp as string);
    if (!pvByDate.has(d)) pvByDate.set(d, { visitors: new Set(), views: 0 });
    const entry = pvByDate.get(d)!;
    entry.visitors.add(pv.visitor_id as string);
    entry.views++;
  }

  const sessByDate = new Map<string, { total: number; bounced: number; duration: number }>();
  for (const s of sessions) {
    const d = istDateStr(s.started_at as string);
    if (!sessByDate.has(d)) sessByDate.set(d, { total: 0, bounced: 0, duration: 0 });
    const entry = sessByDate.get(d)!;
    entry.total++;
    if (s.is_bounce) entry.bounced++;
    entry.duration += (s.duration_seconds as number) || 0;
  }

  const allDates = new Set([...pvByDate.keys(), ...sessByDate.keys()]);
  const daily = Array.from(allDates).sort().map((date) => {
    const pv = pvByDate.get(date);
    const sess = sessByDate.get(date);
    return {
      date,
      visitors: pv ? pv.visitors.size : 0,
      page_views: pv ? pv.views : 0,
      sessions: sess ? sess.total : 0,
      bounce_rate: sess && sess.total > 0 ? Math.round((sess.bounced / sess.total) * 1000) / 10 : 0,
      avg_duration: sess && sess.total > 0 ? Math.round((sess.duration / sess.total) * 10) / 10 : 0,
    };
  });

  return jsonResponse(env, { daily }, 200, origin);
}

// ── GET /api/stats/countries ─────────────────────────────────────────────────

export async function handleCountries(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  const countries = await d1Query<{ country: string; count: number }>(
    env.DB,
    `SELECT l.country, COUNT(*) as count
     FROM locations l
     JOIN page_views pv ON l.page_view_id = pv.id
     WHERE pv.site_id = ? AND pv.timestamp >= ? AND pv.timestamp <= ? AND l.country != ''
     GROUP BY l.country ORDER BY count DESC LIMIT ?`,
    site_id, start, end, limit
  );

  return jsonResponse(env, { countries }, 200, origin);
}

// ── GET /api/stats/cities ────────────────────────────────────────────────────

export async function handleCities(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  const cities = await d1Query<{ city: string; country: string; count: number }>(
    env.DB,
    `SELECT l.city, l.country, COUNT(*) as count
     FROM locations l
     JOIN page_views pv ON l.page_view_id = pv.id
     WHERE pv.site_id = ? AND pv.timestamp >= ? AND pv.timestamp <= ? AND l.city != ''
     GROUP BY l.city ORDER BY count DESC LIMIT ?`,
    site_id, start, end, limit
  );

  return jsonResponse(env, { cities }, 200, origin);
}

// ── GET /api/stats/verify ────────────────────────────────────────────────────
// Verify tracker is receiving data for a site.

export async function handleVerify(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400_000).toISOString();
  const allTime = "2000-01-01T00:00:00Z";

  const [recentPV, dayPV, totalPV, recentEvents, site] = await Promise.all([
    d1Query(env.DB, "SELECT id FROM page_views WHERE site_id = ? AND timestamp >= ? LIMIT 1", site_id, oneHourAgo),
    d1Query(env.DB, "SELECT id FROM page_views WHERE site_id = ? AND timestamp >= ? LIMIT 1", site_id, oneDayAgo),
    d1Query(env.DB, "SELECT COUNT(*) as cnt FROM page_views WHERE site_id = ?", site_id),
    d1Query(env.DB, "SELECT id FROM events WHERE site_id = ? AND timestamp >= ? LIMIT 1", site_id, oneHourAgo),
    d1QueryOne<{ site_key: string; url: string; name: string }>(env.DB, "SELECT site_key, url, name FROM sites WHERE id = ?", site_id),
  ]);

  const hasRecent = recentPV.length > 0;
  const hasToday = dayPV.length > 0;
  const totalCount = (totalPV[0] as any)?.cnt || 0;
  const hasRecentEvent = recentEvents.length > 0;

  let status: string;
  let detail: string;
  if (hasRecent) {
    status = "active";
    detail = "Tracker is working! Data received in the last hour.";
  } else if (hasToday) {
    status = "idle";
    detail = "Tracker received data today but nothing in the last hour.";
  } else if (totalCount > 0) {
    status = "stale";
    detail = "Tracker has historical data but nothing recently. Check if the script is still installed.";
  } else {
    status = "no_data";
    detail = "No data received yet. Make sure the tracking script is installed on your website.";
  }

  return jsonResponse(env, {
    status,
    detail,
    total_page_views: totalCount,
    has_recent_event: hasRecentEvent,
    site: site ? { name: site.name, url: site.url, site_key: site.site_key } : null,
  }, 200, origin);
}

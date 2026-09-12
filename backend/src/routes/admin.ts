import { Env } from "../types";
import { d1Query, d1QueryOne } from "../services/d1";
import { jsonResponse, errorResponse } from "../middleware/cors";
import { getUser } from "../middleware/auth";

/**
 * GET /api/admin/stats — Platform-wide stats (admin only)
 */
export async function handleAdminStats(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const user = await getUser(env, request);
  if (!user || !user.is_admin) {
    return errorResponse(env, "Unauthorized", 401, origin);
  }

  const [
    totalUsers,
    totalSites,
    totalPageViews,
    totalEvents,
    totalSessions,
    activeSites,
    recentUsers,
    recentSites,
  ] = await Promise.all([
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM users"),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM sites"),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM page_views"),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM events"),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM sessions"),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM sites WHERE is_active = 1"),
    d1Query(env.DB, "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 10"),
    d1Query(env.DB, "SELECT id, name, url, site_key, created_at FROM sites ORDER BY created_at DESC LIMIT 10"),
  ]);

  return jsonResponse(env, {
    users: { total: totalUsers?.cnt || 0 },
    sites: { total: totalSites?.cnt || 0, active: activeSites?.cnt || 0 },
    page_views: { total: totalPageViews?.cnt || 0 },
    events: { total: totalEvents?.cnt || 0 },
    sessions: { total: totalSessions?.cnt || 0 },
    recent_users: recentUsers,
    recent_sites: recentSites,
  }, 200, origin);
}

/**
 * GET /api/admin/users — List all users (admin only)
 */
export async function handleAdminUsers(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const user = await getUser(env, request);
  if (!user || !user.is_admin) {
    return errorResponse(env, "Unauthorized", 401, origin);
  }

  const users = await d1Query(
    env.DB,
    "SELECT id, email, name, is_admin, created_at FROM users ORDER BY created_at DESC"
  );

  return jsonResponse(env, { users }, 200, origin);
}

/**
 * GET /api/admin/sites — List all sites with user info (admin only)
 */
export async function handleAdminSites(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const user = await getUser(env, request);
  if (!user || !user.is_admin) {
    return errorResponse(env, "Unauthorized", 401, origin);
  }

  const sites = await d1Query(
    env.DB,
    `SELECT s.id, s.name, s.url, s.site_key, s.is_active, s.created_at,
            u.email as owner_email, u.name as owner_name
     FROM sites s
     LEFT JOIN users u ON s.user_id = u.id
     ORDER BY s.created_at DESC`
  );

  return jsonResponse(env, { sites }, 200, origin);
}

/**
 * GET /api/admin/activity — Platform-wide recent activity (admin only)
 */
export async function handleAdminActivity(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const user = await getUser(env, request);
  if (!user || !user.is_admin) {
    return errorResponse(env, "Unauthorized", 401, origin);
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);

  const [events, pageViews] = await Promise.all([
    d1Query(
      env.DB,
      `SELECT e.event_type, e.event_target, e.page_url, e.timestamp, e.visitor_id,
              s.name as site_name, s.site_key
       FROM events e
       LEFT JOIN sites s ON e.site_id = s.id
       ORDER BY e.timestamp DESC LIMIT ?`,
      limit
    ),
    d1Query(
      env.DB,
      `SELECT pv.page_url, pv.page_title, pv.timestamp, pv.visitor_id,
              s.name as site_name, s.site_key
       FROM page_views pv
       LEFT JOIN sites s ON pv.site_id = s.id
       ORDER BY pv.timestamp DESC LIMIT ?`,
      limit
    ),
  ]);

  return jsonResponse(env, { events, page_views: pageViews }, 200, origin);
}

/**
 * GET /api/admin/site/:id/stats — Per-site stats (admin only)
 */
export async function handleAdminSiteStats(
  request: Request,
  env: Env,
  siteId: string
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const user = await getUser(env, request);
  if (!user || !user.is_admin) {
    return errorResponse(env, "Unauthorized", 401, origin);
  }

  const site = await d1QueryOne<{ id: string; name: string; url: string; site_key: string }>(
    env.DB,
    "SELECT id, name, url, site_key FROM sites WHERE id = ?",
    siteId
  );
  if (!site) return errorResponse(env, "Site not found", 404, origin);

  const [pvCount, evCount, sessCount, visitorCount] = await Promise.all([
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM page_views WHERE site_id = ?", siteId),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM events WHERE site_id = ?", siteId),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(*) as cnt FROM sessions WHERE site_id = ?", siteId),
    d1QueryOne<{ cnt: number }>(env.DB, "SELECT COUNT(DISTINCT visitor_id) as cnt FROM page_views WHERE site_id = ?", siteId),
  ]);

  return jsonResponse(env, {
    site,
    page_views: pvCount?.cnt || 0,
    events: evCount?.cnt || 0,
    sessions: sessCount?.cnt || 0,
    visitors: visitorCount?.cnt || 0,
  }, 200, origin);
}

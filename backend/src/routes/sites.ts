import { Env, Site } from "../types";
import { d1Insert, d1Query, d1QueryOne } from "../services/d1";
import { requireAuth } from "../middleware/auth";
import { jsonResponse, errorResponse } from "../middleware/cors";

function generateSiteKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * POST /api/sites
 * Body: { name, url }
 */
export async function handleCreateSite(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let user;
  try {
    user = await requireAuth(env, request);
  } catch (e) {
    return e as Response;
  }

  let body: { name?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(env, "Invalid JSON", 400, origin);
  }

  const name = body.name?.trim();
  const url = body.url?.trim();

  if (!name || !url) {
    return errorResponse(env, "Name and URL are required", 400, origin);
  }

  const id = crypto.randomUUID();
  const site_key = generateSiteKey();

  const result = await d1Insert(env.DB, "sites", {
    id,
    user_id: user.id,
    name,
    url,
    site_key,
    is_active: 1,
  });

  if (!result.success) {
    return errorResponse(env, "Failed to create site", 500, origin);
  }

  return jsonResponse(env, { id, name, url, site_key }, 201, origin);
}

/**
 * GET /api/sites
 * List all sites for the authenticated user.
 */
export async function handleListSites(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let user;
  try {
    user = await requireAuth(env, request);
  } catch (e) {
    return e as Response;
  }

  const sites = await d1Query<Site>(
    env.DB,
    "SELECT id, user_id, name, url, site_key, is_active, created_at FROM sites WHERE user_id = ? ORDER BY created_at DESC",
    user.id
  );

  return jsonResponse(env, { sites }, 200, origin);
}

/**
 * GET /api/sites/:id
 */
export async function handleGetSite(
  request: Request,
  env: Env,
  siteId: string
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let user;
  try {
    user = await requireAuth(env, request);
  } catch (e) {
    return e as Response;
  }

  const site = await d1QueryOne<Site>(
    env.DB,
    "SELECT id, user_id, name, url, site_key, is_active, created_at FROM sites WHERE id = ? AND user_id = ?",
    siteId,
    user.id
  );

  if (!site) {
    return errorResponse(env, "Site not found", 404, origin);
  }

  return jsonResponse(env, site, 200, origin);
}

/**
 * GET /api/sites/:id/script
 * Returns the tracking script snippet for a site.
 */
export async function handleGetScript(
  request: Request,
  env: Env,
  siteId: string
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let user;
  try {
    user = await requireAuth(env, request);
  } catch (e) {
    return e as Response;
  }

  const site = await d1QueryOne<Site>(
    env.DB,
    "SELECT id, site_key FROM sites WHERE id = ? AND user_id = ?",
    siteId,
    user.id
  );

  if (!site) {
    return errorResponse(env, "Site not found", 404, origin);
  }

  const workerUrl = `https://${new URL(request.url).hostname}`;
  const script = `<script src="${workerUrl}/tracker.js" data-site-key="${site.site_key}" data-api-url="${workerUrl}"></script>`;

  return jsonResponse(env, { script, site_key: site.site_key, worker_url: workerUrl }, 200, origin);
}

import { Env } from "../types";
import { d1Query } from "../services/d1";
import { jsonResponse, errorResponse } from "../middleware/cors";
import { getWindow } from "../utils/time";

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function getSiteId(url: URL): string | null {
  return url.searchParams.get("site_id");
}

function parseProps(e: Record<string, unknown>): Record<string, unknown> {
  if (typeof e.properties === "string") {
    try { return JSON.parse(e.properties); } catch { return {}; }
  }
  return (e.properties as Record<string, unknown>) || {};
}

function getIntParam(url: URL, key: string, def: number): number {
  const v = parseInt(url.searchParams.get(key) || String(def), 10);
  return isNaN(v) || v < 1 ? def : v;
}

// ── GET /api/stats/products ──────────────────────────────────────────────────
// Generic product/service card performance. Works for any pricing table.
// Event type: product_click (auto-detected from pricing cards with a price).

interface ProductAcc {
  clicks: number;
  ctas: number;
  visitors: Set<string>;
  category: string;
  price: number | null;
  currency: string;
}

export async function handleProducts(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const events = await d1Query<Record<string, unknown>>(
    env.DB,
    "SELECT session_id, visitor_id, event_type, event_target, properties FROM events WHERE site_id = ? AND timestamp >= ? AND timestamp <= ? AND event_type IN ('product_click', 'cta_click') ORDER BY timestamp ASC",
    site_id, start, end
  );

  const productMap = new Map<string, ProductAcc>();
  const lastProductSession = new Map<string, string>();
  const ctaVisitors = new Set<string>();

  for (const e of events) {
    const props = parseProps(e);
    const type = e.event_type as string;
    const session = (e.session_id as string) || "";
    const visitor = (e.visitor_id as string) || "";

    if (type === "product_click") {
      const name = (props.name as string) || (e.event_target as string) || "Unknown";
      if (!productMap.has(name)) {
        productMap.set(name, {
          clicks: 0, ctas: 0, visitors: new Set(),
          category: (props.category as string) || "",
          price: typeof props.price === "number" ? props.price : null,
          currency: (props.currency as string) || "USD",
        });
      }
      const c = productMap.get(name)!;
      c.clicks++;
      if (session) lastProductSession.set(session, name);
      if (visitor) c.visitors.add(visitor);
    } else if (type === "cta_click") {
      const name = (props.name as string) || (e.event_target as string) || "";
      // Attribute CTA to last product clicked in this session
      let attributed = name && productMap.has(name) ? name : "";
      if (!attributed && session) attributed = lastProductSession.get(session) || "";
      if (attributed && productMap.has(attributed)) {
        productMap.get(attributed)!.ctas++;
      }
      if (visitor) ctaVisitors.add(visitor);
    }
  }

  const products = Array.from(productMap.entries())
    .map(([name, d]) => ({
      name,
      category: d.category,
      clicks: d.clicks,
      unique_visitors: d.visitors.size,
      ctas: d.ctas,
      cta_rate: pct(d.ctas, d.clicks),
      price: d.price,
      currency: d.currency,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 25);

  return jsonResponse(env, { products, meta: { cta_visitors: ctaVisitors.size } }, 200, origin);
}

// ── GET /api/stats/funnel ────────────────────────────────────────────────────
// Generic funnel: Visitors → Reached pricing → Clicked a product → Converted.
// Works for any website. No tarot-specific labels.

export async function handleFunnel(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const [pageViews, userEvents] = await Promise.all([
    d1Query<Record<string, unknown>>(
      env.DB,
      "SELECT visitor_id, session_id, page_url FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?",
      site_id, start, end
    ),
    d1Query<Record<string, unknown>>(
      env.DB,
      "SELECT visitor_id, session_id, event_type, event_target, properties FROM events WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?",
      site_id, start, end
    ),
  ]);

  const visitors = new Set<string>();
  const pricingVisitors = new Set<string>();
  const productVisitors = new Set<string>();
  const convertedVisitors = new Set<string>();

  for (const pv of pageViews) {
    const vid = pv.visitor_id as string;
    visitors.add(vid);
    // Generic: check if page URL contains pricing/shop/product/cart keywords
    const pageUrl = (pv.page_url as string).toLowerCase();
    if (/pric|shop|product|plan|cart|buy/.test(pageUrl)) {
      pricingVisitors.add(vid);
    }
  }

  for (const e of userEvents) {
    const vid = e.visitor_id as string;
    if (!vid) continue;
    const type = e.event_type as string;

    if (type === "product_click") {
      productVisitors.add(vid);
      pricingVisitors.add(vid);
    } else if (type === "cta_click" || type === "form_submit") {
      convertedVisitors.add(vid);
    }
  }

  const visitorsCount = visitors.size;
  const funnel = [
    { key: "visitors", label: "Visitors", count: visitorsCount, pct: 100 },
    { key: "pricing", label: "Reached pricing/shop", count: pricingVisitors.size, pct: pct(pricingVisitors.size, visitorsCount) },
    { key: "products", label: "Clicked a product/service", count: productVisitors.size, pct: pct(productVisitors.size, visitorsCount) },
    { key: "converted", label: "Converted / took action", count: convertedVisitors.size, pct: pct(convertedVisitors.size, visitorsCount) },
  ];

  return jsonResponse(env, { funnel }, 200, origin);
}

// ── GET /api/stats/campaigns ─────────────────────────────────────────────────
// UTM source breakdown.

export async function handleCampaigns(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);

  const rows = await d1Query<Record<string, unknown>>(
    env.DB,
    "SELECT utm_source, utm_medium, utm_campaign, visitor_id FROM page_views WHERE site_id = ? AND timestamp >= ? AND timestamp <= ?",
    site_id, start, end
  );

  const srcMap = new Map<string, { visits: number; visitors: Set<string>; mediums: Set<string> }>();
  for (const row of rows) {
    let src = (row.utm_source as string) || "";
    if (src) src = src.toLowerCase().trim();
    if (!src) src = "direct";
    if (!srcMap.has(src)) srcMap.set(src, { visits: 0, visitors: new Set(), mediums: new Set() });
    const entry = srcMap.get(src)!;
    entry.visits++;
    entry.visitors.add(row.visitor_id as string);
    if (row.utm_medium) entry.mediums.add(row.utm_medium as string);
  }

  const campaigns = Array.from(srcMap.entries())
    .map(([source, d]) => ({
      source,
      visits: d.visits,
      unique_visitors: d.visitors.size,
      medium: Array.from(d.mediums).join(", "),
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15);

  return jsonResponse(env, { campaigns }, 200, origin);
}

// ── GET /api/stats/journeys ──────────────────────────────────────────────────
// Per-session timeline.

export async function handleJourneys(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const site_id = getSiteId(url);
  if (!site_id) return errorResponse(env, "site_id required", 400, origin);

  const { start, end } = getWindow(url);
  const limit = Math.min(getIntParam(url, "limit", 8), 25);

  const recent = await d1Query<Record<string, unknown>>(
    env.DB,
    "SELECT session_id, visitor_id, started_at, entry_page, page_count, duration_seconds, utm_source FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at <= ? ORDER BY started_at DESC LIMIT ?",
    site_id, start, end, limit
  );

  if (recent.length === 0) {
    return jsonResponse(env, { journeys: [] }, 200, origin);
  }

  const sessionIds = recent.map((r) => r.session_id as string);
  const placeholders = sessionIds.map(() => "?").join(",");

  const [pageViews, userEvents] = await Promise.all([
    d1Query<Record<string, unknown>>(
      env.DB,
      `SELECT session_id, timestamp, page_url, page_title FROM page_views WHERE site_id = ? AND session_id IN (${placeholders}) ORDER BY timestamp ASC`,
      site_id, ...sessionIds
    ),
    d1Query<Record<string, unknown>>(
      env.DB,
      `SELECT session_id, timestamp, event_type, event_target, properties, page_url FROM events WHERE site_id = ? AND session_id IN (${placeholders}) ORDER BY timestamp ASC`,
      site_id, ...sessionIds
    ),
  ]);

  const journeys = recent.map((s) => {
    const session = s.session_id as string;
    const timeline: Record<string, unknown>[] = [];
    for (const pv of pageViews) {
      if (pv.session_id !== session) continue;
      timeline.push({ kind: "page", time: pv.timestamp, target: pv.page_url, label: pv.page_title });
    }
    for (const e of userEvents) {
      if (e.session_id !== session) continue;
      timeline.push({
        kind: "event",
        time: e.timestamp,
        event_type: e.event_type,
        target: e.event_target || "",
        properties: parseProps(e),
        page_url: e.page_url || "",
      });
    }
    timeline.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return {
      session_id: session,
      visitor_id: s.visitor_id,
      started_at: s.started_at,
      entry_page: s.entry_page,
      duration_seconds: s.duration_seconds,
      utm_source: s.utm_source || "",
      timeline,
    };
  });

  return jsonResponse(env, { journeys }, 200, origin);
}

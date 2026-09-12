import { Env } from "./types";
import { corsHeaders, jsonResponse, errorResponse } from "./middleware/cors";
import { checkRateLimit } from "./middleware/rateLimit";
import { handleTrack } from "./routes/track";
import { handleEvent, handleEventBatch } from "./routes/event";
import { handleSignup, handleLogin, handleLogout, handleMe, handleForgotPassword, handleResetPassword, handleGoogleAuth, handleGoogleCallback, handleGithubAuth, handleGithubCallback } from "./routes/auth";
import { handleCreateSite, handleListSites, handleGetSite, handleGetScript } from "./routes/sites";
import {
  handleOverview,
  handleSecondary,
  handleHourly,
  handlePages,
  handleReferrers,
  handleBrowsers,
  handleDevices,
  handleOS,
  handleLive,
  handleTrends,
  handleEvents,
  handleEventsSummary,
  handleDaily,
  handleCountries,
  handleCities,
  handleVerify,
} from "./routes/analytics";
import {
  handleProducts,
  handleFunnel,
  handleCampaigns,
  handleJourneys,
} from "./routes/analyticsBusiness";
import {
  handleAdminStats,
  handleAdminUsers,
  handleAdminSites,
  handleAdminActivity,
  handleAdminSiteStats,
} from "./routes/admin";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get("Origin");

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env, origin),
      });
    }

    // ── Rate limiting ───────────────────────────────────────────────────────
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { allowed } = checkRateLimit(ip);
    if (!allowed) {
      return errorResponse(env, "Rate limit exceeded. Try again later.", 429, origin);
    }

    // ── Router ──────────────────────────────────────────────────────────────
    try {
      // ── Auth ──────────────────────────────────────────────────────────────
      if (path === "/api/auth/signup" && method === "POST") {
        return await handleSignup(request, env);
      }
      if (path === "/api/auth/login" && method === "POST") {
        return await handleLogin(request, env);
      }
      if (path === "/api/auth/logout" && method === "POST") {
        return await handleLogout(request, env);
      }
      if (path === "/api/auth/me" && method === "GET") {
        return await handleMe(request, env);
      }
      if (path === "/api/auth/forgot-password" && method === "POST") {
        return await handleForgotPassword(request, env);
      }
      if (path === "/api/auth/reset-password" && method === "POST") {
        return await handleResetPassword(request, env);
      }
      if (path === "/api/auth/google" && method === "GET") {
        return await handleGoogleAuth(request, env);
      }
      if (path === "/api/auth/google/callback" && method === "GET") {
        return await handleGoogleCallback(request, env);
      }
      if (path === "/api/auth/github" && method === "GET") {
        return await handleGithubAuth(request, env);
      }
      if (path === "/api/auth/github/callback" && method === "GET") {
        return await handleGithubCallback(request, env);
      }

      // ── Sites ─────────────────────────────────────────────────────────────
      if (path === "/api/sites" && method === "POST") {
        return await handleCreateSite(request, env);
      }
      if (path === "/api/sites" && method === "GET") {
        return await handleListSites(request, env);
      }
      const siteMatch = path.match(/^\/api\/sites\/([^/]+)$/);
      if (siteMatch && method === "GET") {
        return await handleGetSite(request, env, siteMatch[1]);
      }
      const scriptMatch = path.match(/^\/api\/sites\/([^/]+)\/script$/);
      if (scriptMatch && method === "GET") {
        return await handleGetScript(request, env, scriptMatch[1]);
      }

      // ── Admin (admin-only, JWT authenticated) ────────────────────────────
      if (path === "/api/admin/stats" && method === "GET") {
        return await handleAdminStats(request, env);
      }
      if (path === "/api/admin/users" && method === "GET") {
        return await handleAdminUsers(request, env);
      }
      if (path === "/api/admin/sites" && method === "GET") {
        return await handleAdminSites(request, env);
      }
      if (path === "/api/admin/activity" && method === "GET") {
        return await handleAdminActivity(request, env);
      }
      const adminSiteMatch = path.match(/^\/api\/admin\/site\/([^/]+)\/stats$/);
      if (adminSiteMatch && method === "GET") {
        return await handleAdminSiteStats(request, env, adminSiteMatch[1]);
      }

      // ── Ingestion (public, site_key authenticated) ────────────────────────
      if (path === "/api/track" && method === "POST") {
        return await handleTrack(request, env);
      }
      if (path === "/api/event" && method === "POST") {
        return await handleEvent(request, env);
      }
      if (path === "/api/events/batch" && method === "POST") {
        return await handleEventBatch(request, env);
      }

      // ── Analytics (require site_id) ───────────────────────────────────────
      if (path === "/api/stats/overview" && method === "GET") {
        return await handleOverview(request, env);
      }
      if (path === "/api/stats/secondary" && method === "GET") {
        return await handleSecondary(request, env);
      }
      if (path === "/api/stats/hourly" && method === "GET") {
        return await handleHourly(request, env);
      }
      if (path === "/api/stats/pages" && method === "GET") {
        return await handlePages(request, env);
      }
      if (path === "/api/stats/referrers" && method === "GET") {
        return await handleReferrers(request, env);
      }
      if (path === "/api/stats/browsers" && method === "GET") {
        return await handleBrowsers(request, env);
      }
      if (path === "/api/stats/devices" && method === "GET") {
        return await handleDevices(request, env);
      }
      if (path === "/api/stats/os" && method === "GET") {
        return await handleOS(request, env);
      }
      if (path === "/api/stats/live" && method === "GET") {
        return await handleLive(request, env);
      }
      if (path === "/api/stats/trends" && method === "GET") {
        return await handleTrends(request, env);
      }
      if (path === "/api/stats/events" && method === "GET") {
        if (url.searchParams.has("summary")) {
          return await handleEventsSummary(request, env);
        }
        return await handleEvents(request, env);
      }
      if (path === "/api/stats/events/summary" && method === "GET") {
        return await handleEventsSummary(request, env);
      }
      if (path === "/api/stats/daily" && method === "GET") {
        return await handleDaily(request, env);
      }
      if (path === "/api/stats/countries" && method === "GET") {
        return await handleCountries(request, env);
      }
      if (path === "/api/stats/cities" && method === "GET") {
        return await handleCities(request, env);
      }
      if (path === "/api/stats/verify" && method === "GET") {
        return await handleVerify(request, env);
      }
      if (path === "/api/stats/products" && method === "GET") {
        return await handleProducts(request, env);
      }
      if (path === "/api/stats/funnel" && method === "GET") {
        return await handleFunnel(request, env);
      }
      if (path === "/api/stats/campaigns" && method === "GET") {
        return await handleCampaigns(request, env);
      }
      if (path === "/api/stats/journeys" && method === "GET") {
        return await handleJourneys(request, env);
      }

      // ── Health check ──────────────────────────────────────────────────────
      if (path === "/health") {
        return jsonResponse(env, { status: "healthy", service: "analytics-platform-api" }, 200, origin);
      }

      // ── Serve frontend HTML files via ASSETS binding ──────────────────────
      const frontendPages: Record<string, string> = {
        "/": "/index.html",
        "/index.html": "/index.html",
        "/login.html": "/login.html",
        "/signup.html": "/signup.html",
        "/onboarding.html": "/onboarding.html",
        "/dashboard.html": "/dashboard.html",
        "/admin.html": "/admin.html",
        "/admin": "/admin.html",
        "/forgot-password.html": "/forgot-password.html",
        "/reset-password.html": "/reset-password.html",
      };

      const INSIGHTLY_SITE_ID = "insightly-platform-site";
      const PAGE_NAMES: Record<string, string> = {
        "/": "Home",
        "/index.html": "Home",
        "/login.html": "Login",
        "/signup.html": "Signup",
        "/onboarding.html": "Onboarding",
        "/dashboard.html": "Dashboard",
        "/admin.html": "Admin Panel",
        "/admin": "Admin Panel",
        "/forgot-password.html": "Forgot Password",
        "/reset-password.html": "Reset Password",
      };

      if (frontendPages[path]) {
        try {
          const assetResp = await env.ASSETS.fetch(new URL(`https://assets${frontendPages[path]}`));
          return assetResp;
        } catch (e) {
          console.error("Failed to serve frontend asset:", e);
        }
      }

      // ── Self-tracking endpoint ────────────────────────────────────────────
      if (path === "/px.gif" && method === "GET") {
        const cookieHeader = request.headers.get("Cookie") || "";
        let pid = cookieHeader.match(/pid=([^;]+)/)?.[1];
        if (!pid) pid = crypto.randomUUID();
        const sid = crypto.randomUUID();
        const pageUrl = url.searchParams.get("u") || request.headers.get("Referer") || url.href;
        const referrer = url.searchParams.get("r") || "";
        const pageTitle = PAGE_NAMES[new URL(pageUrl, "https://x").pathname] || "Insightly";
        const now = new Date().toISOString();
        const cfCountry = request.headers.get("CF-IPCountry") || "";

        ctx.waitUntil(
          Promise.all([
            env.DB.prepare(
              "INSERT INTO page_views (id, site_id, visitor_id, session_id, timestamp, page_url, page_title, referrer, is_first_visit, scroll_percentage, time_on_page, utm_source, utm_medium, utm_campaign, utm_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              crypto.randomUUID(), INSIGHTLY_SITE_ID, pid, sid, now,
              pageUrl, pageTitle, referrer, 1, 0, 0, "", "", "", ""
            ).run(),

            env.DB.prepare(
              "INSERT INTO sessions (id, site_id, session_id, visitor_id, started_at, entry_page, exit_page, page_count, is_bounce, referrer, utm_source, utm_campaign) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              crypto.randomUUID(), INSIGHTLY_SITE_ID, sid, pid, now,
              pageUrl, pageUrl, 1, 1, referrer, "", ""
            ).run(),

            cfCountry && cfCountry !== "XX" && cfCountry !== "T1"
              ? env.DB.prepare(
                  "INSERT INTO locations (id, page_view_id, country, city, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)"
                ).bind(crypto.randomUUID(), pid, cfCountry, "", null, null).run()
              : Promise.resolve(),
          ]).catch(() => {})
        );

        // Return 1x1 transparent GIF with Set-Cookie
        const gif = new Uint8Array([
          0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,
          0xff,0xff,0xff,0x00,0x00,0x00,0x21,0xf9,0x04,0x01,0x00,0x00,0x00,
          0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,
          0x44,0x01,0x00,0x3b
        ]);
        return new Response(gif, {
          status: 200,
          headers: {
            "Content-Type": "image/gif",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Set-Cookie": `pid=${pid}; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`,
          },
        });
      }

      // ── Try ASSETS for any unmatched route (static files) ────────────────
      try {
        const assetResp = await env.ASSETS.fetch(new URL(`https://assets${path}`));
        if (assetResp.ok) {
          return assetResp;
        }
      } catch (e) {
        // Not a static asset, continue
      }

      return errorResponse(env, "Not Found", 404, origin);
    } catch (err) {
      console.error("Unhandled error:", err);
      return jsonResponse(env, { error: "Internal Server Error" }, 500, origin);
    }
  },
};

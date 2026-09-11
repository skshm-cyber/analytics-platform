import { Env } from "../types";

/**
 * CORS headers based on allowed origins.
 * Strict allowlist: only origins in CORS_ORIGINS + localhost.
 */
export function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isAllowed =
    !!origin &&
    (allowed.includes(origin) ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1"));

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function jsonResponse(
  env: Env,
  data: unknown,
  status: number = 200,
  origin: string | null = null,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, origin),
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  env: Env,
  message: string,
  status: number = 400,
  origin: string | null = null
): Response {
  return jsonResponse(env, { error: message }, status, origin);
}

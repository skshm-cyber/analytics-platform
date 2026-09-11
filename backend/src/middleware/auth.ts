import { Env, AuthUser } from "../types";
import { verifyJwt, extractSessionCookie } from "../services/auth";
import { d1QueryOne } from "../services/d1";

/**
 * Extract authenticated user from JWT cookie.
 * Returns null if not authenticated.
 */
export async function getUser(
  env: Env,
  request: Request
): Promise<AuthUser | null> {
  const cookieHeader = request.headers.get("Cookie");
  const token = extractSessionCookie(cookieHeader);
  if (!token) return null;

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;

  const user = await d1QueryOne<{ id: string; email: string; name: string; is_admin: number }>(
    env.DB,
    "SELECT id, email, name, is_admin FROM users WHERE id = ?",
    payload.user_id
  );
  return user;
}

/**
 * Require authenticated user. Returns user or throws 401.
 */
export async function requireAuth(
  env: Env,
  request: Request
): Promise<AuthUser> {
  const user = await getUser(env, request);
  if (!user) throw new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  return user;
}

/**
 * Require admin user. Returns user or throws 403.
 */
export async function requireAdmin(
  env: Env,
  request: Request
): Promise<AuthUser> {
  const user = await requireAuth(env, request);
  if (!user.is_admin) throw new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
  return user;
}

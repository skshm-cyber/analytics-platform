import { Env } from "../types";
import { hashPassword, verifyPassword, signJwt, getSessionCookie } from "../services/auth";
import { d1Insert, d1QueryOne } from "../services/d1";
import { jsonResponse, errorResponse } from "../middleware/cors";

/**
 * POST /api/auth/signup
 * Body: { email, password, name? }
 */
export async function handleSignup(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(env, "Invalid JSON", 400, origin);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const name = body.name?.trim() || "";

  if (!email || !password) {
    return errorResponse(env, "Email and password are required", 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse(env, "Invalid email format", 400, origin);
  }
  if (password.length < 8) {
    return errorResponse(env, "Password must be at least 8 characters", 400, origin);
  }

  const existing = await d1QueryOne(env.DB, "SELECT id FROM users WHERE email = ?", email);
  if (existing) {
    return errorResponse(env, "An account with this email already exists", 409, origin);
  }

  const id = crypto.randomUUID();
  const password_hash = await hashPassword(password);

  const result = await d1Insert(env.DB, "users", {
    id,
    email,
    password_hash,
    name,
    is_admin: 0,
  });
  if (!result.success) {
    return errorResponse(env, "Failed to create account", 500, origin);
  }

  const token = await signJwt({ user_id: id, email, name, is_admin: 0 }, env.JWT_SECRET);
  const cookie = getSessionCookie(token);

  return jsonResponse(env, { id, email, name }, 201, origin, {
    "Set-Cookie": cookie,
  });
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
export async function handleLogin(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(env, "Invalid JSON", 400, origin);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return errorResponse(env, "Email and password are required", 400, origin);
  }

  const user = await d1QueryOne<{ id: string; email: string; name: string; password_hash: string; is_admin: number }>(
    env.DB,
    "SELECT id, email, name, password_hash, is_admin FROM users WHERE email = ?",
    email
  );
  if (!user) {
    return errorResponse(env, "Invalid email or password", 401, origin);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return errorResponse(env, "Invalid email or password", 401, origin);
  }

  const token = await signJwt(
    { user_id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
    env.JWT_SECRET
  );
  const cookie = getSessionCookie(token);

  return jsonResponse(env, {
    id: user.id,
    email: user.email,
    name: user.name,
    is_admin: user.is_admin,
  }, 200, origin, {
    "Set-Cookie": cookie,
  });
}

/**
 * POST /api/auth/logout
 */
export async function handleLogout(
  _request: Request,
  env: Env
): Promise<Response> {
  const origin = _request.headers.get("Origin");
  return jsonResponse(env, { status: "ok" }, 200, origin, {
    "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  });
}

/**
 * GET /api/auth/me
 */
export async function handleMe(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const { getUser } = await import("../middleware/auth");
  const user = await getUser(env, request);
  if (!user) {
    return errorResponse(env, "Not authenticated", 401, origin);
  }
  return jsonResponse(env, { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin }, 200, origin);
}

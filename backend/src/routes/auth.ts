import { Env } from "../types";
import { hashPassword, verifyPassword, signJwt, getSessionCookie } from "../services/auth";
import { d1Insert, d1QueryOne, d1Query } from "../services/d1";
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

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 */
export async function handleForgotPassword(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: { email?: string };
  try { body = await request.json(); } catch { return errorResponse(env, "Invalid JSON", 400, origin); }

  const email = body.email?.trim().toLowerCase();
  if (!email) return errorResponse(env, "Email is required", 400, origin);

  const user = await d1QueryOne<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = ?", email);

  if (user) {
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await hashPassword(token);
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    await d1Insert(env.DB, "password_resets", {
      id: crypto.randomUUID(),
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used: 0,
    });

    const resetUrl = `${new URL(request.url).origin}/reset-password.html?token=${token}`;

    console.log(`Password reset for ${email}: ${resetUrl}`);

    return jsonResponse(env, {
      message: "If an account exists, a reset link has been sent.",
      reset_url: resetUrl,
    }, 200, origin);
  }

  return jsonResponse(env, { message: "If an account exists, a reset link has been sent." }, 200, origin);
}

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 */
export async function handleResetPassword(
  request: Request,
  env: Env
): Promise<Response> {
  const origin = request.headers.get("Origin");
  let body: { token?: string; password?: string };
  try { body = await request.json(); } catch { return errorResponse(env, "Invalid JSON", 400, origin); }

  const { token, password } = body;
  if (!token || !password) return errorResponse(env, "Token and password are required", 400, origin);
  if (password.length < 8) return errorResponse(env, "Password must be at least 8 characters", 400, origin);

  const resets = await d1Query<{ id: string; user_id: string; token_hash: string; expires_at: string; used: number }>(
    env.DB,
    "SELECT id, user_id, token_hash, expires_at, used FROM password_resets WHERE used = 0 ORDER BY created_at DESC LIMIT 20"
  );

  let matched: typeof resets[0] | null = null;
  for (const r of resets) {
    if (await verifyPassword(token, r.token_hash)) {
      matched = r;
      break;
    }
  }

  if (!matched) return errorResponse(env, "Invalid or expired reset token", 400, origin);
  if (new Date(matched.expires_at).getTime() < Date.now()) {
    return errorResponse(env, "Reset token has expired", 400, origin);
  }

  const newHash = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, matched.user_id).run();
  await env.DB.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").bind(matched.id).run();

  return jsonResponse(env, { message: "Password reset successful" }, 200, origin);
}

/**
 * GET /api/auth/google — Initiate Google OAuth
 */
export async function handleGoogleAuth(
  request: Request,
  env: Env
): Promise<Response> {
  const clientId = (env as any).GOOGLE_CLIENT_ID;
  if (!clientId) return errorResponse(env, "Google OAuth not configured", 500, request.headers.get("Origin"));

  const redirectUri = `${new URL(request.url).origin}/api/auth/google/callback`;
  const state = crypto.randomUUID();
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid+email+profile&state=${state}&access_type=offline`;

  return Response.redirect(url, 302);
}

/**
 * GET /api/auth/google/callback
 */
export async function handleGoogleCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return errorResponse(env, "Missing authorization code", 400, url.origin);

  const clientId = (env as any).GOOGLE_CLIENT_ID;
  const clientSecret = (env as any).GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return errorResponse(env, "Google OAuth not configured", 500, url.origin);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: `${url.origin}/api/auth/google/callback`, grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) return errorResponse(env, "Failed to get access token", 400, url.origin);

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoRes.json() as any;
    if (!userInfo.email) return errorResponse(env, "Failed to get user info", 400, url.origin);

    return await handleOAuthUser(env, {
      provider: "google",
      providerId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name || "",
    }, url.origin);
  } catch (e) {
    return errorResponse(env, "OAuth failed", 500, url.origin);
  }
}

/**
 * GET /api/auth/github — Initiate GitHub OAuth
 */
export async function handleGithubAuth(
  request: Request,
  env: Env
): Promise<Response> {
  const clientId = (env as any).GITHUB_CLIENT_ID;
  if (!clientId) return errorResponse(env, "GitHub OAuth not configured", 500, request.headers.get("Origin"));

  const redirectUri = `${new URL(request.url).origin}/api/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;

  return Response.redirect(url, 302);
}

/**
 * GET /api/auth/github/callback
 */
export async function handleGithubCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return errorResponse(env, "Missing authorization code", 400, url.origin);

  const clientId = (env as any).GITHUB_CLIENT_ID;
  const clientSecret = (env as any).GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return errorResponse(env, "GitHub OAuth not configured", 500, url.origin);

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) return errorResponse(env, "Failed to get access token", 400, url.origin);

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json" },
    });
    const ghUser = await userRes.json() as any;
    if (!ghUser.email) {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json" },
      });
      const emails = await emailRes.json() as any[];
      const primary = emails.find((e: any) => e.primary && e.verified);
      if (primary) ghUser.email = primary.email;
    }
    if (!ghUser.email) return errorResponse(env, "Could not get email from GitHub", 400, url.origin);

    return await handleOAuthUser(env, {
      provider: "github",
      providerId: String(ghUser.id),
      email: ghUser.email,
      name: ghUser.name || ghUser.login || "",
    }, url.origin);
  } catch (e) {
    return errorResponse(env, "OAuth failed", 500, url.origin);
  }
}

/**
 * Shared: find or create user from OAuth, set session cookie, redirect to dashboard.
 */
async function handleOAuthUser(
  env: Env,
  info: { provider: string; providerId: string; email: string; name: string },
  origin: string
): Promise<Response> {
  const { provider, providerId, email, name } = info;

  let user = await d1QueryOne<{ id: string; email: string; name: string; is_admin: number }>(
    env.DB,
    "SELECT id, email, name, is_admin FROM users WHERE email = ?",
    email
  );

  if (!user) {
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(crypto.randomUUID());
    await d1Insert(env.DB, "users", {
      id, email, password_hash: passwordHash, name, is_admin: 0,
      provider, provider_id: providerId,
    });
    user = { id, email, name, is_admin: 0 };
  }

  const jwtToken = await signJwt(
    { user_id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
    env.JWT_SECRET
  );
  const cookie = getSessionCookie(jwtToken);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/dashboard.html`,
      "Set-Cookie": cookie,
    },
  });
}

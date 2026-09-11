/**
 * Simple in-memory rate limiter.
 * Per-IP, 100 requests per minute. Resets on worker restart.
 */
const hits = new Map<string, number[]>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = hits.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);
  hits.set(ip, recent);

  if (recent.length >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  recent.push(now);
  hits.set(ip, recent);
  return { allowed: true, remaining: MAX_REQUESTS - recent.length };
}

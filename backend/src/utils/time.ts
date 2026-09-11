// ── timezone-aware day windows ──────────────────────────────────────────────

export const SITE_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export function istDayStartISO(offsetDays = 0): string {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const utcMidnight = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() - offsetDays
  );
  return new Date(utcMidnight - IST_OFFSET_MS).toISOString();
}

export function istDateStr(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istHour(iso: string): number {
  const d = new Date(iso);
  const carry = d.getUTCMinutes() + 30 >= 60 ? 1 : 0;
  return (d.getUTCHours() + 5 + carry) % 24;
}

function resolveTimestamp(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const utcMid = new Date(v + "T00:00:00Z").getTime();
    return new Date(utcMid - IST_OFFSET_MS).toISOString();
  }
  const iso = new Date(v);
  return isNaN(iso.getTime()) ? null : iso.toISOString();
}

export function getWindow(url: URL, defDays = 1): { start: string; end: string } {
  const startParam = url.searchParams.get("start");
  if (startParam) {
    const start = resolveTimestamp(startParam);
    if (start) {
      const endParam = url.searchParams.get("end");
      const end = endParam ? resolveTimestamp(endParam) : null;
      return { start, end: end || new Date().toISOString() };
    }
  }
  const dateParam = url.searchParams.get("date");
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const start = resolveTimestamp(dateParam)!;
    return { start, end: new Date(new Date(start).getTime() + 24 * 3600 * 1000).toISOString() };
  }
  const days = parseInt(url.searchParams.get("days") || String(defDays), 10);
  const d = isNaN(days) || days < 1 ? defDays : Math.min(days, 365);
  return { start: istDayStartISO(d - 1), end: new Date().toISOString() };
}

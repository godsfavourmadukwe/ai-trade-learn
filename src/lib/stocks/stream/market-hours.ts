// ============================================================
// STOCK STREAM — Market Hours Detection
//
// Determines whether a stock's exchange is currently open so the
// UI can show LIVE vs MARKET CLOSED and never pretend prices are
// changing outside trading hours.
//
// Sessions per day (US exchanges, America/New_York):
//   pre      04:00 – 09:30
//   regular  09:30 – 16:00
//   post     16:00 – 20:00
//   closed   otherwise / weekends / holidays
// ============================================================

export type MarketSession = "pre" | "regular" | "post" | "closed";

export interface MarketStatus {
  session: MarketSession;
  isOpen: boolean; // true for pre/regular/post (stream may carry quotes)
  isRegularOpen: boolean; // true only during 09:30–16:00
  label: string;
  /** Epoch ms of the next session boundary, when known. */
  nextChangeAt: number | null;
}

/** NYSE/Nasdaq full-day closures (2026). Exchanges also close at 13:00 ET on early-close days. */
const US_MARKET_HOLIDAYS_2026 = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed Jul 4 falls on Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

const EARLY_CLOSE_2026 = new Set(["2026-11-27", "2026-12-24"]); // 13:00 ET close

/** Exchange-normalized session config. Non-US exchanges fall back to regular-hours approximation. */
export function isUsExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return true;
  const e = exchange.toUpperCase();
  return (
    e.includes("NMS") || e.includes("NGS") || e.includes("NASDAQ") ||
    e.includes("NYQ") || e.includes("NYSE") || e.includes("PCX") || e.includes("ASE") ||
    e.includes("BATS") || e.includes("CBOE") || e.includes("YHD")
  );
}

/** Convert epoch ms to wall-clock parts in America/New_York. */
function nyParts(timeMs: number): { dateStr: string; minutes: number; dayOfWeek: number } {
  const d = new Date(timeMs);
  const dateStr = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
  const hh = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
  const mm = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
  const dow = d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const dowNum = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dow);
  return { dateStr, minutes: hh * 60 + mm, dayOfWeek: dowNum };
}

/**
 * Current market status for a stock on a US exchange.
 * `exchange` comes from the quote (e.g. "NMS", "NasdaqGS", "NYSE").
 * Non-US exchanges are approximated: 08:00–16:30 local, Mon–Fri.
 */
export function getMarketStatus(timeMs: number, exchange?: string | null): MarketStatus {
  const us = isUsExchange(exchange);
  const { dateStr, minutes, dayOfWeek } = nyParts(timeMs);

  const weekend = dayOfWeek === 0 || dayOfWeek === 6;
  const holiday = us && US_MARKET_HOLIDAYS_2026.has(dateStr);
  const earlyClose = us && EARLY_CLOSE_2026.has(dateStr);

  if (!weekend && !holiday) {
    if (us) {
      const preStart = 4 * 60;
      const regStart = 9 * 60 + 30;
      const regEnd = earlyClose ? 13 * 60 : 16 * 60;
      const postEnd = earlyClose ? 13 * 60 + 30 : 20 * 60;

      if (minutes >= preStart && minutes < regStart) {
        return { session: "pre", isOpen: true, isRegularOpen: false, label: "PRE-MARKET", nextChangeAt: null };
      }
      if (minutes >= regStart && minutes < regEnd) {
        return { session: "regular", isOpen: true, isRegularOpen: true, label: "LIVE", nextChangeAt: null };
      }
      if (minutes >= regEnd && minutes < postEnd) {
        return { session: "post", isOpen: true, isRegularOpen: false, label: "AFTER-HOURS", nextChangeAt: null };
      }
    } else {
      // Rough international fallback: 08:00–16:30 NY time
      if (minutes >= 8 * 60 && minutes < 16 * 60 + 30) {
        return { session: "regular", isOpen: true, isRegularOpen: true, label: "LIVE", nextChangeAt: null };
      }
    }
  }

  return {
    session: "closed",
    isOpen: false,
    isRegularOpen: false,
    label: "MARKET CLOSED",
    nextChangeAt: null,
  };
}

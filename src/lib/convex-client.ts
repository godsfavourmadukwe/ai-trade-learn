// ============================================================
// Shared Convex browser client (singleton)
//
// Both the React app (main.tsx provider) and non-React library
// code (e.g. src/lib/stocks/data-engine.ts) share one client so
// there is a single connection per tab.
// ============================================================

import { ConvexReactClient } from "convex/react";
import { ConvexHttpClient } from "convex/browser";

const rawUrl = (import.meta as { env?: Record<string, string | undefined> }).env
  ?.VITE_CONVEX_URL;

if (!rawUrl) {
  throw new Error("VITE_CONVEX_URL is not configured");
}

/** React client for the app provider tree. */
export const convexReactClient = new ConvexReactClient(rawUrl);

/** Plain HTTP client for use outside React components. */
export const convexHttpClient = new ConvexHttpClient(rawUrl);

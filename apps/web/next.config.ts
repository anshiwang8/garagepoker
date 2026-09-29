import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * NEXT_PUBLIC_SERVER_URL is inlined into the client at build time, so a
 * production build without it would ship a site pointing at nothing (or at
 * localhost). Fail the build instead. `next dev` may leave it unset.
 */
function requireServerUrl(): void {
  const value = process.env.NEXT_PUBLIC_SERVER_URL;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_SERVER_URL is not set. Production builds need the Worker's base URL, " +
        "e.g. NEXT_PUBLIC_SERVER_URL=https://garagepoker.anshiwang.workers.dev",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_SERVER_URL is not a valid URL: "${value}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_SERVER_URL must be an http(s) URL, got "${value}"`);
  }
}

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) requireServerUrl();
  return {
    // The dev tools badge sits over the action zone; keep screenshots of /dev/table-states clean.
    devIndicators: false,
    // `page.dev.tsx` files (e.g. /dev/table-states) are pages only under `next dev`.
    pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
  };
}

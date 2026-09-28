import type { CreateTableResponse } from "@garagepoker/protocol";
import type { TableSettings } from "@garagepoker/engine";

/**
 * Base URL of the Worker, inlined at build time. Production builds fail
 * without it (next.config.ts); only `next dev` falls back to `wrangler dev`.
 */
export const SERVER_URL = (
  process.env.NEXT_PUBLIC_SERVER_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8787")
).replace(/\/+$/, "");

export function tableSocketUrl(tableId: string): string {
  return `${SERVER_URL.replace(/^http/, "ws")}/api/tables/${encodeURIComponent(tableId)}/ws`;
}

export async function createTable(token: string, settings: TableSettings): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, settings }),
  });
  const body = (await res.json().catch(() => null)) as (CreateTableResponse & { error?: string }) | null;
  if (!res.ok || !body?.tableId) throw new Error(body?.error ?? `Server error (${res.status})`);
  return body.tableId;
}

export const TABLE_ID = /^[A-Za-z0-9]{10}$/;

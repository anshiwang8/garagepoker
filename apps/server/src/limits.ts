/**
 * Worker-level limits and helpers. They live here, not in index.ts: the
 * Workers runtime treats every named export of the entry module as an
 * entrypoint and refuses to start if one isn't a handler or a class.
 */

/** Backstop against alarm loops: never schedule an alarm sooner than this from now. */
export const ALARM_CLAMP_MS = 5_000;

/**
 * An alarm at or before now fires again immediately; if tick() can't make
 * progress, that repeats until the table is deleted. Push such an alarm out
 * by ALARM_CLAMP_MS instead. (Table.nextAlarm() shouldn't produce one: this
 * is the safety net.)
 */
export function scheduleAlarm(at: number, now: number): { at: number; clamped: boolean } {
	return at > now ? { at, clamped: false } : { at: now + ALARM_CLAMP_MS, clamped: true };
}

/**
 * The sites allowed to create tables or open table sockets, from the
 * ALLOWED_ORIGINS wrangler var (comma-separated). Whitespace and trailing
 * slashes are ignored (browsers never send a trailing slash in Origin). An
 * empty or missing var allows nothing: misconfiguration fails closed.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim().replace(/\/+$/, ""))
		.filter(Boolean);
}

/** POST /api/tables: at most this many per client IP per window. */
export const CREATE_TABLE_LIMIT = 5;
export const CREATE_TABLE_WINDOW_MS = 60_000;

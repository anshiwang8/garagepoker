import { DurableObject } from "cloudflare:workers";

/**
 * An exact sliding-window rate limiter: one instance per key (e.g. per client
 * IP). Cloudflare's built-in rate-limit binding is per-location and
 * approximate by design; this counts every request. Timestamps are stored so
 * the limit survives eviction, and an alarm deletes them once the window has
 * passed, so nothing keyed by IP is kept longer than needed.
 */
export class RateLimiter extends DurableObject<Env> {
	/** The clock. Tests replace this to move time forward. */
	now: () => number = () => Date.now();

	/** Records one request if under the limit. */
	async take(limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
		const now = this.now();
		const recent = ((await this.ctx.storage.get<number[]>("times")) ?? []).filter((t) => now - t < windowMs);
		if (recent.length >= limit) {
			return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
		}
		recent.push(now);
		await this.ctx.storage.put("times", recent);
		await this.ctx.storage.setAlarm(now + windowMs);
		return { allowed: true, retryAfterSec: 0 };
	}

	async alarm(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}
}

/**
 * The rate-limit key for a client IP. IPv4 as is; IPv6 by its /64 prefix,
 * since one household or VPS usually gets a whole /64 and could otherwise
 * rotate addresses to dodge the limit.
 */
export function clientKey(ip: string | null): string {
	if (!ip) return "unknown";
	if (!ip.includes(":")) return ip;
	// IPv4-mapped IPv6 (::ffff:1.2.3.4): key by the IPv4 address.
	const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
	if (v4) return v4[1]!;
	const [head = "", tail] = ip.toLowerCase().split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
	return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

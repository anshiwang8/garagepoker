import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS, CREATE_TABLE_LIMIT } from "../src/index.js";
import { clientKey, type RateLimiter } from "../src/rateLimit.js";
import { freshIp, ORIGIN, token } from "./helpers.js";

const create = (headers: Record<string, string>, body: unknown = { token: token("sec") }) =>
	SELF.fetch("https://gp.test/api/tables", { method: "POST", headers, body: JSON.stringify(body) });
const upgrade = (tableId: string, headers: Record<string, string>) =>
	SELF.fetch(`https://gp.test/api/tables/${tableId}/ws`, { headers: { Upgrade: "websocket", ...headers } });

describe("allowed origins", () => {
	it("allows exactly the production site and local dev", () => {
		expect(ALLOWED_ORIGINS).toEqual(["https://garagepoker-flax.vercel.app", "http://localhost:3000"]);
	});

	it("answers CORS preflight only for allowed origins, echoing the origin", async () => {
		for (const origin of ALLOWED_ORIGINS) {
			const res = await SELF.fetch("https://gp.test/api/tables", { method: "OPTIONS", headers: { Origin: origin } });
			expect(res.status).toBe(204);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
			expect(res.headers.get("Vary")).toBe("Origin");
		}
		const evil = await SELF.fetch("https://gp.test/api/tables", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.example" },
		});
		expect(evil.status).toBe(403);
		expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("creates tables only from allowed origins; never sends a wildcard", async () => {
		const ok = await create({ Origin: "https://garagepoker-flax.vercel.app", "CF-Connecting-IP": freshIp() });
		expect(ok.status).toBe(201);
		expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://garagepoker-flax.vercel.app");

		for (const origin of ["https://evil.example", "https://garagepoker-flax.vercel.app.evil.example", "null"]) {
			const res = await create({ Origin: origin, "CF-Connecting-IP": freshIp() });
			expect(res.status).toBe(403);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
		}
		// No Origin at all (curl, scripts): rejected.
		expect((await create({ "CF-Connecting-IP": freshIp() })).status).toBe(403);
	});

	it("rejects WebSocket upgrades from other origins or with no origin", async () => {
		const res = await create({ Origin: ORIGIN, "CF-Connecting-IP": freshIp() });
		const { tableId } = (await res.json()) as { tableId: string };
		expect((await upgrade(tableId, { Origin: "https://evil.example" })).status).toBe(403);
		expect((await upgrade(tableId, {})).status).toBe(403);
		const ok = await upgrade(tableId, { Origin: ORIGIN });
		expect(ok.status).toBe(101);
		ok.webSocket!.accept();
		ok.webSocket!.close();
	});
});

describe("rate limit on POST /api/tables", () => {
	it(`allows ${CREATE_TABLE_LIMIT} per minute per IP, then 429 until the window passes`, async () => {
		const ip = "203.0.113.7";
		const headers = { Origin: ORIGIN, "CF-Connecting-IP": ip };
		// Invalid requests count too: the limit is checked before the body.
		expect((await create(headers, { token: "bad" })).status).toBe(400);
		for (let i = 1; i < CREATE_TABLE_LIMIT; i++) expect((await create(headers)).status).toBe(201);

		const limited = await create(headers);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(Number(limited.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
		expect(limited.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
		expect(((await limited.json()) as { error: string }).error).toMatch(/Too many new tables/);

		// Other IPs are unaffected.
		expect((await create({ Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.8" })).status).toBe(201);

		// A minute later, the same IP can create again.
		await runInDurableObject(env.RATE_LIMITER.getByName(`create-table:${ip}`), (limiter: RateLimiter) => {
			const start = Date.now();
			limiter.now = () => start + 60_001;
		});
		expect((await create(headers)).status).toBe(201);
	});

	it("keys IPv6 clients by /64 and IPv4-mapped addresses by the IPv4 address", () => {
		expect(clientKey("198.51.100.4")).toBe("198.51.100.4");
		expect(clientKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
		expect(clientKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
		expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(clientKey("2001:db8:1:3::1")).not.toBe(clientKey("2001:db8:1:2::1"));
		expect(clientKey("::ffff:192.0.2.9")).toBe("192.0.2.9");
		expect(clientKey(null)).toBe("unknown");
	});
});

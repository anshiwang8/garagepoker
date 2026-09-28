import { describe, expect, it } from "vitest";

describe("Worker entry module", () => {
	// The Workers runtime treats every named export of the entry module as an
	// entrypoint and won't start if one isn't a handler or a class (a stray
	// `export const` broke `wrangler dev` and deploys once). The test pool
	// doesn't load the module that way, so check the exports directly.
	it("exports only the default handler and Durable Object classes", async () => {
		const mod: Record<string, unknown> = await import("../src/index.js");
		expect(Object.keys(mod).sort()).toEqual(["RateLimiter", "TableRoom", "default"]);
		for (const [name, value] of Object.entries(mod)) {
			if (name === "default") {
				expect(typeof (value as { fetch?: unknown }).fetch).toBe("function");
				continue;
			}
			expect(typeof value, name).toBe("function");
			expect(Function.prototype.toString.call(value).startsWith("class"), `${name} is a class`).toBe(true);
		}
	});
});

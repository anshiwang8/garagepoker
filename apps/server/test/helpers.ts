import { DEFAULT_SETTINGS, type RandomSource, type TableSettings } from "@garagepoker/engine";
import type { ClientMessage, ServerMessage, TableView } from "@garagepoker/protocol";
import { SELF } from "cloudflare:test";
import { expect } from "vitest";
import { newTableData, Table, type TableData } from "../src/table.js";
import { buildView } from "../src/view.js";

/** Deterministic RandomSource (mulberry32). */
export function seededRandom(seed: number): RandomSource {
	let a = seed >>> 0;
	return (buf) => {
		for (let i = 0; i < buf.length; i++) {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			buf[i] = (t ^ (t >>> 14)) >>> 0;
		}
	};
}

export const token = (name: string) => `${name}-token-0123456789`.slice(0, 32);

/**
 * A Table driven directly, with a fake clock and a fake set of connections.
 * `send` mirrors TableRoom.mutate: handle, then sync presence, then tick.
 */
export function harness(settings: Partial<TableSettings> = {}) {
	const random = seededRandom(42);
	const clock = { now: 1_000_000 };
	const connected = new Set<string>();
	const data: TableData = newTableData(
		"TestTable1",
		token("owner"),
		{ ...DEFAULT_SETTINGS, autoStart: false, ...settings },
		{ now: clock.now, random },
	);
	const table = () => new Table(data, { now: clock.now, random, connected });
	const settle = () => {
		const t = table();
		t.syncPresence();
		t.tick();
	};
	const h = {
		data,
		clock,
		connected,
		table,
		ownerId: data.ownerId,
		/** Registers and connects a player; returns their id. */
		join(name: string): string {
			const id = table().hello(token(name));
			connected.add(id);
			settle();
			return id;
		},
		disconnect(id: string) {
			connected.delete(id);
			settle();
		},
		send(playerId: string, m: Exclude<ClientMessage, { type: "hello" | "getReplay" }>) {
			table().handle(playerId, m);
			settle();
		},
		/** Moves the clock forward and runs due timers (like an alarm). */
		advance(ms: number) {
			clock.now += ms;
			settle();
		},
		view(playerId: string): TableView {
			return buildView(data, playerId, connected, clock.now);
		},
		/** Seats a player with the owner approving; returns their id. */
		seat(name: string, seat: number, stack: number): string {
			const id = name === "owner" ? h.ownerId : h.join(name);
			h.send(id, { type: "requestSeat", seat, nickname: name, buyIn: stack, postBlind: false });
			const req = data.requests.find((r) => r.playerId === id);
			if (req) h.send(h.ownerId, { type: "approveRequest", requestId: req.id, stack });
			return id;
		},
		/** The player whose turn it is acts. */
		act(action: Extract<ClientMessage, { type: "act" }>["action"]) {
			const seat = data.hand!.toAct!;
			h.send(data.seats[seat - 1]!.playerId, { type: "act", hand: data.handNumber, action });
		},
	};
	connected.add(h.ownerId);
	settle();
	return h;
}

// ---------------------------------------------------------------------------
// WebSocket clients against the real Worker + Durable Object
// ---------------------------------------------------------------------------

/** An allowed browser origin (see the ALLOWED_ORIGINS var in wrangler.jsonc). */
export const ORIGIN = "http://localhost:3000";

let nextIp = 1;
/** A fresh client IP, so tests that create many tables stay under the rate limit. */
export const freshIp = () => `10.0.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`;

export async function createTable(ownerToken: string, settings: Partial<TableSettings> = {}): Promise<string> {
	const res = await SELF.fetch("https://gp.test/api/tables", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": freshIp() },
		body: JSON.stringify({ token: ownerToken, settings }),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { tableId: string }).tableId;
}

export class Client {
	/** Every raw message this client received, in order. */
	readonly raw: string[] = [];
	private waiters: (() => void)[] = [];

	constructor(readonly ws: WebSocket) {
		ws.addEventListener("message", (e) => {
			this.raw.push(e.data as string);
			for (const w of this.waiters.splice(0)) w();
		});
	}

	static async connect(tableId: string, playerToken: string): Promise<Client> {
		const res = await SELF.fetch(`https://gp.test/api/tables/${tableId}/ws`, {
			headers: { Upgrade: "websocket", Origin: ORIGIN },
		});
		expect(res.status).toBe(101);
		const ws = res.webSocket!;
		ws.accept();
		const c = new Client(ws);
		await c.request({ type: "hello", token: playerToken });
		return c;
	}

	get messages(): ServerMessage[] {
		return this.raw.map((r) => JSON.parse(r) as ServerMessage);
	}

	get view(): TableView {
		const views = this.messages.flatMap((m) => (m.type === "view" ? [m.view] : []));
		return views.at(-1)!;
	}

	/** Asks for the last hand's replay and returns it. */
	async replay() {
		const reply = await this.request({ type: "getReplay" });
		if (reply.type !== "replay") throw new Error(`expected a replay, got ${reply.type}`);
		return reply.replay;
	}

	send(m: ClientMessage | Record<string, unknown>) {
		this.ws.send(JSON.stringify(m));
	}

	/** Highest table revision this client has seen (0 before any view). */
	get rev(): number {
		return Math.max(0, ...this.messages.map((m) => (m.type === "view" ? m.view.rev : 0)));
	}

	/** Waits until `done` holds, re-checking on every message. */
	async until(done: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!done()) {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				setTimeout(resolve, 50);
			});
		}
	}

	waitForCount(count: number): Promise<void> {
		return this.until(() => this.raw.length > count, `message ${count + 1}`);
	}

	waitForRev(rev: number): Promise<void> {
		return this.until(() => this.rev >= rev, `rev ${rev}`);
	}

	/**
	 * Sends a message and returns its reply: an error, or the first view with a
	 * revision newer than `afterRev` (broadcasts from others can arrive first).
	 */
	async request(m: ClientMessage | Record<string, unknown>, afterRev = this.rev): Promise<ServerMessage> {
		const n = this.raw.length;
		this.send(m);
		let reply: ServerMessage | undefined;
		await this.until(() => {
			reply = this.messages.slice(n).find((x) => x.type !== "view" || x.view.rev > afterRev);
			return !!reply;
		}, `reply to ${String(m.type)}`);
		return reply!;
	}

	close() {
		this.ws.close(1000, "bye");
	}
}

/** Sends from `actor` and waits until every client has the resulting revision. */
export async function step(clients: Client[], actor: Client, m: ClientMessage): Promise<void> {
	const reply = await actor.request(m, Math.max(...clients.map((c) => c.rev)));
	if (reply.type === "error") throw new Error(`${m.type} failed: ${reply.message}`);
	if (reply.type !== "view") throw new Error(`${m.type} got a ${reply.type} reply, not a view`);
	await Promise.all(clients.map((c) => c.waitForRev(reply.view.rev)));
}

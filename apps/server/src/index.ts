import { DEFAULT_SETTINGS, type RandomSource, type TableSettings, validateConfig } from "@garagepoker/engine";
import {
  type ClientMessageType,
  clientMessageSchema,
  createTableSchema,
  encode,
  MAX_CLIENT_MESSAGE_BYTES,
  type ServerMessage,
} from "@garagepoker/protocol";
import { DurableObject } from "cloudflare:workers";
import { clientKey } from "./rateLimit.js";
import { newTableData, randomId, Table, type TableData, TableError } from "./table.js";
import { seal } from "./fairness.js";
import { buildReplay } from "./replay.js";
import { buildView } from "./view.js";

export { RateLimiter } from "./rateLimit.js";

const cryptoRandom: RandomSource = (buf) => {
	crypto.getRandomValues(buf);
};

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

interface Attachment {
	/** Set by the "hello" message. */
	playerId: string | null;
}

/**
 * One TableRoom per table. Validates every message with Zod, runs it through
 * the Table rules, persists the table (so it survives hibernation), then
 * sends each connection its own redacted view.
 */
export class TableRoom extends DurableObject<Env> {
	private data: TableData | null = null;

	/** The clock. Tests replace this to drive timers. */
	now: () => number = () => Date.now();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.data = (await ctx.storage.get<TableData>("table")) ?? null;
		});
		// Keep-alive pings are answered without waking the object.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	/** RPC from the Worker. Returns false if this id is already a table. */
	async create(id: string, ownerToken: string, settings: TableSettings): Promise<boolean> {
		if (this.data) return false;
		this.data = newTableData(id, ownerToken, settings, { now: this.now(), random: cryptoRandom });
		await this.persist(new Table(this.data, this.deps()));
		return true;
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		}
		// Ended tables still accept connections so players can see the final ledger.
		if (!this.data) return new Response("Table not found", { status: 404 });
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ playerId: null } satisfies Attachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (!this.data) return ws.close(1011, "Table not found");
		if (typeof raw !== "string" || raw.length > MAX_CLIENT_MESSAGE_BYTES) {
			return send(ws, { type: "error", message: "Message too large or not text" });
		}
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return send(ws, { type: "error", message: "Message is not valid JSON" });
		}
		const parsed = clientMessageSchema.safeParse(json);
		if (!parsed.success) {
			return send(ws, { type: "error", message: `Invalid message: ${parsed.error.issues[0]?.message}` });
		}
		const m = parsed.data;

		if (m.type === "hello") {
			await this.mutate(ws, m.type, (table) => {
				const playerId = table.hello(m.token);
				ws.serializeAttachment({ playerId } satisfies Attachment);
			});
			return;
		}
		const playerId = attachment(ws).playerId;
		if (!playerId) return send(ws, { type: "error", message: "Send hello first", for: m.type });
		// Read-only: answered to this socket alone, no state change or broadcast.
		if (m.type === "getReplay") return send(ws, { type: "replay", replay: buildReplay(this.data, playerId) });
		await this.mutate(ws, m.type, (table) => table.handle(playerId, m));
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		await this.mutate(null, undefined, () => {}, ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.mutate(null, undefined, () => {}, ws);
	}

	async alarm(): Promise<void> {
		await this.mutate(null, undefined, () => {});
	}

	// -------------------------------------------------------------------------

	private connectedIds(closing?: WebSocket): Set<string> {
		const ids = new Set<string>();
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === closing) continue;
			const id = attachment(ws).playerId;
			if (id) ids.add(id);
		}
		return ids;
	}

	private deps(closing?: WebSocket) {
		return { now: this.now(), random: cryptoRandom, connected: this.connectedIds(closing) };
	}

	/**
	 * Applies a change and everything that follows from it (timers, presence),
	 * then persists and broadcasts. On any error the table is left untouched.
	 */
	private async mutate(
		ws: WebSocket | null,
		type: ClientMessageType | undefined,
		change: (table: Table) => void,
		closing?: WebSocket,
	): Promise<void> {
		if (!this.data) return;
		const before = structuredClone(this.data);
		let table: Table;
		try {
			change(new Table(this.data, this.deps(closing)));
			// hello may have added a connection, so recompute presence before timers.
			table = new Table(this.data, this.deps(closing));
			table.syncPresence();
			table.tick();
			// A hand just started: commit to its deck before anyone sees it.
			if (this.data.fairness && this.data.fairness.commitment === null) await seal(this.data.fairness);
		} catch (err) {
			this.data = before;
			if (!(err instanceof TableError)) console.error("TableRoom error", err);
			const message = err instanceof TableError ? err.message : "Something went wrong";
			if (ws) send(ws, { type: "error", message, ...(type && { for: type }) });
			return;
		}
		if (table.shouldDelete()) {
			await this.destroy();
			return;
		}
		this.data.rev++;
		await this.persist(table);
		this.broadcast(closing);
	}

	private async persist(table: Table): Promise<void> {
		await this.ctx.storage.put("table", this.data);
		const next = table.nextAlarm();
		if (next === null) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		const { at, clamped } = scheduleAlarm(next.at, this.now());
		if (clamped) {
			console.warn(
				`TableRoom ${this.data?.id}: "${next.timer}" alarm was due at ${new Date(next.at).toISOString()}, ` +
					`not in the future; clamped to +${ALARM_CLAMP_MS / 1000} s to avoid an alarm loop`,
			);
		}
		await this.ctx.storage.setAlarm(at);
	}

	private broadcast(closing?: WebSocket): void {
		if (!this.data) return;
		const connected = this.connectedIds(closing);
		const now = this.now();
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === closing) continue;
			const playerId = attachment(ws).playerId;
			if (playerId) send(ws, { type: "view", view: buildView(this.data, playerId, connected, now) });
		}
	}

	private async destroy(): Promise<void> {
		for (const ws of this.ctx.getWebSockets()) ws.close(1000, "Table closed");
		this.data = null;
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}
}

function attachment(ws: WebSocket): Attachment {
	return (ws.deserializeAttachment() as Attachment | null) ?? { playerId: null };
}

function send(ws: WebSocket, message: ServerMessage): void {
	try {
		ws.send(encode(message));
	} catch {
		// The socket closed; its close handler will clean up.
	}
}

// ---------------------------------------------------------------------------
// Worker: routes HTTP and WebSocket requests to the right TableRoom.
// ---------------------------------------------------------------------------

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

/**
 * The request's Origin if it's allowed, else null. Browsers always send
 * Origin on cross-origin POSTs and WebSocket upgrades, so a missing Origin
 * (curl, scripts) is rejected too. This stops other websites from using a
 * visitor's browser against the API; it can't stop non-browser clients,
 * which can send any Origin — that's what the rate limit is for.
 */
function allowedOrigin(request: Request, env: Env): string | null {
	const origin = request.headers.get("Origin");
	return origin !== null && parseAllowedOrigins(env.ALLOWED_ORIGINS).includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
	const headers: Record<string, string> = { Vary: "Origin" };
	if (origin) {
		headers["Access-Control-Allow-Origin"] = origin;
		headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
		headers["Access-Control-Allow-Headers"] = "Content-Type";
		headers["Access-Control-Max-Age"] = "600";
	}
	return headers;
}

function json(body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders(origin), ...extra },
	});
}

const WS_PATH = /^\/api\/tables\/([A-Za-z0-9]{10})\/ws$/;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const origin = allowedOrigin(request, env);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
		}

		if (url.pathname === "/api/tables" && request.method === "POST") {
			if (!origin) return json({ error: "Origin not allowed" }, 403, null);

			// Counted before the body is read, so malformed requests count too.
			const key = clientKey(request.headers.get("CF-Connecting-IP"));
			const limit = await env.RATE_LIMITER.getByName(`create-table:${key}`).take(
				CREATE_TABLE_LIMIT,
				CREATE_TABLE_WINDOW_MS,
			);
			if (!limit.allowed) {
				return json(
					{ error: `Too many new tables. Try again in ${limit.retryAfterSec} s.` },
					429,
					origin,
					{ "Retry-After": String(limit.retryAfterSec) },
				);
			}

			const text = await request.text();
			if (text.length > MAX_CLIENT_MESSAGE_BYTES) return json({ error: "Request too large" }, 413, origin);
			let body: unknown;
			try {
				body = JSON.parse(text);
			} catch {
				return json({ error: "Body must be JSON" }, 400, origin);
			}
			const parsed = createTableSchema.safeParse(body);
			if (!parsed.success) return json({ error: "Invalid request", issues: parsed.error.issues }, 400, origin);
			const settings: TableSettings = { ...DEFAULT_SETTINGS, ...parsed.data.settings };
			const issues = validateConfig(settings);
			if (issues.length) return json({ error: "Invalid settings", issues }, 400, origin);
			// 62^10 ids: collisions are vanishingly rare, but retry anyway.
			for (let attempt = 0; attempt < 3; attempt++) {
				const tableId = randomId(10, cryptoRandom);
				if (await env.TABLE.getByName(tableId).create(tableId, parsed.data.token, settings)) {
					return json({ tableId }, 201, origin);
				}
			}
			return json({ error: "Could not create a table" }, 500, origin);
		}

		const ws = WS_PATH.exec(url.pathname);
		if (ws && request.method === "GET") {
			// Blocks cross-site WebSocket hijacking from other websites.
			if (!origin) return new Response("Origin not allowed", { status: 403 });
			return env.TABLE.getByName(ws[1]!).fetch(request);
		}

		return json({ error: "Not found" }, 404, origin);
	},
} satisfies ExportedHandler<Env>;

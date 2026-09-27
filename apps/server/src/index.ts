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
import { newTableData, randomId, Table, type TableData, TableError } from "./table.js";
import { buildView } from "./view.js";

const cryptoRandom: RandomSource = (buf) => {
	crypto.getRandomValues(buf);
};

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
		const at = table.nextAlarm();
		if (at === null) await this.ctx.storage.deleteAlarm();
		else await this.ctx.storage.setAlarm(at);
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

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

const WS_PATH = /^\/api\/tables\/([A-Za-z0-9]{10})\/ws$/;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

		if (url.pathname === "/api/tables" && request.method === "POST") {
			const text = await request.text();
			if (text.length > MAX_CLIENT_MESSAGE_BYTES) return json({ error: "Request too large" }, 413);
			let body: unknown;
			try {
				body = JSON.parse(text);
			} catch {
				return json({ error: "Body must be JSON" }, 400);
			}
			const parsed = createTableSchema.safeParse(body);
			if (!parsed.success) return json({ error: "Invalid request", issues: parsed.error.issues }, 400);
			const settings: TableSettings = { ...DEFAULT_SETTINGS, ...parsed.data.settings };
			const issues = validateConfig(settings);
			if (issues.length) return json({ error: "Invalid settings", issues }, 400);
			// 62^10 ids: collisions are vanishingly rare, but retry anyway.
			for (let attempt = 0; attempt < 3; attempt++) {
				const tableId = randomId(10, cryptoRandom);
				if (await env.TABLE.getByName(tableId).create(tableId, parsed.data.token, settings)) {
					return json({ tableId }, 201);
				}
			}
			return json({ error: "Could not create a table" }, 500);
		}

		const ws = WS_PATH.exec(url.pathname);
		if (ws && request.method === "GET") return env.TABLE.getByName(ws[1]!).fetch(request);

		return json({ error: "Not found" }, 404);
	},
} satisfies ExportedHandler<Env>;

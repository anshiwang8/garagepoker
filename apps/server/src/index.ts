import { DurableObject } from "cloudflare:workers";

/**
 * One TableRoom per poker table. Phase 2 fills this in with the WebSocket
 * protocol (Hibernation API), seat management and the engine reducer.
 */
export class TableRoom extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const stub = env.TABLE.getByName("foo");
		const greeting = await stub.sayHello("world");
		return new Response(greeting);
	},
} satisfies ExportedHandler<Env>;

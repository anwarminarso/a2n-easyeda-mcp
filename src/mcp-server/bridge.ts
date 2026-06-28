import { WebSocketServer, WebSocket } from 'ws';

export interface BridgeRequest {
	id: string;
	method: string;
	params: Record<string, unknown>;
}

export interface BridgeResponse {
	id: string;
	result?: unknown;
	error?: string;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket bridge between the MCP server (stdio) and the EasyEDA Pro extension.
 * The MCP server is the WS server; the extension connects as a client.
 */
export class WebSocketBridge {
	private wss: WebSocketServer | null = null;
	private client: WebSocket | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private requestIdCounter = 0;
	private readonly timeout: number;

	constructor(
		private readonly port: number = 8788,
		private readonly host: string = '127.0.0.1',
		timeout = 300000,
	) {
		this.timeout = timeout;
	}

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.wss = new WebSocketServer({ port: this.port, host: this.host });

			this.wss.on('listening', () => {
				console.error(`[a2n-bridge] WebSocket server listening on ws://${this.host}:${this.port}`);
				resolve();
			});

			this.wss.on('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					// Keep MCP stdio alive; just retry binding so we self-heal across reloads.
					console.error(`[a2n-bridge] Port ${this.port} in use, retrying in 3s...`);
					setTimeout(() => {
						try {
							this.wss?.close();
						} catch {
							/* ignore */
						}
						this.start().then(resolve).catch(reject);
					}, 3000);
					return;
				}
				console.error('[a2n-bridge] WebSocket server error:', err);
				reject(err);
			});

			this.wss.on('connection', (ws) => {
				console.error('[a2n-bridge] EasyEDA extension connected');
				this.client = ws;

				ws.on('message', (data) => {
					try {
						const msg = JSON.parse(data.toString());
						// Heartbeat support
						if (msg && msg.event === 'ping') {
							ws.send(JSON.stringify({ event: 'pong' }));
							return;
						}
						this.handleResponse(msg as BridgeResponse);
					} catch (err) {
						console.error('[a2n-bridge] Failed to parse message:', err);
					}
				});

				ws.on('close', () => {
					console.error('[a2n-bridge] EasyEDA extension disconnected');
					if (this.client === ws) this.client = null;
					for (const [id, pending] of this.pendingRequests) {
						clearTimeout(pending.timer);
						pending.reject(new Error('EasyEDA extension disconnected'));
						this.pendingRequests.delete(id);
					}
				});

				ws.on('error', (err) => console.error('[a2n-bridge] Client error:', err));
			});
		});
	}

	isConnected(): boolean {
		return this.client !== null && this.client.readyState === WebSocket.OPEN;
	}

	async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		if (!this.isConnected()) {
			throw new Error(
				'EasyEDA extension is not connected.\n' +
					'1. Open EasyEDA Pro and open a schematic or PCB.\n' +
					'2. Click "a2n MCP -> Connect MCP".\n' +
					'3. Make sure the configured port matches this server.',
			);
		}

		const id = String(++this.requestIdCounter);
		const request: BridgeRequest = { id, method, params };

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timed out after ${this.timeout}ms: ${method}`));
			}, this.timeout);

			this.pendingRequests.set(id, { resolve, reject, timer });
			this.client!.send(JSON.stringify(request));
		});
	}

	private handleResponse(response: BridgeResponse): void {
		if (!response || !response.id) return;
		const pending = this.pendingRequests.get(response.id);
		if (!pending) return;

		clearTimeout(pending.timer);
		this.pendingRequests.delete(response.id);

		if (response.error) pending.reject(new Error(response.error));
		else pending.resolve(response.result);
	}

	async stop(): Promise<void> {
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Bridge shutting down'));
			this.pendingRequests.delete(id);
		}
		if (this.client) {
			this.client.close();
			this.client = null;
		}
		return new Promise((resolve) => {
			if (this.wss) this.wss.close(() => resolve());
			else resolve();
		});
	}
}

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
	socket: WebSocket;
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const BIND_RETRY_MS = 3000;
/** Close code sent to an older extension socket when a newer one takes over. */
const CLOSE_REPLACED = 4001;

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
	private listening = false;
	private stopped = false;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly port: number = 8788,
		private readonly host: string = '127.0.0.1',
		timeout = 300000,
	) {
		this.timeout = timeout;
	}

	get endpoint(): string {
		return `ws://${this.host}:${this.port}`;
	}

	isListening(): boolean {
		return this.listening;
	}

	/**
	 * Bind the WebSocket server. Resolves once listening. If the port is in use, it keeps
	 * retrying every few seconds (the returned promise stays pending until it binds), so callers
	 * should not block MCP stdio startup on it.
	 */
	start(): Promise<void> {
		this.stopped = false;
		return new Promise((resolve, reject) => this.listen(resolve, reject));
	}

	private listen(resolve: () => void, reject: (err: Error) => void): void {
		if (this.stopped) return;
		const wss = new WebSocketServer({ port: this.port, host: this.host });
		this.wss = wss;

		wss.on('listening', () => {
			this.listening = true;
			console.error(`[a2n-bridge] WebSocket server listening on ${this.endpoint}`);
			resolve();
		});

		wss.on('error', (err: NodeJS.ErrnoException) => {
			if (!this.listening && err.code === 'EADDRINUSE') {
				console.error(`[a2n-bridge] Port ${this.port} in use, retrying in ${BIND_RETRY_MS / 1000}s...`);
				wss.removeAllListeners();
				try {
					wss.close();
				} catch {
					/* ignore */
				}
				if (this.wss === wss) this.wss = null;
				this.retryTimer = setTimeout(() => {
					this.retryTimer = null;
					this.listen(resolve, reject);
				}, BIND_RETRY_MS);
				return;
			}
			console.error('[a2n-bridge] WebSocket server error:', err);
			if (!this.listening) reject(err);
		});

		wss.on('connection', (ws) => this.attachClient(ws));
	}

	private attachClient(ws: WebSocket): void {
		const previous = this.client;
		if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) {
			console.error('[a2n-bridge] New EasyEDA extension connection replaces the previous one');
			this.rejectPendingFor(previous, 'EasyEDA extension reconnected (a newer connection replaced this one). Retry the tool call.');
			try {
				// Tell the old extension instance not to auto-reconnect and fight over the slot.
				previous.send(JSON.stringify({ event: 'replaced' }));
				previous.close(CLOSE_REPLACED, 'Replaced by a newer EasyEDA extension connection');
			} catch {
				/* ignore */
			}
		}

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
			// Only requests that were sent over this socket can no longer be answered.
			this.rejectPendingFor(ws, 'EasyEDA extension disconnected');
		});

		ws.on('error', (err) => console.error('[a2n-bridge] Client error:', err));
	}

	private rejectPendingFor(socket: WebSocket, message: string): void {
		for (const [id, pending] of this.pendingRequests) {
			if (pending.socket !== socket) continue;
			clearTimeout(pending.timer);
			this.pendingRequests.delete(id);
			pending.reject(new Error(message));
		}
	}

	isConnected(): boolean {
		return this.client !== null && this.client.readyState === WebSocket.OPEN;
	}

	async send(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
		const client = this.client;
		if (!client || client.readyState !== WebSocket.OPEN) {
			const listenHint = this.listening
				? `The MCP server is listening on ${this.endpoint}.`
				: `The MCP server could not bind ${this.endpoint} yet (port in use?); it keeps retrying.`;
			throw new Error(
				'EasyEDA extension is not connected.\n' +
					'1. Open EasyEDA Pro and open a schematic or PCB.\n' +
					'2. Click "a2n MCP -> Connect MCP".\n' +
					'3. Make sure the configured port matches this server.\n' +
					listenHint,
			);
		}

		const id = String(++this.requestIdCounter);
		const request: BridgeRequest = { id, method, params };
		const effectiveTimeout = timeoutMs ?? this.timeout;

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timed out after ${effectiveTimeout}ms: ${method}`));
			}, effectiveTimeout);

			this.pendingRequests.set(id, { socket: client, resolve, reject, timer });
			try {
				client.send(JSON.stringify(request));
			} catch (err) {
				clearTimeout(timer);
				this.pendingRequests.delete(id);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
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
		this.stopped = true;
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Bridge shutting down'));
			this.pendingRequests.delete(id);
		}
		if (this.client) {
			this.client.close();
			this.client = null;
		}
		const wss = this.wss;
		this.wss = null;
		this.listening = false;
		return new Promise((resolve) => {
			if (wss) wss.close(() => resolve());
			else resolve();
		});
	}
}

import { allHandlers } from './handlers';
import { getConfig } from './config';

const WS_ID = 'a2n-easyeda-mcp';
/** One timer drives both reconnect attempts (when disconnected) and heartbeat pings (when connected). */
const TICK_INTERVAL_MS = 5000;
/**
 * eda.sys_WebSocket.register() has no close/error callback, so a dead server is detected by silence:
 * if nothing (pong or request) arrives for this long, the connection is treated as lost.
 */
const HEARTBEAT_TIMEOUT_MS = 20000;

interface State {
	extensionUuid: string;
	connected: boolean;
	scanning: boolean;
	userStopped: boolean;
	/** Set when the server reports a newer extension connection took over; disables auto-reconnect. */
	replaced: boolean;
	lastSeenAt: number;
	scanTimer?: ReturnType<typeof setInterval>;
	url?: string;
}

const state: State = {
	extensionUuid: '',
	connected: false,
	scanning: false,
	userStopped: false,
	replaced: false,
	lastSeenAt: 0,
};

function sendRaw(payload: string): void {
	eda.sys_WebSocket.send(WS_ID, payload, state.extensionUuid);
}

function sendResponse(id: string, result?: any, error?: string): void {
	const response: Record<string, any> = { id };
	if (error) response.error = error;
	else response.result = result;
	try {
		sendRaw(JSON.stringify(response));
	} catch {
		/* socket closed */
	}
}

function closeSocket(): void {
	try {
		eda.sys_WebSocket.close(WS_ID, undefined, undefined, state.extensionUuid);
	} catch {
		/* ignore */
	}
}

function markDisconnected(reason: string): void {
	if (!state.connected) return;
	state.connected = false;
	closeSocket();
	eda.sys_Log.add(`[a2n-mcp] disconnected: ${reason}`, ESYS_LogType.WARNING);
}

async function onMessage(event: MessageEvent<any>): Promise<void> {
	state.lastSeenAt = Date.now();
	let id: string | undefined;
	try {
		const message = typeof event.data === 'string' ? event.data : String(event.data);
		const request = JSON.parse(message);

		// Heartbeat reply from server
		if (request && request.event === 'pong') return;

		// Server dropped this socket because another extension instance connected.
		if (request && request.event === 'replaced') {
			state.replaced = true;
			state.connected = false;
			eda.sys_Message.showToastMessage(
				'a2n MCP: another EasyEDA window took over the MCP connection. Use "Connect MCP" to take it back.',
				ESYS_ToastMessageType.WARNING,
			);
			eda.sys_Log.add('[a2n-mcp] connection replaced by another extension instance', ESYS_LogType.WARNING);
			return;
		}

		id = request.id;
		const method: string = request.method;
		const params: Record<string, any> = request.params || {};

		const handler = allHandlers[method];
		if (!handler) {
			sendResponse(id!, undefined, `Unknown method: ${method}`);
			return;
		}

		const result = await handler(params);
		sendResponse(id!, result);
	} catch (err: any) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		if (id) sendResponse(id, undefined, errorMsg);
		eda.sys_Log.add(`[a2n-mcp] handler error: ${errorMsg}`, ESYS_LogType.ERROR);
	}
}

function doRegister(url: string): void {
	eda.sys_WebSocket.register(
		WS_ID,
		url,
		onMessage,
		() => {
			state.connected = true;
			state.replaced = false;
			state.lastSeenAt = Date.now();
			eda.sys_Message.showToastMessage('a2n MCP connected', ESYS_ToastMessageType.SUCCESS);
			eda.sys_Log.add(`[a2n-mcp] connected to ${url}`, ESYS_LogType.INFO);
		},
		state.extensionUuid,
	);
}

async function tryConnect(): Promise<void> {
	if (state.connected || state.userStopped || state.replaced) return;
	const config = await getConfig();
	const url = `ws://${config.host}:${config.port}`;
	state.url = url;

	// Close any stale socket first: register() ignores new params while a socket with the same ID is active.
	closeSocket();

	try {
		doRegister(url);
	} catch (err: any) {
		eda.sys_Log.add(`[a2n-mcp] connect attempt failed: ${err?.message ?? err}`, ESYS_LogType.WARNING);
	}
}

function heartbeat(): void {
	if (Date.now() - state.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
		markDisconnected(`no reply from server for ${HEARTBEAT_TIMEOUT_MS / 1000}s`);
		return;
	}
	try {
		sendRaw(JSON.stringify({ event: 'ping' }));
	} catch (err: any) {
		markDisconnected(`ping failed: ${err?.message ?? err}`);
	}
}

function tick(): void {
	if (state.userStopped || state.replaced) return;
	if (state.connected) heartbeat();
	// heartbeat() may have just marked the link as lost; reconnect on the same tick.
	if (!state.connected) void tryConnect();
}

export function startScan(extensionUuid: string, showToast = false): void {
	state.extensionUuid = extensionUuid;
	state.userStopped = false;
	// A manual connect (or config save) explicitly takes the connection back from another window.
	if (showToast) state.replaced = false;

	if (showToast) eda.sys_Message.showToastMessage('a2n MCP: scanning for server...', ESYS_ToastMessageType.INFO);

	void tryConnect();

	if (!state.scanning) {
		state.scanning = true;
		state.scanTimer = setInterval(tick, TICK_INTERVAL_MS);
	}
}

export function stopScan(extensionUuid: string): void {
	state.extensionUuid = extensionUuid;
	state.userStopped = true;
	state.connected = false;

	if (state.scanTimer) {
		clearInterval(state.scanTimer);
		state.scanTimer = undefined;
	}
	state.scanning = false;

	closeSocket();
	eda.sys_Message.showMessage('a2n MCP disconnected');
}

export function reconnect(extensionUuid: string): void {
	state.extensionUuid = extensionUuid;
	state.connected = false;
	closeSocket();
	startScan(extensionUuid, true);
}

export function getConnectionState() {
	return { connected: state.connected, scanning: state.scanning, replaced: state.replaced, url: state.url };
}

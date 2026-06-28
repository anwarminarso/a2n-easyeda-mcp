import { allHandlers } from './handlers';
import { getConfig } from './config';

const WS_ID = 'a2n-easyeda-mcp';
const SCAN_INTERVAL_MS = 5000;

interface State {
	extensionUuid: string;
	connected: boolean;
	scanning: boolean;
	userStopped: boolean;
	scanTimer?: ReturnType<typeof setInterval>;
	url?: string;
}

const state: State = {
	extensionUuid: '',
	connected: false,
	scanning: false,
	userStopped: false,
};

function sendResponse(id: string, result?: any, error?: string): void {
	const response: Record<string, any> = { id };
	if (error) response.error = error;
	else response.result = result;
	try {
		eda.sys_WebSocket.send(WS_ID, JSON.stringify(response), state.extensionUuid);
	} catch {
		/* socket closed */
	}
}

async function onMessage(event: MessageEvent<any>): Promise<void> {
	let id: string | undefined;
	try {
		const message = typeof event.data === 'string' ? event.data : String(event.data);
		const request = JSON.parse(message);

		// Heartbeat from server
		if (request && request.event === 'pong') return;

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
			eda.sys_Message.showToastMessage('a2n MCP connected', ESYS_ToastMessageType.SUCCESS);
			eda.sys_Log.add(`[a2n-mcp] connected to ${url}`, ESYS_LogType.INFO);
		},
		state.extensionUuid,
	);
}

async function tryConnect(): Promise<void> {
	if (state.connected || state.userStopped) return;
	const config = await getConfig();
	const url = `ws://${config.host}:${config.port}`;
	state.url = url;

	// Close any stale socket first, then (re)register.
	try {
		eda.sys_WebSocket.close(WS_ID, undefined, undefined, state.extensionUuid);
	} catch {
		/* ignore */
	}

	try {
		doRegister(url);
	} catch (err: any) {
		eda.sys_Log.add(`[a2n-mcp] connect attempt failed: ${err?.message ?? err}`, ESYS_LogType.WARNING);
	}
}

export function startScan(extensionUuid: string, showToast = false): void {
	state.extensionUuid = extensionUuid;
	state.userStopped = false;

	if (showToast) eda.sys_Message.showToastMessage('a2n MCP: scanning for server...', ESYS_ToastMessageType.INFO);

	void tryConnect();

	if (!state.scanning) {
		state.scanning = true;
		state.scanTimer = setInterval(() => {
			if (!state.connected && !state.userStopped) void tryConnect();
		}, SCAN_INTERVAL_MS);
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

	try {
		eda.sys_WebSocket.close(WS_ID, undefined, undefined, extensionUuid);
	} catch {
		/* ignore */
	}
	eda.sys_Message.showMessage('a2n MCP disconnected');
}

export function reconnect(extensionUuid: string): void {
	state.connected = false;
	try {
		eda.sys_WebSocket.close(WS_ID, undefined, undefined, extensionUuid);
	} catch {
		/* ignore */
	}
	startScan(extensionUuid, true);
}

export function getConnectionState() {
	return { connected: state.connected, scanning: state.scanning, url: state.url };
}

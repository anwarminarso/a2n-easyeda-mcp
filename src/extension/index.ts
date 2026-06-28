import * as extensionConfig from '../../extension.json';
import { getConfig, setConfig, A2nConfig } from './config';
import { startScan, stopScan, reconnect, getConnectionState } from './ws-client';

const UUID = extensionConfig.uuid;

// Expose config + control functions to the configuration iframe (shares the `eda` global).
const edaAny = eda as any;
edaAny.a2nGetConfig = async () => getConfig();
edaAny.a2nSetConfig = async (patch: Partial<A2nConfig>) => {
	const next = await setConfig(patch);
	reconnect(UUID);
	return next;
};
edaAny.a2nGetState = () => getConnectionState();

export async function activate(_status?: 'onStartupFinished', _arg?: string): Promise<void> {
	const config = await getConfig();
	if (config.autoConnect) startScan(UUID, false);
}

export function connectMcp(): void {
	startScan(UUID, true);
}

export function disconnectMcp(): void {
	stopScan(UUID);
}

export async function openConfig(): Promise<void> {
	eda.sys_IFrame.openIFrame('/iframe/config.html', 440, 340);
}

export async function showStatus(): Promise<void> {
	const config = await getConfig();
	const s = getConnectionState();
	eda.sys_Dialog.showInformationMessage(
		`a2n.EasyEDA MCP\n\n` +
			`Connected: ${s.connected ? 'yes' : 'no'}\n` +
			`Server: ws://${config.host}:${config.port}\n` +
			`Mode: ${config.mode}\n` +
			`Auto-connect: ${config.autoConnect ? 'on' : 'off'}`,
		'a2n MCP Status',
	);
}

export async function about(): Promise<void> {
	eda.sys_Dialog.showInformationMessage(
		`${extensionConfig.displayName}\nVersion ${extensionConfig.version}\n\n` +
			`Pure interface MCP bridge for EasyEDA Pro. No AI, no external server.\n` +
			`Modes: online / offline / hybrid.`,
		'About a2n.EasyEDA MCP',
	);
}

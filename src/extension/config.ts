import AppDBClient from 'appdb';

export type SourcingMode = 'online' | 'offline' | 'hybrid';

export interface A2nConfig {
	port: number;
	host: string;
	mode: SourcingMode;
	autoConnect: boolean;
}

export const DEFAULT_CONFIG: A2nConfig = {
	port: 8788,
	host: '127.0.0.1',
	mode: 'hybrid',
	autoConnect: true,
};

const CONFIG_ID = 'a2n-mcp-config';

const configDb = new AppDBClient(false).init('a2n_mcp', {
	config: ['_id', 'data'],
});

let cache: A2nConfig | null = null;

export async function getConfig(): Promise<A2nConfig> {
	if (cache) return cache;
	try {
		const db = await configDb;
		const row = await db.config.find({ _id: CONFIG_ID }).then((r: any[]) => r[0]).catch(() => undefined);
		if (row && row.data) {
			cache = { ...DEFAULT_CONFIG, ...JSON.parse(row.data) };
			return cache!;
		}
	} catch {
		/* ignore – fall back to defaults */
	}
	cache = { ...DEFAULT_CONFIG };
	return cache;
}

export async function setConfig(patch: Partial<A2nConfig>): Promise<A2nConfig> {
	const current = await getConfig();
	const next: A2nConfig = { ...current, ...patch };
	// normalize
	if (!next.port || next.port < 1 || next.port > 65535) next.port = DEFAULT_CONFIG.port;
	if (next.mode !== 'online' && next.mode !== 'offline' && next.mode !== 'hybrid') next.mode = DEFAULT_CONFIG.mode;
	if (!next.host) next.host = DEFAULT_CONFIG.host;
	cache = next;

	try {
		const db = await configDb;
		const existing = await db.config.find({ _id: CONFIG_ID }).then((r: any[]) => r[0]).catch(() => undefined);
		if (existing) {
			await db.config.update({ _id: CONFIG_ID }, { _id: CONFIG_ID, data: JSON.stringify(next) });
		} else {
			await db.config.insert({ _id: CONFIG_ID, data: JSON.stringify(next) });
		}
	} catch {
		/* ignore – cache still updated for this session */
	}

	return next;
}

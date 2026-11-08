import { getConfig, setConfig, A2nConfig } from '../config';

type Handler = (params: Record<string, any>) => Promise<any>;

const CONFIG_KEYS: Array<keyof A2nConfig> = ['mode', 'port', 'host', 'autoConnect'];

export const configHandlers: Record<string, Handler> = {
	'a2n.config.get': async () => getConfig(),
	// Only forward keys the caller actually provided; missing keys keep their stored value.
	'a2n.config.set': async (p) => {
		const patch: Partial<A2nConfig> = {};
		for (const key of CONFIG_KEYS) {
			if (p[key] !== undefined) (patch as any)[key] = p[key];
		}
		return setConfig(patch);
	},
};

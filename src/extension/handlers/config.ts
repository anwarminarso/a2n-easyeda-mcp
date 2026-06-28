import { getConfig, setConfig } from '../config';

type Handler = (params: Record<string, any>) => Promise<any>;

export const configHandlers: Record<string, Handler> = {
	'a2n.config.get': async () => getConfig(),
	'a2n.config.set': async (p) => setConfig({ mode: p.mode, port: p.port, host: p.host, autoConnect: p.autoConnect }),
};

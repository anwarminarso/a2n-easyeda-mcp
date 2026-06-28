import { getConfig } from '../config';

type Handler = (params: Record<string, any>) => Promise<any>;

export const libHandlers: Record<string, Handler> = {
	// Low-level passthroughs
	'lib.device.search': async (p) => eda.lib_Device.search(p.key, p.libraryUuid, p.classification, p.symbolType, p.itemsOfPage, p.page),
	'lib.device.get': async (p) => eda.lib_Device.get(p.deviceUuid, p.libraryUuid),
	'lib.device.getByLcscIds': async (p) => eda.lib_Device.getByLcscIds(p.lcscIds, p.libraryUuid),
	'lib.getSystemLibraryUuid': async () => eda.lib_LibrariesList.getSystemLibraryUuid(),
	'lib.getAllLibraries': async () => eda.lib_LibrariesList.getAllLibrariesList(),

	// Mode-aware high-level search (online / offline / hybrid)
	'lib.searchComponent': async (p) => {
		const config = await getConfig();
		const key: string = p.query ?? p.key ?? '';
		const limit: number = p.limit ?? 20;

		const trySearch = async (libraryUuid?: string) =>
			eda.lib_Device.search(key, libraryUuid, undefined, undefined, limit, 1).catch(() => [] as any[]);

		const sysUuid = await eda.lib_LibrariesList.getSystemLibraryUuid().catch(() => undefined);

		let results: any[] = [];
		if (config.mode === 'offline') {
			results = await trySearch(sysUuid);
		} else if (config.mode === 'online') {
			results = await trySearch(undefined);
		} else {
			// hybrid: local first, fall back to backend
			results = await trySearch(sysUuid);
			if (!results || !results.length) results = await trySearch(undefined);
		}

		const slim = (results || []).slice(0, limit).map((d: any) => ({
			uuid: d.uuid,
			libraryUuid: d.libraryUuid,
			name: d.name,
			manufacturerId: d.manufacturerId,
			supplierId: d.supplierId,
			classification: d.classification,
			footprint: d.footprint?.name ?? d.footprint?.title,
		}));

		return { mode: config.mode, count: slim.length, results: slim };
	},
};

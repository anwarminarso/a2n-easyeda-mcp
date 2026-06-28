import type { ExplainCircuit } from './circuit-types';
import { getPrimitiveById } from './utils';

const SEARCH_BY_CODES_CHUNK_SIZE = 50;

function getFootprintNameFromOtherProperty(otherProperty?: Record<string, unknown> | null) {
	const footprint = Object.entries(otherProperty ?? {}).find(([key, value]) => {
		return key.toLowerCase().includes('footprint') && value !== null && value !== undefined && value.toString().trim();
	});
	return footprint?.[1]?.toString() ?? null;
}

type SearchByCodesDevice = {
	uuid: string;
	product_code: string;
	attributes?: Record<string, unknown>;
	footprint?: { display_title?: string; title?: string };
};

type SearchByCodesResponse = { success?: boolean; result?: SearchByCodesDevice[] };

async function searchDevicesByCodes(codes: string[]) {
	const devices: SearchByCodesDevice[] = [];

	for (let index = 0; index < codes.length; index += SEARCH_BY_CODES_CHUNK_SIZE) {
		const chunk = codes.slice(index, index + SEARCH_BY_CODES_CHUNK_SIZE);
		const response = await eda.sys_ClientUrl.request(
			'https://pro.easyeda.com/api/devices/searchByCodes',
			'POST',
			JSON.stringify({ codes: chunk }),
			{ headers: { 'Content-Type': 'application/json' } },
		);

		if (!response.ok) continue;

		const data = (await response.json()) as SearchByCodesResponse;
		if (data.success && Array.isArray(data.result)) devices.push(...data.result);
	}

	return devices;
}

function parseAllegroNetlist(netlistText: string, allowedSignalNames?: Set<string>) {
	netlistText = netlistText.replaceAll('\r', '').replaceAll('\n\n', '\n');

	const lines = netlistText.split('\n');
	const signalToPins = new Map<string, string[]>();
	let inNetsSection = false;
	let currentNetLine = '';

	const normalizeLine = (line: string) => line.replaceAll(',', ' ').replace(/\s+/g, ' ').trim();

	const parseNetLine = (line: string) => {
		const match = line.match(/^['"]?(.*?)['"]?\s*;\s*(.*)$/);
		if (!match) return;

		const signalName = match[1].trim();
		if (allowedSignalNames?.size && !allowedSignalNames.has(signalName) && !signalName.startsWith('$')) return;

		const pinRefs = match[2].split(/\s+/).map((p) => p.trim()).filter(Boolean);
		signalToPins.set(signalName, pinRefs);
	};

	for (const line of lines) {
		const trimmed = normalizeLine(line);
		if (trimmed === '$NETS') {
			if (currentNetLine) {
				parseNetLine(currentNetLine);
				currentNetLine = '';
			}
			inNetsSection = true;
			continue;
		}
		if (trimmed.startsWith('$') && trimmed !== '$NETS' && !trimmed.includes(';')) {
			if (currentNetLine) {
				parseNetLine(currentNetLine);
				currentNetLine = '';
			}
			inNetsSection = false;
			continue;
		}
		if (!inNetsSection || !trimmed || trimmed.startsWith(';')) continue;

		if (trimmed.includes(';')) {
			if (currentNetLine) parseNetLine(currentNetLine);
			currentNetLine = trimmed;
			continue;
		}

		if (currentNetLine) currentNetLine += ` ${trimmed}`;
	}

	if (currentNetLine) parseNetLine(currentNetLine);

	const pinToSignal = new Map<string, string>();
	for (const [signal, pinList] of signalToPins) {
		for (const pinRef of pinList) pinToSignal.set(pinRef, signal);
	}

	return pinToSignal;
}

export async function getSchematic(primitiveIds?: string[], options?: { disableExtractPartUuid: boolean }): Promise<ExplainCircuit> {
	let netlistText = await eda.sch_ManufactureData
		.getNetlistFile(undefined, ESYS_NetlistType.ALLEGRO)
		.then((file) => file?.text())
		.catch(() => undefined);
	if (!netlistText && typeof eda?.sch_Netlist?.getNetlist === 'function')
		netlistText = await eda.sch_Netlist.getNetlist(ESYS_NetlistType.ALLEGRO).catch(() => undefined);

	if (!netlistText) throw new Error('Failed to export netlist');

	const allWiresName = await eda.sch_PrimitiveWire.getAll()
		.then((wires) => wires.map((wire) => wire.getState_Net()).filter((n): n is string => typeof n === 'string' && n.trim().length > 0))
		.catch(() => []);
	const currentPageSignalNames = new Set(allWiresName);

	const pinToSignal = parseAllegroNetlist(netlistText, currentPageSignalNames);

	if (!primitiveIds) primitiveIds = await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId();

	const componentsMap: Map<string, ExplainCircuit['components'][0] & { code?: string }> = new Map();

	for (const id of primitiveIds) {
		const primitiveComponent = await getPrimitiveById(id).then((r) => (Array.isArray(r) ? r[0] : r)).catch(() => null);

		if (!primitiveComponent || primitiveComponent.getState_PrimitiveType() !== ESCH_PrimitiveType.COMPONENT) continue;

		const designator = primitiveComponent?.getState_Designator?.() ?? '';
		if (!designator.trim()) continue;
		if (designator.includes('|') && designator.length > 4) continue;

		const component = componentsMap.get(designator);
		if (component && !primitiveComponent.getState_SubPartName()) continue;

		let value: string | null = null;
		const name = primitiveComponent.getState_Name() ?? '';
		const otherProperty = primitiveComponent.getState_OtherProperty();

		if (name.includes('Manufacturer Part')) value = primitiveComponent.getState_ManufacturerId() ?? '';
		else if (name.includes('Value')) value = otherProperty?.Value?.toString() ?? null;
		else if (name[0] !== '=') value = name;

		if (!value) value = primitiveComponent.getState_ManufacturerId() ?? '';

		const pins: ExplainCircuit['components'][0]['pins'] = [];
		const rawPins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveComponent.getState_PrimitiveId()).catch(() => undefined);

		if (Array.isArray(rawPins)) {
			for (const p of rawPins) {
				const pinNumber = p.getState_PinNumber();
				const pinName = p.getState_PinName();
				const pinRef = `${designator}.${pinNumber}`;
				const signalName = pinToSignal.get(pinRef) || '';
				pins.push({ pin_number: pinNumber, name: pinName, signal_name: signalName });
			}
		}

		componentsMap.set(designator, {
			designator,
			part_uuid: null,
			pins: [...(component?.pins ?? []), ...pins],
			value,
			pos: {
				x: primitiveComponent.getState_X(),
				y: primitiveComponent.getState_Y(),
				rotate: primitiveComponent.getState_Rotation(),
				mirror: primitiveComponent.getState_Mirror(),
			},
			code: primitiveComponent.getState_SupplierId()?.toString() || undefined,
			footprint_name: component?.footprint_name ?? getFootprintNameFromOtherProperty(otherProperty),
		});
	}

	const lcscIds = [
		...new Set([...componentsMap.values()].map((component) => component.code).filter((code): code is string => Boolean(code))),
	];

	const devices = !options?.disableExtractPartUuid && lcscIds.length ? await searchDevicesByCodes(lcscIds).catch(() => []) : [];

	const deviceByLcscId = new Map<string, SearchByCodesDevice>();
	for (const device of devices) {
		if (device.product_code && !deviceByLcscId.has(device.product_code)) deviceByLcscId.set(device.product_code, device);
	}

	const components: ExplainCircuit['components'] = [...componentsMap.values()].map((component) => {
		const device = component.code ? deviceByLcscId.get(component.code) : null;
		return {
			designator: component.designator,
			pins: component.pins,
			value: component.value,
			pos: component.pos,
			part_uuid: device?.uuid ?? null,
			footprint_name:
				device?.footprint?.display_title ??
				device?.footprint?.title ??
				device?.attributes?.['Supplier Footprint']?.toString() ??
				component.footprint_name,
		};
	});

	return { components };
}

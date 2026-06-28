import { assembleLocal } from '../eda/assemble-local';
import { placeComponent } from '../eda/place-component';
import { getSchematic } from '../eda/schematic';
import { getPrimitiveComponentPins } from '../eda/search';
import { rmPartFromDesignator } from '../eda/utils';
import { getConfig } from '../config';

type Handler = (params: Record<string, any>) => Promise<any>;

export const assembleHandlers: Record<string, Handler> = {
	// High-level: place + auto-wire locally.
	'sch.assemble': async (p) => assembleLocal({ components: p.components ?? [], nets: p.nets ?? [], saveCheckpoint: p.saveCheckpoint }),

	// Read current schematic as a structured circuit (components + resolved nets).
	'sch.readCircuit': async (p) => {
		const config = await getConfig();
		const primitiveIds = await eda.sch_PrimitiveComponent.getAllPrimitiveId().then((r) => [...r]).catch(() => [] as string[]);
		return getSchematic(primitiveIds, { disableExtractPartUuid: config.mode === 'offline' });
	},

	// Place a single component from a library.
	'sch.component.place': async (p) => {
		let component = await placeComponent(
			{ libraryUuid: p.libraryUuid || 'lcsc', uuid: p.uuid },
			{ x: p.x, y: p.y, rotate: p.rotation, mirror: p.mirror, subPartName: p.subPartName, addIntoBom: p.addIntoBom, addIntoPcb: p.addIntoPcb },
		);
		if (p.designator) component.setState_Designator(rmPartFromDesignator(p.designator));
		if (p.mirror) component.setState_Mirror(p.mirror);
		component = await component.done();
		const primitiveId = component.getState_PrimitiveId();
		const pins = await getPrimitiveComponentPins(primitiveId).catch(() => []);
		return { primitiveId, designator: p.designator, pinCount: pins.length };
	},
};

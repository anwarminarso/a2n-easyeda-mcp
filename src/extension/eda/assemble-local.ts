import { checkpointer } from './checkpointer';
import { searchFreePlaceV2 } from './free-place-searcher';
import { placeComponent } from './place-component';
import { placeNet } from './place-net';
import { getPrimitiveComponentPins } from './search';
import { AddedNet, PlacedComponents } from './types';
import { getPageSize, rmPartFromDesignator, to2 } from './utils';

export interface AssembleComponentInput {
	designator: string;
	uuid: string;
	libraryUuid?: string;
	x?: number;
	y?: number;
	rotation?: number;
	mirror?: boolean;
	subPartName?: string;
}

export interface AssembleInput {
	components: AssembleComponentInput[];
	nets?: AddedNet[];
	saveCheckpoint?: boolean;
}

/**
 * Fully local circuit assembly: place components (auto free-placement when no
 * coordinates are given) and auto-wire pins by net name. No external server, no AI.
 *
 * The whole operation is bounded by an overall wall-clock budget so the handler
 * always returns a (possibly partial) result before the WS bridge request timeout,
 * instead of hanging on a large circuit and surfacing a "Request timed out" error.
 */
const ASSEMBLE_BUDGET_MS = 220_000; // stay safely under the 300s bridge timeout

export async function assembleLocal(input: AssembleInput) {
	const { components, nets = [], saveCheckpoint = true } = input;
	const deadlineAt = Date.now() + ASSEMBLE_BUDGET_MS;

	if (saveCheckpoint) {
		await checkpointer.save(false).catch(() => undefined);
	}

	const pageSize = await getPageSize();
	// Start placing near page center and walk right/down for each component.
	let cursorX = to2(pageSize.width / 4);
	let cursorY = to2(pageSize.height / 2);
	const STEP_X = 120;

	const placed: PlacedComponents = {};
	const placedReport: Array<{ designator: string; ok: boolean; error?: string }> = [];

	for (const comp of components) {
		if (Date.now() > deadlineAt) {
			placedReport.push({ designator: comp.designator, ok: false, error: 'skipped: time budget exceeded' });
			continue;
		}
		try {
			let x = comp.x;
			let y = comp.y;

			if (x === undefined || y === undefined) {
				const spot = await searchFreePlaceV2({ x: cursorX, y: cursorY }, { w: 100, h: 100 });
				x = spot.x ?? cursorX;
				y = spot.y ?? cursorY;
				cursorX = (x ?? cursorX) + STEP_X;
			}

			let component = await placeComponent(
				{ libraryUuid: comp.libraryUuid || 'lcsc', uuid: comp.uuid },
				{ x: x!, y: y!, rotate: comp.rotation, mirror: comp.mirror, subPartName: comp.subPartName },
			);

			component.setState_Designator(rmPartFromDesignator(comp.designator));
			if (comp.mirror) component.setState_Mirror(comp.mirror);

			component = await component.done();

			const primitiveId = component.getState_PrimitiveId();
			const pins = await getPrimitiveComponentPins(primitiveId);

			placed[comp.designator] = { primitive_id: primitiveId, pins, designator: comp.designator };
			placedReport.push({ designator: comp.designator, ok: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			eda.sys_Log.add(`a2n assemble: component error ${comp.designator}: ${msg}`);
			eda.sys_Message.showToastMessage(`Component error ${comp.designator}: ${msg}`, ESYS_ToastMessageType.ERROR);
			placedReport.push({ designator: comp.designator, ok: false, error: msg });
		}
	}

	let netResult = { wired: 0, skipped: 0, timedOut: false };
	if (nets.length) {
		if (Date.now() > deadlineAt) {
			netResult = { wired: 0, skipped: nets.length, timedOut: true };
		} else {
			netResult = await placeNet(nets, placed, true, deadlineAt);
		}
	}

	const placedCount = placedReport.filter((r) => r.ok).length;
	const timedOut = Date.now() > deadlineAt || netResult.timedOut;
	const summary = timedOut
		? `a2n assemble stopped at time budget: ${placedCount}/${components.length} components, ${netResult.wired} nets wired.`
		: `a2n assemble complete: ${placedCount}/${components.length} components.`;
	eda.sys_Message.showToastMessage(summary, timedOut ? ESYS_ToastMessageType.WARNING : ESYS_ToastMessageType.SUCCESS);

	return {
		placed: placedReport,
		netsWired: netResult.wired,
		netsSkipped: netResult.skipped,
		timedOut,
	};
}

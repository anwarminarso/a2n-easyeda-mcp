import type { ExplainCircuit } from './circuit-types';
import { getSchematic } from './schematic';
import { findPin, getAllPrimitivePins, getPrimitiveComponentPins, searchComponentInSCH } from './search';
import { AddedNet } from './types';
import { getPrimitiveById, rmPartFromDesignator } from './utils';

interface Point {
	x: number;
	y: number;
}

interface Segment {
	start: Point;
	end: Point;
	originalIndex: number;
}

interface EasyEDAWire {
	async: boolean;
	primitiveType: string;
	line: number[][];
	net: string;
	primitiveId: string;
}

const getPointKey = (p: Point): string => `${p.x},${p.y}`;

function pointsEqual(p1: Point, p2: Point): boolean {
	return p1.x === p2.x && p1.y === p2.y;
}

export function isPointOnSegment(point: Point, segment: Segment): boolean {
	const { start, end } = segment;

	const crossProduct = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
	if (crossProduct !== 0) return false;

	const minX = Math.min(start.x, end.x);
	const maxX = Math.max(start.x, end.x);
	const minY = Math.min(start.y, end.y);
	const maxY = Math.max(start.y, end.y);

	return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function splitWireAtJunctions(wireData: EasyEDAWire, options?: { pins?: Point[] }): EasyEDAWire[] {
	if (!wireData.line || wireData.line.length === 0) return [wireData];

	const pins = options?.pins ?? [];

	const segments: Segment[] = wireData.line.map((coords, index) => ({
		start: { x: coords[0], y: coords[1] },
		end: { x: coords[2], y: coords[3] },
		originalIndex: index,
	}));

	const pinPoints = new Set<string>();

	for (const pin of pins) {
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];

			if (pointsEqual(pin, seg.start) || pointsEqual(pin, seg.end)) {
				pinPoints.add(getPointKey(pin));
				continue;
			}

			if (isPointOnSegment(pin, seg)) {
				const pinKey = getPointKey(pin);
				pinPoints.add(pinKey);

				const newSeg1: Segment = { start: seg.start, end: pin, originalIndex: seg.originalIndex };
				const newSeg2: Segment = { start: pin, end: seg.end, originalIndex: seg.originalIndex };

				segments.splice(i, 1, newSeg1, newSeg2);
				i++;
			}
		}
	}

	const adjacencyMap = new Map<string, Set<number>>();

	const addToMap = (point: Point, segmentIndex: number) => {
		const key = getPointKey(point);
		if (!adjacencyMap.has(key)) adjacencyMap.set(key, new Set());
		adjacencyMap.get(key)!.add(segmentIndex);
	};

	segments.forEach((seg, idx) => {
		addToMap(seg.start, idx);
		addToMap(seg.end, idx);
	});

	const junctions = new Set<string>();
	const ends = new Set<string>();

	adjacencyMap.forEach((segmentIndices, pointKey) => {
		const degree = segmentIndices.size;
		if (degree > 2) junctions.add(pointKey);
		else if (degree === 1) ends.add(pointKey);
	});

	pinPoints.forEach((pointKey) => junctions.add(pointKey));

	const visitedSegments = new Set<number>();
	const newWires: number[][][] = [];

	const traverse = (startPointKey: string, startSegmentIndex: number) => {
		const path: number[][] = [];
		let currentSegIndex = startSegmentIndex;
		let currentPointKey = startPointKey;

		while (currentSegIndex !== -1 && !visitedSegments.has(currentSegIndex)) {
			visitedSegments.add(currentSegIndex);
			const seg = segments[currentSegIndex];

			const isForward = getPointKey(seg.start) === currentPointKey;

			const p1 = isForward ? seg.start : seg.end;
			const p2 = isForward ? seg.end : seg.start;

			path.push([p1.x, p1.y, p2.x, p2.y]);

			const nextPointKey = isForward ? getPointKey(seg.end) : getPointKey(seg.start);
			currentPointKey = nextPointKey;

			const connectedSegments = adjacencyMap.get(nextPointKey);
			let nextSegIndex = -1;

			if (connectedSegments) {
				for (const idx of connectedSegments) {
					if (idx !== currentSegIndex && !visitedSegments.has(idx)) {
						nextSegIndex = idx;
						break;
					}
				}
			}

			if (junctions.has(nextPointKey) || ends.has(nextPointKey)) break;

			currentSegIndex = nextSegIndex;
		}

		if (path.length > 0) newWires.push(path);
	};

	ends.forEach((pointKey) => {
		const connected = adjacencyMap.get(pointKey);
		if (connected) connected.forEach((segIndex) => {
			if (!visitedSegments.has(segIndex)) traverse(pointKey, segIndex);
		});
	});

	junctions.forEach((pointKey) => {
		const connected = adjacencyMap.get(pointKey);
		if (connected) connected.forEach((segIndex) => {
			if (!visitedSegments.has(segIndex)) traverse(pointKey, segIndex);
		});
	});

	return newWires.map((pathSegments) => ({ ...wireData, line: pathSegments }));
}

function countPoints(mergedLines: number[][]): Record<string, number> {
	const counts: Record<string, number> = {};
	mergedLines.forEach(([x1, y1, x2, y2]) => {
		const p1 = `${x1},${y1}`;
		const p2 = `${x2},${y2}`;
		counts[p1] = (counts[p1] || 0) + 1;
		counts[p2] = (counts[p2] || 0) + 1;
	});
	return counts;
}

async function removeWiresFromComponentToFirstJunction(componentPins: ISCH_PrimitiveComponentPin[], allWires: EasyEDAWire[]) {
	const rmIndxs: number[] = [];

	for (const pin of componentPins) {
		const pinX = pin.getState_X();
		const pinY = pin.getState_Y();

		const wireIndex = allWires.findIndex((wire) =>
			wire.line.some((segment) => (segment[0] === pinX && segment[1] === pinY) || (segment[2] === pinX && segment[3] === pinY)),
		);

		if (wireIndex === -1) continue;

		const wireWithPin = allWires[wireIndex];
		const newAllWires = allWires.filter((w, i) => i !== wireIndex && w.primitiveId === wireWithPin.primitiveId);

		const mergedLines: number[][] = [];
		for (const wire of newAllWires) mergedLines.push(...wire.line);

		rmIndxs.push(wireIndex);

		if (newAllWires.length > 0 && mergedLines.length > 0) {
			if (!Object.values(countPoints(mergedLines)).find((x) => x >= 4)) {
				await eda.sch_PrimitiveWire.modify(wireWithPin.primitiveId, { line: mergedLines });
				await new Promise<void>((resolve) => setTimeout(resolve, 100));
				await eda.sch_PrimitiveWire.modify(wireWithPin.primitiveId, { net: wireWithPin.net });
			} else {
				await eda.sch_PrimitiveWire.delete(wireWithPin.primitiveId);
				await new Promise<void>((resolve) => setTimeout(resolve, 100));

				for (const line of mergedLines) {
					const wire = await eda.sch_PrimitiveWire.create(line, wireWithPin.net);
					await wire?.done().catch(() => undefined);
				}

				await new Promise<void>((resolve) => setTimeout(resolve, 100));
				return { end: false, allWires, rmIsDirect: false };
			}
		} else {
			await eda.sch_PrimitiveWire.delete(wireWithPin.primitiveId);
			await new Promise<void>((resolve) => setTimeout(resolve, 100));
			return { end: false, allWires, rmIsDirect: true, wireWithPin, pin };
		}
	}

	allWires.filter((_, index) => !rmIndxs.includes(index));
	return { end: true, allWires, rmIsDirect: false };
}

export async function getShortSymPos(primitive: string | ISCH_PrimitiveComponent | ISCH_PrimitiveComponent$1) {
	let pinX;
	let pinY;
	let primitiveId: string | undefined;
	let shortSymbol: ISCH_PrimitiveComponent | ISCH_PrimitiveComponent$1 | undefined;

	if (typeof primitive === 'string') primitiveId = primitive;
	else shortSymbol = primitive;

	try {
		if (!primitiveId) throw new Error('Not prim id');

		const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId).catch(() => undefined);
		if (pins?.length !== 1) return undefined;

		pinX = pins[0].getState_X();
		pinY = pins[0].getState_Y();
	} catch (error) {
		if (!shortSymbol && primitiveId) shortSymbol = await getPrimitiveById(primitiveId).catch(() => undefined);
		if (!shortSymbol) return undefined;

		pinX = shortSymbol.getState_X();
		pinY = -shortSymbol.getState_Y();
	}

	return { pinX, pinY };
}

async function rmUnunsedShortSym(allWires: EasyEDAWire[], net: string) {
	const shortSymbolsIds = [
		// @ts-ignore
		...(await eda.sch_PrimitiveComponent.getAllPrimitiveId(ESCH_PrimitiveComponentType.NET_FLAG).catch(() => [])),
		// @ts-ignore
		...(await eda.sch_PrimitiveComponent.getAllPrimitiveId(ESCH_PrimitiveComponentType.NET_PORT).catch(() => [])),
	];

	const shortSymbols = await getPrimitiveById(shortSymbolsIds).catch(() => []);

	for (let idx = 0; idx < shortSymbolsIds.length; idx++) {
		if (shortSymbols[idx].getState_Net() !== net && shortSymbols[idx].getState_OtherProperty()?.['Global Net Name'] !== net) continue;

		const pos = await getShortSymPos(shortSymbolsIds[idx]);
		if (!pos) continue;

		const wireIndex = allWires.findIndex((wire) =>
			wire.line.some((segment) => (segment[0] === pos.pinX && segment[1] === pos.pinY) || (segment[2] === pos.pinX && segment[3] === pos.pinY)),
		);

		if (wireIndex === -1) await eda.sch_PrimitiveComponent.delete(shortSymbolsIds[idx]).catch(() => undefined);
	}
}

const getAllPinsPos = async () =>
	(await getAllPrimitivePins().catch(() => []))
		.map((item) => item.pins.map((p) => ({ x: p.getState_X(), y: p.getState_Y(), primitiveId: item.primitiveId, pin: p })))
		.flat();

type AllPinPos = Awaited<ReturnType<typeof getAllPinsPos>>;

async function processRmWire(pins: ISCH_PrimitiveComponentPin[], net: string, allPinsPos: AllPinPos, designator: string) {
	let allWires;
	let end = false;
	const addedNet: AddedNet[] = [];

	do {
		const wire = await eda.sch_PrimitiveWire.getAll(net).catch(() => []);
		allWires = wire.flatMap((w) => splitWireAtJunctions(w as unknown as EasyEDAWire, { pins: allPinsPos }));

		const { allWires: allWires__, end: end__, rmIsDirect, wireWithPin, pin: targetPin } = await removeWiresFromComponentToFirstJunction(pins, allWires);

		end = end__;
		allWires = allWires__;

		if (rmIsDirect && wireWithPin) {
			const pinNumber = targetPin.getState_PinNumber();
			const trgX = targetPin.getState_X();
			const trgY = targetPin.getState_Y();

			const antagonistPin = allPinsPos.find(
				(p) =>
					!(p.x === trgX && p.y === trgY) &&
					wireWithPin.line.some((segment) => (segment[0] === p.x && segment[1] === p.y) || (segment[2] === p.x && segment[3] === p.y)),
			);

			if (antagonistPin) {
				const primitive = await getPrimitiveById(antagonistPin.primitiveId).catch(() => undefined);
				const adesignator = primitive?.getState_Designator?.();

				if (primitive && adesignator && primitive.getState_ComponentType() === ESCH_PrimitiveComponentType.COMPONENT) {
					addedNet.push({
						designator: adesignator,
						net,
						pin_number: antagonistPin.pin.getState_PinNumber(),
						pin_name: antagonistPin.pin.getState_PinName(),
					});
				}
			}
		}
	} while (!end);

	await rmUnunsedShortSym(allWires, net).catch(() => undefined);

	return addedNet;
}

export async function rmWireFromComponentPin(designator: string, pinNumber: string | number, net: string) {
	const pin = await findPin(designator, { num: pinNumber }, {});
	if (!pin) throw new Error('Component not found ' + designator);

	const allPinsPos = await getAllPinsPos();
	return await processRmWire([pin.pin], net, allPinsPos, designator);
}

export async function removeComponent(designator: string, circuit?: ExplainCircuit) {
	designator = rmPartFromDesignator(designator);
	const component = await searchComponentInSCH(designator);
	if (!component) throw new Error('Component not found ' + designator);

	const primitiveIds = component.map((c) => c.primitiveId);
	if (!circuit) circuit = await getSchematic(primitiveIds);
	const pins = (await Promise.all(component.map((component) => getPrimitiveComponentPins(component.primitiveId)))).flat();

	const allPinsPos = await getAllPinsPos();
	await eda.sch_PrimitiveComponent.delete(primitiveIds).catch(() => undefined);

	const componentCircuit = circuit.components.find((c) => c.designator === designator);
	if (!componentCircuit) throw new Error(`Not found component in sch ${designator}`);

	const addedNet: AddedNet[] = [];

	for (const pin of componentCircuit.pins) {
		const net = pin.signal_name;
		if (!net) continue;
		addedNet.push(...(await processRmWire(pins, net, allPinsPos, componentCircuit.designator)));
	}

	return addedNet;
}

import { placeComponent } from './place-component';
import { getShortSymPos, isPointOnSegment, rmWireFromComponentPin } from './rm-compoment-with-connections';
import { findPin, hasDirectWire } from './search';
import { AddedNet, PlacedComponents, RmNet, shortSymbolsMap } from './types';
import { withTimeout } from './utils';

const range = (start: number, stop: number, step: number) =>
	Array.from({ length: (stop - start) / step + 1 }, (_, i) => start + i * step);

const trialLengths = [20, 30, ...range(40, 800, 20), 15, 10, 5];
const trialPortOffsetLengths = range(10, 800, 10);

const directions = [
	{ dx: 1, dy: 0, port_offset_y: -1 },
	{ dx: 0, dy: -1, port_offset_y: 0 },
	{ dx: -1, dy: 0, port_offset_y: -1 },
	{ dx: 0, dy: 1, port_offset_y: 0 },
];

const selectPortForNet = (net: string) => {
	const name = Object.keys(shortSymbolsMap).find((t) => shortSymbolsMap[t as keyof typeof shortSymbolsMap].is(net));
	if (!name) return shortSymbolsMap['NETPORT'].data;
	else return shortSymbolsMap[name as keyof typeof shortSymbolsMap].data;
};

async function groupAndSortNetsByDesignator(nets: AddedNet[], _placeComponents: PlacedComponents) {
	const grouped = new Map<string, AddedNet[]>();

	for (const net of nets) {
		const group = grouped.get(net.designator) || [];
		group.push(net);
		grouped.set(net.designator, group);
	}

	const result: AddedNet[][] = [];
	for (const group of grouped.values()) {
		const sorted = group.toSorted((a, b) => {
			const aNum = typeof a.pin_number === 'number' ? a.pin_number : parseInt(a.pin_number, 10) || 0;
			const bNum = typeof b.pin_number === 'number' ? b.pin_number : parseInt(b.pin_number, 10) || 0;
			return aNum - bNum;
		});
		result.push(sorted);
	}

	return result;
}

const checkNeedMakePort = async (
	simComps: (ISCH_PrimitiveComponent | ISCH_PrimitiveComponent$1)[],
	pin: ISCH_PrimitiveComponentPin,
	net: string,
) => {
	if (simComps.length) {
		const shortSymsPos = await Promise.all(simComps.map((simComp) => getShortSymPos(simComp))).catch(() => undefined);

		if (shortSymsPos) {
			for (const pos of shortSymsPos) {
				if (!pos) continue;
				const hasDirect = await hasDirectWire(net, { x: pin.getState_X(), y: pin.getState_Y() }, { x: pos.pinX, y: pos.pinY }).catch(() => null);
				if (hasDirect === true) return false;
			}
		}
	}

	return true;
};

async function place(group: AddedNet[], myIndex: number, placeComponents: PlacedComponents, makePort: boolean) {
	const net: AddedNet = group[myIndex];
	const allWires = await eda.sch_PrimitiveWire.getAll().catch(() => [] as ISCH_PrimitiveWire[]);

	const pin = await findPin(net.designator, { num: net.pin_number, name: net.pin_name }, placeComponents);
	if (!pin) {
		eda.sys_Log.add(`Not found pin in placenet: ${net.designator} ${net.pin_number}`);
		return;
	}

	if (myIndex > 0 && pin.pins[0]?.length) {
		const eqNet = group.slice(0, myIndex).filter((n) => n.net === net.net && n.designator === net.designator);
		const notEqNet = group.filter((n) => n.net !== net.net && n.designator === net.designator);

		const pinsInEqNet = pin.pins[0].filter((p) => eqNet.some((n) => n.pin_number === p.getState_PinNumber()));
		const pinsNotInEqNet = pin.pins[0].filter((p) => notEqNet.some((n) => n.pin_number === p.getState_PinNumber()));

		for (const prevNet of eqNet) {
			const prevPin = pinsInEqNet.find((p) => p.getState_PinNumber() === prevNet.pin_number);
			if (!prevPin) continue;

			const myPinX = pin.pin.getState_X();
			const myPinY = pin.pin.getState_Y();
			const prevPinX = prevPin.getState_X();
			const prevPinY = prevPin.getState_Y();
			if (prevPinX !== myPinX && prevPinY !== myPinY) continue;
			if (prevPin.getState_Rotation() !== pin.pin.getState_Rotation()) continue;

			const hasOtherPointOnLine = pinsNotInEqNet.some((p) =>
				isPointOnSegment(
					{ x: p.getState_X(), y: p.getState_Y() },
					{ start: { x: myPinX, y: myPinY }, end: { x: prevPinX, y: prevPinY }, originalIndex: -1 },
				),
			);

			if (hasOtherPointOnLine) continue;

			const line = [myPinX, myPinY, prevPinX, prevPinY];

			try {
				const wire = await eda.sch_PrimitiveWire.create(line, net.net);
				if (wire) return;
			} catch (err) {
				eda.sys_Log.add(`Failed create merge wire ${net.designator} ${net.net}`);
			}
		}
	}

	let makePortForThis = makePort;
	let simComps: (ISCH_PrimitiveComponent | ISCH_PrimitiveComponent$1)[] | undefined;

	if (makePortForThis) {
		simComps = (await withTimeout(eda.sch_PrimitiveComponent.getAll(), 1500).catch(() => [])).filter(
			(c) =>
				c.getState_Net() === net.net ||
				(c.getState_OtherProperty()?.['Global Net Name'] === net.net &&
					(c.getState_ComponentType() === ESCH_PrimitiveComponentType.NET_FLAG ||
						c.getState_ComponentType() === ESCH_PrimitiveComponentType.NET_PORT)),
		);

		if (simComps.length) {
			if (!(await checkNeedMakePort(simComps, pin.pin, net.net))) makePortForThis = false;
		}
	}

	if (makePort && !makePortForThis) {
		eda.sys_Log.add(`Signal exists: ${JSON.stringify(net)}`);
		return;
	}

	const pinCount = pin.pins?.[0]?.length ?? 10;

	const pinX = pin.pin.getState_X();
	const pinY = pin.pin.getState_Y();
	const rot = pin.pin.getState_Rotation();

	const allComponentPins = pin.pins?.[0] ?? [];

	const hasCollisionForPort = (checkX: number, checkY: number) => {
		return (
			allComponentPins.some((p) => p.getState_Y() === checkY && p.getState_PinNumber() != net.pin_number && p.getState_Rotation() === rot) ||
			allWires.some((w) => {
				const lineRaw = w.getState_Line();
				const line = (Array.isArray(lineRaw[0]) ? lineRaw : [lineRaw]) as number[][];
				return line.some((segment) =>
					isPointOnSegment({ x: checkX, y: checkY }, { originalIndex: -1, start: { x: segment[0], y: segment[1] }, end: { x: segment[2], y: segment[3] } }),
				);
			})
		);
	};

	let primaryDirIndex = 0;
	if (rot >= 270) primaryDirIndex = 3;
	else if (rot >= 180) primaryDirIndex = 2;
	else if (rot >= 90) primaryDirIndex = 1;
	else primaryDirIndex = 0;

	let directionsToTry: number[] = [];

	if (pinCount >= 3) {
		directionsToTry = [primaryDirIndex];
	} else {
		const forbiddenDirIndex = (primaryDirIndex + 2) % 4;
		for (let i = 0; i < 4; i++) {
			if (i !== forbiddenDirIndex) directionsToTry.push(i);
		}
		directionsToTry.sort((a, b) => {
			if (a === primaryDirIndex) return -1;
			if (b === primaryDirIndex) return 1;
			return 0;
		});
	}

	let wire;
	let endX;
	let endY;
	let endYPort;
	let dir;

	for (const dirIndex of directionsToTry) {
		if (wire) break;
		dir = directions[dirIndex];

		const portMakeVariants = makePortForThis ? [makePortForThis, !makePortForThis] : [false];

		for (const makePortForThis__ of portMakeVariants) {
			if (wire) break;
			makePortForThis = makePortForThis__;

			for (const wireLength of trialLengths) {
				if (wire) break;

				let portOffsets = makePortForThis__ ? trialPortOffsetLengths : [0];
				if (dir.port_offset_y === 0) portOffsets = [0];

				for (const portOffsetLen of portOffsets) {
					if (wire) break;

					endX = pinX + dir.dx * wireLength;
					endY = pinY + dir.dy * wireLength;
					endYPort = endY + dir.port_offset_y * portOffsetLen;

					if (hasCollisionForPort(endX, endYPort)) continue;

					try {
						wire = await eda.sch_PrimitiveWire.create([pinX, pinY, endX, endY, endX, endYPort], net.net);
						if (wire) break;
					} catch (err) {
						// pass
					}
				}
			}
		}
	}

	if (simComps?.length) {
		if (!(await checkNeedMakePort(simComps, pin.pin, net.net))) makePortForThis = false;
	}

	if (wire && makePortForThis && endX && endYPort && dir) {
		const portData = selectPortForNet(net.net);
		let rotation = dir.dy === 1 ? 180 : 0;
		if (portData.rotateToIdle === -1) rotation += 180;

		const comp = await placeComponent(portData, { x: endX, y: -endYPort, rotate: rotation }).catch(() => undefined);

		if (comp) {
			comp.setState_Name(net.net);
			comp.setState_OtherProperty({ 'Global Net Name': net.net });
			await comp.done();

			setTimeout(() => {
				wire.done();
			}, 100);
		}
	}

	if (!wire) {
		const msg = `Wire creation failed: "${net.net}" at ${net.designator} ${net.pin_number}`;
		eda.sys_Message.showToastMessage(msg, ESYS_ToastMessageType.ERROR);
		eda.sys_Log.add(msg);
	}
}

export async function placeNet(nets: AddedNet[], placeComponents: PlacedComponents, makePort: boolean) {
	const groups = await groupAndSortNetsByDesignator(nets, placeComponents);

	for (const group of groups) {
		for (let index = 0; index < group.length; index++) {
			await place(group, index, placeComponents, makePort ? group.length < 8 : makePort);
		}
	}
}

export async function rmNet(nets: RmNet[], _placeComponents: PlacedComponents) {
	const addedNets = [];

	for (const net of nets) {
		const addedNet = await rmWireFromComponentPin(net.designator, net.pin_number, net.net).catch(() => {
			const msg = `Failed rm net from: ${net.designator} ${net.pin_number}`;
			eda.sys_Log.add(msg);
			return [];
		});

		addedNets.push(addedNet);
	}

	return addedNets.flat();
}

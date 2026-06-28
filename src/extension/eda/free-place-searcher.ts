import { getBBox, to2 } from './utils';

interface Offset {
	x: number | undefined;
	y: number | undefined;
}

export async function searchFreePlaceV2(
	targetPoint: { x: number; y: number },
	tagetSize: { w: number; h: number },
	ignoreDisgnators?: string[],
): Promise<Offset> {
	let componentsOnSch = (await eda.sch_PrimitiveComponent.getAll().catch(() => [])).filter(
		(c) =>
			c.getState_ComponentType() === ESCH_PrimitiveComponentType.COMPONENT ||
			c.getState_ComponentType() === ESCH_PrimitiveComponentType.NET_PORT ||
			c.getState_ComponentType() === ESCH_PrimitiveComponentType.NET_FLAG,
	);

	if (ignoreDisgnators?.length)
		componentsOnSch = componentsOnSch.filter((c) => !ignoreDisgnators.includes(c.getState_Designator?.() ?? ''));

	const PADDING = 40;

	const busyRects = await Promise.all(
		componentsOnSch.map(async (comp) => {
			const bbox = await getBBox([comp]).catch(() => undefined);
			if (!bbox) return { x: comp.getState_X() - 50, y: comp.getState_Y() - 50, w: 100, h: 100 };

			return { x: bbox.minX - PADDING, y: -bbox.minY + PADDING, w: bbox.width + PADDING * 2, h: bbox.height + PADDING * 2 };
		}),
	);

	const wires = await eda.sch_PrimitiveWire.getAll().catch(() => []);

	for (const wire of wires) {
		const line_ = wire.getState_Line();
		const line = (Array.isArray(line_[0]) ? line_ : [line_]) as number[][];

		for (const segment of line) {
			if (segment.length !== 4) continue;
			const rect = {
				h: Math.abs(-segment[1] - -segment[3]) + PADDING * 2,
				w: Math.abs(segment[0] - segment[2]) + PADDING * 2,
				y: Math.max(-segment[1], -segment[3]) + PADDING,
				x: Math.min(segment[0], segment[2]) - PADDING,
			};
			busyRects.push(rect);
		}
	}

	const STEP = 80;

	function isOverlap(
		rect1: { x: number; y: number; w: number; h: number },
		rect2: { x: number; y: number; w: number; h: number },
	): boolean {
		return rect2.x < rect1.x + rect1.w && rect2.x + rect2.w > rect1.x && rect2.y > rect1.y - rect1.h && rect2.y - rect2.h < rect1.y;
	}

	function isFree(cx: number, cy: number): boolean {
		const targetRect = { x: cx, y: cy, w: tagetSize.w, h: tagetSize.h };
		return !busyRects.some((rect) => isOverlap(targetRect, rect));
	}

	if (isFree(targetPoint.x, targetPoint.y)) return { x: to2(targetPoint.x), y: to2(targetPoint.y) };

	const MAX_RADIUS = 10000;
	for (let radius = STEP; radius <= MAX_RADIUS; radius += STEP) {
		for (let dx = -radius; dx <= radius; dx += STEP) {
			for (let dy = -radius; dy <= radius; dy += STEP) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
				const candidateX = targetPoint.x + dx;
				const candidateY = targetPoint.y + dy;
				if (isFree(candidateX, candidateY)) return { x: to2(candidateX), y: to2(candidateY) };
			}
		}
	}

	throw new Error('Sch is full, no free place found');
}

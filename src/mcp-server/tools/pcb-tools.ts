import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketBridge } from '../bridge';

function text(result: unknown) {
	// JSON.stringify(undefined) is undefined, which fails MCP result validation; report it as null instead.
	const body = typeof result === 'string' ? result : (JSON.stringify(result, null, 2) ?? 'null');
	return { content: [{ type: 'text' as const, text: body }] };
}

/** EasyEDA layer IDs (EPCB_LayerId). The API needs the number; names are accepted for convenience. */
const LAYER_IDS: Record<string, number> = {
	top: 1,
	toplayer: 1,
	bottom: 2,
	bottomlayer: 2,
	topsilkscreen: 3,
	bottomsilkscreen: 4,
	boardoutline: 11,
	outline: 11,
	multi: 12,
	multilayer: 12,
	document: 13,
	mechanical: 14,
	inner1: 15,
	inner2: 16,
	inner3: 17,
	inner4: 18,
};

const layerSchema = z
	.union([z.number().int(), z.string()])
	.describe('Layer ID (1=Top, 2=Bottom, 15..=Inner1.., 11=Board Outline) or name, e.g. "Top", "Bottom", "Inner1"');

function resolveLayer(layer: number | string | undefined): number | undefined {
	if (layer === undefined || typeof layer === 'number') return layer;
	const trimmed = layer.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const id = LAYER_IDS[trimmed.toLowerCase().replace(/[\s_-]/g, '')];
	if (id === undefined) throw new Error(`Unknown PCB layer "${layer}". Use a layer ID or one of: ${Object.keys(LAYER_IDS).join(', ')}`);
	return id;
}

type Polygon = Array<string | number>;

/** Rectangle as a closed polygon source array: [x1, y1, 'L', x2, y1, x2, y2, x1, y2, x1, y1]. */
function rectPolygon(x: number, y: number, width: number, height: number): Polygon {
	return [x, y, 'L', x + width, y, x + width, y + height, x, y + height, x, y];
}

const DELETE_MAP: Record<string, string> = {
	component: 'pcb.delete.component',
	track: 'pcb.delete.line',
	polyline: 'pcb.delete.polyline',
	via: 'pcb.delete.via',
	pad: 'pcb.delete.pad',
	pour: 'pcb.delete.pour',
	fill: 'pcb.delete.fill',
	arc: 'pcb.delete.arc',
	region: 'pcb.delete.region',
};

export function registerPcbTools(server: McpServer, bridge: WebSocketBridge): void {
	// ===== Read =====
	server.tool(
		'pcb_get_all_components',
		'Get all PCB components, optionally filtered by layer.',
		{ layer: layerSchema.optional() },
		async ({ layer }) => text(await bridge.send('pcb.getAll.component', { layer: resolveLayer(layer) })),
	);

	server.tool(
		'pcb_get_component_pins',
		'Get all pads/pins of a PCB component by primitive ID.',
		{ primitiveId: z.string() },
		async ({ primitiveId }) => text(await bridge.send('pcb.component.getPins', { primitiveId })),
	);

	server.tool('pcb_get_all_nets', 'Get all net names on the PCB.', {}, async () => text(await bridge.send('pcb.net.getAllNames')));

	server.tool(
		'pcb_get_net_length',
		'Get total routed length of a net.',
		{ net: z.string() },
		async ({ net }) => text(await bridge.send('pcb.net.getLength', { net })),
	);

	server.tool('pcb_get_all_layers', 'Get all PCB layers and their properties.', {}, async () =>
		text(await bridge.send('pcb.layer.getAll')),
	);

	server.tool('pcb_get_selected', 'Get all currently selected PCB primitives.', {}, async () =>
		text(await bridge.send('pcb.select.getAll')),
	);

	// ===== Create =====
	server.tool(
		'pcb_create_track',
		'Create a single track segment between two points on a layer/net.',
		{
			net: z.string(),
			layer: layerSchema,
			startX: z.number(),
			startY: z.number(),
			endX: z.number(),
			endY: z.number(),
			lineWidth: z.number().optional(),
		},
		async (params) => text(await bridge.send('pcb.create.line', { ...params, layer: resolveLayer(params.layer) })),
	);

	server.tool(
		'pcb_create_via',
		'Create a via at a position.',
		{
			net: z.string(),
			x: z.number(),
			y: z.number(),
			holeDiameter: z.number(),
			diameter: z.number(),
			viaType: z.string().optional(),
		},
		async (params) => text(await bridge.send('pcb.create.via', params)),
	);

	server.tool(
		'pcb_create_pour',
		'Create a copper pour region on a layer/net (e.g. a GND plane on Inner1). The pour is only an outline until ' +
			'its copper is rebuilt: call pcb_rebuild_pours afterwards (and after moving parts or routing).',
		{
			net: z.string(),
			layer: layerSchema,
			polygon: z
				.array(z.union([z.string(), z.number()]))
				.describe('Closed polygon source array: [x1, y1, "L", x2, y2, x3, y3, ..., x1, y1] (units: mil)'),
			pourFillMethod: z.enum(['solid', '45grid', '90grid']).optional(),
			preserveSilos: z.boolean().optional(),
			pourName: z.string().optional(),
			pourPriority: z.number().optional(),
			lineWidth: z.number().optional(),
		},
		async (params) => text(await bridge.send('pcb.create.pour', { ...params, layer: resolveLayer(params.layer) })),
	);

	server.tool(
		'pcb_rebuild_pours',
		'Rebuild (refill) the copper of every pour on the PCB, like Shift+B in EasyEDA. Returns per-pour results.',
		{},
		async () => text(await bridge.send('pcb.pour.rebuildAll')),
	);

	server.tool(
		'pcb_create_board_outline',
		'Create the PCB board outline on the Board Outline layer (11). Give either a rectangle (x, y, width, height) ' +
			'or a closed polygon source array. Units: mil.',
		{
			x: z.number().optional().describe('Rectangle left X'),
			y: z.number().optional().describe('Rectangle bottom Y'),
			width: z.number().positive().optional(),
			height: z.number().positive().optional(),
			polygon: z
				.array(z.union([z.string(), z.number()]))
				.optional()
				.describe('Closed polygon source array: [x1, y1, "L", x2, y2, ..., x1, y1]; overrides the rectangle'),
			lineWidth: z.number().optional().describe('Outline line width (default 6 mil)'),
		},
		async ({ x, y, width, height, polygon, lineWidth }) => {
			let shape = polygon;
			if (!shape) {
				if (x === undefined || y === undefined || width === undefined || height === undefined) {
					throw new Error('Provide either polygon, or all of x, y, width, height');
				}
				shape = rectPolygon(x, y, width, height);
			}
			return text(
				await bridge.send('pcb.create.polyline', { net: '', layer: LAYER_IDS.boardoutline, polygon: shape, lineWidth: lineWidth ?? 6 }),
			);
		},
	);

	// ===== Modify / Move =====
	server.tool(
		'pcb_move_component',
		'Move/rotate a PCB component, optionally flip layer, set lock or designator.',
		{
			primitiveId: z.string(),
			x: z.number().optional(),
			y: z.number().optional(),
			rotation: z.number().optional(),
			layer: layerSchema.optional().describe('1/"Top" or 2/"Bottom" to flip the component'),
			primitiveLock: z.boolean().optional(),
			designator: z.string().optional(),
		},
		async ({ primitiveId, layer, ...rest }) => {
			const property = layer === undefined ? rest : { ...rest, layer: resolveLayer(layer) };
			return text(await bridge.send('pcb.modify.component', { primitiveId, property }));
		},
	);

	// ===== Delete =====
	server.tool(
		'pcb_delete_primitives',
		'Delete one or more PCB primitives by type and IDs.',
		{
			type: z.enum(['component', 'track', 'polyline', 'via', 'pad', 'pour', 'fill', 'arc', 'region']),
			ids: z.union([z.string(), z.array(z.string())]),
		},
		async ({ type, ids }) => text(await bridge.send(DELETE_MAP[type], { ids })),
	);

	// ===== DRC =====
	server.tool(
		'pcb_run_drc',
		'Run Design Rule Check on the PCB.',
		{ strict: z.boolean().optional(), ui: z.boolean().optional(), verbose: z.boolean().optional() },
		async (params) => text(await bridge.send('pcb.drc.check', params)),
	);

	// ===== Layers =====
	server.tool(
		'pcb_set_copper_layers',
		'Set the number of copper layers (e.g. 2, 4, 6).',
		{ count: z.number().int().min(1) },
		async ({ count }) => text(await bridge.send('pcb.layer.setCopperCount', { count })),
	);

	// ===== Net actions =====
	server.tool(
		'pcb_highlight_net',
		'Highlight a net on the PCB.',
		{ net: z.string() },
		async ({ net }) => text(await bridge.send('pcb.net.highlight', { net })),
	);

	// ===== Manufacture =====
	server.tool(
		'pcb_export_gerber',
		'Export Gerber files (returned as base64).',
		{ fileName: z.string().optional() },
		async ({ fileName }) => text(await bridge.send('pcb.manufacture.getGerberFile', { fileName })),
	);

	server.tool(
		'pcb_export_bom',
		'Export BOM file (returned as base64).',
		{ fileName: z.string().optional(), fileType: z.string().optional() },
		async (params) => text(await bridge.send('pcb.manufacture.getBomFile', params)),
	);

	server.tool(
		'pcb_export_pick_place',
		'Export pick-and-place (centroid) file for assembly (returned as base64). Requires a PCB document active.',
		{ fileName: z.string().optional(), fileType: z.string().optional(), unit: z.string().optional() },
		async (params) => text(await bridge.send('pcb.manufacture.getPickAndPlaceFile', params)),
	);

	server.tool(
		'pcb_export_pdf',
		'Export the PCB layout to PDF (returned as base64). Requires a PCB document active.',
		{ fileName: z.string().optional() },
		async ({ fileName }) => text(await bridge.send('pcb.manufacture.getPdfFile', { fileName })),
	);

	server.tool(
		'pcb_export_3d',
		'Export a 3D model file of the PCB (e.g. STEP). Returned as base64. Requires a PCB document active.',
		{
			fileName: z.string().optional(),
			fileType: z.string().optional(),
			element: z.string().optional(),
			modelMode: z.string().optional(),
			autoGenerateModels: z.boolean().optional(),
		},
		async (params) => text(await bridge.send('pcb.manufacture.get3DFile', params)),
	);

	server.tool(
		'pcb_get_board_outline',
		'Get the PCB board outline / dimensions (primitives on the Board Outline layer, bounding box, width, height ' +
			'in mil and mm). Requires a PCB document to be active.',
		{},
		async () => {
			// EasyEDA has no getBoardOutline API: collect polylines, lines and arcs on the Board Outline layer (11).
			const outline = LAYER_IDS.boardoutline;
			const exec = (path: string, args: unknown[]) => bridge.send('eda.exec', { path, args }) as Promise<unknown>;
			const ids = async (path: string) => ((await exec(path, [null, outline])) as string[] | undefined) ?? [];
			const polylineIds = await ids('pcb_PrimitivePolyline.getAllPrimitiveId');
			const lineIds = await ids('pcb_PrimitiveLine.getAllPrimitiveId');
			const arcIds = await ids('pcb_PrimitiveArc.getAllPrimitiveId');
			const all = [...polylineIds, ...lineIds, ...arcIds];
			if (!all.length) {
				return text({ available: false, message: 'No primitives on the Board Outline layer. Create one with pcb_create_board_outline.' });
			}
			const bbox = (await exec('pcb_Primitive.getPrimitivesBBox', [all])) as
				| { minX: number; minY: number; maxX: number; maxY: number }
				| undefined;
			const polylines = polylineIds.length ? await exec('pcb_PrimitivePolyline.get', [polylineIds]) : [];
			const width = bbox ? bbox.maxX - bbox.minX : undefined;
			const height = bbox ? bbox.maxY - bbox.minY : undefined;
			const mm = (mil?: number) => (mil === undefined ? undefined : Math.round(mil * 0.0254 * 100) / 100);
			return text({
				available: true,
				note: 'The bounding box includes the outline line width.',
				bbox,
				width_mil: width,
				height_mil: height,
				width_mm: mm(width),
				height_mm: mm(height),
				primitives: { polylines: polylineIds, lines: lineIds, arcs: arcIds },
				polylines,
			});
		},
	);

	server.tool('pcb_save', 'Save the current PCB document.', { uuid: z.string().optional() }, async ({ uuid }) =>
		text(await bridge.send('pcb.document.save', { uuid })),
	);
}

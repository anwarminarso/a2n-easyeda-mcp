import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketBridge } from '../bridge';

function text(result: unknown) {
	return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
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
		{ layer: z.string().optional() },
		async ({ layer }) => text(await bridge.send('pcb.getAll.component', { layer })),
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
			layer: z.string().describe('e.g. "TopLayer", "BottomLayer"'),
			startX: z.number(),
			startY: z.number(),
			endX: z.number(),
			endY: z.number(),
			lineWidth: z.number().optional(),
		},
		async (params) => text(await bridge.send('pcb.create.line', params)),
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
		'Create a copper pour region on a layer/net.',
		{
			net: z.string(),
			layer: z.string(),
			polygon: z.array(z.union([z.string(), z.number()])).describe('e.g. ["L", x1,y1, x2,y2, ..., x1,y1]'),
			pourFillMethod: z.enum(['solid', '45grid', '90grid']).optional(),
			preserveSilos: z.boolean().optional(),
			pourName: z.string().optional(),
			pourPriority: z.number().optional(),
			lineWidth: z.number().optional(),
		},
		async (params) => text(await bridge.send('pcb.create.pour', params)),
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
			layer: z.string().optional(),
			primitiveLock: z.boolean().optional(),
			designator: z.string().optional(),
		},
		async ({ primitiveId, ...property }) => text(await bridge.send('pcb.modify.component', { primitiveId, property })),
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

	server.tool('pcb_save', 'Save the current PCB document.', { uuid: z.string().optional() }, async ({ uuid }) =>
		text(await bridge.send('pcb.document.save', { uuid })),
	);
}

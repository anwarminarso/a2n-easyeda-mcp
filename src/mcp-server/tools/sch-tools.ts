import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketBridge } from '../bridge';

function text(result: unknown) {
	return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
}

export function registerSchTools(server: McpServer, bridge: WebSocketBridge): void {
	// ===== Read =====
	server.tool(
		'sch_get_all_components',
		'Get all schematic components (parts, net flags, net ports, etc.) with positions, rotation, designators.',
		{
			componentType: z
				.enum(['part', 'sheet', 'netflag', 'netport', 'nonElectrical_symbol', 'short_symbol', 'netlabel'])
				.optional()
				.describe('Optional filter by component type'),
			allSchematicPages: z.boolean().optional().describe('If true, include all pages, not just current'),
		},
		async (params) => text(await bridge.send('sch.component.getAll', params)),
	);

	server.tool(
		'sch_get_component_pins',
		'Get all pins of a schematic component by its primitive ID.',
		{ primitiveId: z.string().describe('Component primitive ID') },
		async ({ primitiveId }) => text(await bridge.send('sch.component.getAllPins', { primitiveId })),
	);

	server.tool(
		'sch_get_all_wires',
		'Get all wires in the schematic, optionally filtered by net name(s).',
		{ net: z.union([z.string(), z.array(z.string())]).optional().describe('Net name(s) filter') },
		async ({ net }) => text(await bridge.send('sch.wire.getAll', { net })),
	);

	server.tool(
		'sch_get_netlist',
		'Get the schematic netlist in the specified format.',
		{ type: z.enum(['Allegro', 'PADS', 'Protel2', 'JLCEDA', 'EasyEDA', 'DISA']).optional() },
		async ({ type }) => text(await bridge.send('sch.netlist.get', { type })),
	);

	server.tool(
		'sch_read_circuit',
		'Read the current schematic as a structured circuit (components + pins + resolved net per pin). Best high-level read.',
		{ allSchematicPages: z.boolean().optional() },
		async (params) => text(await bridge.send('sch.readCircuit', params)),
	);

	server.tool(
		'sch_get_selected',
		'Get all currently selected primitives in the schematic editor.',
		{},
		async () => text(await bridge.send('sch.select.getAll')),
	);

	server.tool(
		'sch_run_drc',
		'Run Design Rule Check (DRC) on the schematic.',
		{ strict: z.boolean().optional(), userInterface: z.boolean().optional() },
		async (params) => text(await bridge.send('sch.drc.check', params)),
	);

	// ===== Component search (mode-aware: online/offline/hybrid) =====
	server.tool(
		'sch_search_component',
		'Search for a component using EasyEDA libraries. In offline mode searches local/system libraries; ' +
			'in online/hybrid mode also queries the EasyEDA backend. Returns device uuid + libraryUuid for placement.',
		{
			query: z.string().describe('Search keyword: MPN, LCSC id (e.g. C25804), value, or description'),
			limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
		},
		async (params) => text(await bridge.send('lib.searchComponent', params)),
	);

	// ===== Write (low-level) =====
	server.tool(
		'sch_place_component',
		'Place a schematic component from a library at a position. Provide device uuid + libraryUuid ' +
			'(from sch_search_component). Use libraryUuid "lcsc" with a device uuid for online placement.',
		{
			uuid: z.string().describe('Device uuid'),
			libraryUuid: z.string().describe('Library uuid (or "lcsc")'),
			x: z.number().describe('X position'),
			y: z.number().describe('Y position'),
			rotation: z.number().optional(),
			mirror: z.boolean().optional(),
			designator: z.string().optional().describe('Override designator (e.g. "R1")'),
			subPartName: z.string().optional(),
			addIntoBom: z.boolean().optional(),
			addIntoPcb: z.boolean().optional(),
		},
		async (params) => text(await bridge.send('sch.component.place', params)),
	);

	server.tool(
		'sch_create_wire',
		'Create a wire on the schematic. "line" is a flat coordinate array [x1,y1,x2,y2,...].',
		{
			line: z.array(z.number()).min(4).describe('Flat coordinate array [x1,y1,x2,y2,...]'),
			net: z.string().optional().describe('Net name'),
		},
		async (params) => text(await bridge.send('sch.wire.create', params)),
	);

	server.tool(
		'sch_create_netflag',
		'Create a net flag (e.g. VCC/GND short symbol) attached to a net at a position.',
		{
			identification: z.string().describe('Symbol identification (e.g. "VCC", "GND")'),
			net: z.string(),
			x: z.number(),
			y: z.number(),
			rotation: z.number().optional(),
			mirror: z.boolean().optional(),
		},
		async (params) => text(await bridge.send('sch.component.createNetFlag', params)),
	);

	server.tool(
		'sch_delete_components',
		'Delete one or more schematic components by primitive ID(s).',
		{ ids: z.union([z.string(), z.array(z.string())]) },
		async ({ ids }) => text(await bridge.send('sch.component.delete', { ids })),
	);

	// ===== High-level local assembly engine (no remote server, no AI) =====
	server.tool(
		'sch_assemble_circuit',
		'High-level: place a list of components and auto-wire them locally by net name. ' +
			'No external server, no AI. Components are placed at free positions; pins sharing a net are wired, ' +
			'and VCC/GND/net-port symbols are auto-inserted. Ideal for generating a schematic from a parts+nets list.',
		{
			components: z
				.array(
					z.object({
						designator: z.string().describe('e.g. "R1", "U1", "J1"'),
						uuid: z.string().describe('Device uuid (from sch_search_component)'),
						libraryUuid: z.string().optional().describe('Library uuid, default "lcsc"'),
						x: z.number().optional().describe('Optional X; if omitted a free spot is found'),
						y: z.number().optional(),
						rotation: z.number().optional(),
						mirror: z.boolean().optional(),
						subPartName: z.string().optional(),
					}),
				)
				.describe('Components to place'),
			nets: z
				.array(
					z.object({
						designator: z.string(),
						pin_number: z.union([z.string(), z.number()]),
						net: z.string().describe('Net/signal name; VCC/GND auto-detected for power symbols'),
						pin_name: z.string().optional(),
					}),
				)
				.describe('Pin-to-net assignments; pins with the same net get connected'),
			saveCheckpoint: z.boolean().optional().describe('Save an undo checkpoint before assembling (default true)'),
		},
		async (params) => text(await bridge.send('sch.assemble', params)),
	);

	// ===== Project / schematic management =====
	server.tool(
		'sch_create_schematic',
		'Create a new schematic in the current project. Returns the first page uuid.',
		{ parentBoardName: z.string().optional() },
		async ({ parentBoardName }) => text(await bridge.send('dmt.schematic.create', { boardName: parentBoardName })),
	);

	server.tool(
		'sch_create_page',
		'Create a new page under an existing schematic.',
		{ schematicUuid: z.string().min(1) },
		async ({ schematicUuid }) => text(await bridge.send('dmt.schematic.createPage', { schematicUuid })),
	);

	server.tool('sch_save', 'Save the current schematic document.', {}, async () => text(await bridge.send('sch.document.save')));

	// ===== Checkpoints (local undo snapshots) =====
	server.tool('sch_checkpoint_save', 'Save a checkpoint of the current document for later restore.', {}, async () =>
		text(await bridge.send('checkpoint.save')),
	);
	server.tool('sch_checkpoint_list', 'List saved checkpoints.', {}, async () => text(await bridge.send('checkpoint.list')));
	server.tool(
		'sch_checkpoint_restore',
		'Restore a checkpoint by id (or the latest if omitted).',
		{ id: z.string().optional() },
		async ({ id }) => text(await bridge.send('checkpoint.restore', { id })),
	);
}

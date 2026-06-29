import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketBridge } from '../bridge';

function text(result: unknown) {
	return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
}

export function registerCommonTools(server: McpServer, bridge: WebSocketBridge): void {
	server.tool(
		'eda_status',
		'Get a2n.EasyEDA MCP connection status, the active mode (online/offline/hybrid), and current project info.',
		{},
		async () => {
			const config = await bridge.send('a2n.config.get');
			const project = await bridge.send('dmt.project.getInfo').catch(() => null);
			return text({ connected: true, config, project });
		},
	);

	server.tool(
		'eda_set_mode',
		'Set the component sourcing mode. "offline" = local/system libraries only. "online" = EasyEDA backend search. "hybrid" = local first then online.',
		{
			mode: z.enum(['online', 'offline', 'hybrid']).describe('Sourcing mode'),
		},
		async ({ mode }) => text(await bridge.send('a2n.config.set', { mode })),
	);

	server.tool(
		'eda_get_project_info',
		'Read the current EasyEDA project tree (boards, schematics, pages with UUIDs) and metadata.',
		{},
		async () => text(await bridge.send('dmt.project.getInfo')),
	);

	server.tool(
		'eda_open_document',
		'Open a document (schematic, schematic page, PCB) by its UUID from the project tree.',
		{ documentUuid: z.string().min(1).describe('Document UUID from eda_get_project_info') },
		async ({ documentUuid }) => text(await bridge.send('dmt.editor.openDocument', { documentUuid })),
	);

	// Generic escape hatch: call any registered extension handler directly.
	server.tool(
		'eda_call',
		'Advanced: call any low-level EasyEDA handler method directly by name with a params object. ' +
			'Use when no dedicated tool exists. Method names follow the "domain.action.target" convention ' +
			'(e.g. "pcb.create.via", "sch.wire.create", "lib.device.search").',
		{
			method: z.string().min(1).describe('Handler method name'),
			params: z.record(z.any()).optional().describe('Parameters object for the handler'),
		},
		async ({ method, params }) => text(await bridge.send(method, params ?? {})),
	);

	server.tool(
		'eda_exec',
		'Dev/advanced: invoke ANY eda.* API by dotted path without changing the extension. ' +
			'e.g. path="sch_ManufactureData.getExportDocumentFile", args=["sch","PNG",{},"Current Schematic Page"]. ' +
			'New capabilities can be prototyped Node-side only (no extension reinstall). ' +
			'File results return as base64; image files are shown directly.',
		{
			path: z.string().min(1).describe('Dotted eda.* path, e.g. "sch_PrimitiveWire.getAll"'),
			args: z.array(z.any()).optional().describe('Positional arguments array'),
		},
		async ({ path, args }) => {
			const result = (await bridge.send('eda.exec', { path, args })) as any;
			if (result && result.__file && typeof result.mimeType === 'string' && result.mimeType.startsWith('image/')) {
				return { content: [{ type: 'image' as const, data: result.data, mimeType: result.mimeType }] };
			}
			return text(result);
		},
	);

	server.tool(
		'eda_guide',
		'Read this FIRST. Conventions and recommended workflow for driving EasyEDA via this MCP: coordinate system, ' +
			'net-by-name wiring, schematic vs PCB context, and the place -> wire -> verify loop.',
		{},
		async () => text(EDA_GUIDE),
	);
}

const EDA_GUIDE = `# a2n.EasyEDA MCP — Agent Guide

## Document context (IMPORTANT)
- Schematic tools (sch_*) require a SCHEMATIC PAGE to be the active document.
- PCB tools (pcb_*) require a PCB to be active.
- Switch documents with eda_open_document using a UUID from eda_get_project_info.
- A PCB op while a schematic is active (or vice versa) will error.

## Coordinate system
- sch_place_component(x, y): placement coordinate. +Y is UP on screen, +X is right. Grid step = 10.
- sch_get_component_pins returns each pin's CANVAS coordinates, where pin Y is NEGATIVE
  (canvas space). Use those pin coordinates DIRECTLY as wire endpoints.
- So: place with positive y; wire using the pin coordinates returned (negative y). Do not negate.

## Wiring is BY NET NAME (cleanest method)
- Every wire can carry a 'net' property. Pins connected to wires that share the same net NAME
  are logically connected — no physical routing across the sheet is required.
- To connect a pin to a net: create a SHORT stub wire starting exactly at the pin coordinate,
  e.g. sch_create_wire(line=[pinX, pinY, pinX+20, pinY], net="VBAT_RAIL").
- For components with multiple same-node pins (MOSFET S/D arrays), draw one short wire spanning
  those collinear pins with the net name to tie them at once.
- sch_create_netflag only accepts STANDARD power symbols (e.g. VCC, GND) — not arbitrary names.
  For arbitrary nets (SW1, VBUS, ...) use named stub wires.

## Recommended workflow (place -> wire -> verify loop)
1. eda_get_project_info, then eda_open_document for the target schematic page.
2. Place components at deliberately spaced coordinates (account for symbol size; see bbox below).
3. sch_get_component_pins for each placed component to get exact pin coordinates.
4. Create net-named stub wires on each pin (same name = connected).
5. sch_read_circuit to VERIFY every pin resolved to the intended signal_name.
6. sch_export_image to VISUALLY verify layout (overlaps, alignment, off-sheet, title block).
7. Fine-tune positions/rotations, then re-verify. Save sch_checkpoint_save between major steps.

## Layout tips
- Query symbol extent with eda_call method "sch.primitive.getBBox" {primitiveIds:[id]} to avoid overlaps.
- Lay power chains left->right in a row; keep the controller/IC central; group passives by function.
- The sheet has a title block (commonly bottom-right) and border — keep components clear of it.
- Use the 'rotation' argument on sch_place_component for cleaner pin orientation.

## Safety
- sch_checkpoint_save before large edits; sch_checkpoint_restore to revert.

## Extensibility (dev)
- eda_exec invokes any eda.* API by dotted path, so new capabilities can be used without
  rebuilding/reinstalling the extension. Prefer dedicated tools when they exist; use eda_exec
  for prototyping or rarely-used calls.
`;

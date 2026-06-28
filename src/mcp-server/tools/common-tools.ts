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
}

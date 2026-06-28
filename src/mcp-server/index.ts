import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketBridge } from './bridge';
import { registerSchTools } from './tools/sch-tools';
import { registerPcbTools } from './tools/pcb-tools';
import { registerCommonTools } from './tools/common-tools';

// Configurable port: env var or CLI arg `--port=NNNN`. Must match the EasyEDA extension config.
function resolvePort(): number {
	const argPort = process.argv.find((a) => a.startsWith('--port='));
	if (argPort) {
		const n = Number(argPort.split('=')[1]);
		if (Number.isFinite(n) && n > 0) return n;
	}
	const envPort = Number(process.env.A2N_EDA_WS_PORT);
	if (Number.isFinite(envPort) && envPort > 0) return envPort;
	return 8788;
}

const WS_PORT = resolvePort();
const WS_HOST = process.env.A2N_EDA_WS_HOST || '127.0.0.1';

async function main() {
	const bridge = new WebSocketBridge(WS_PORT, WS_HOST);
	await bridge.start();

	const server = new McpServer({
		name: 'a2n-easyeda-mcp',
		version: '1.0.0',
	});

	registerCommonTools(server, bridge);
	registerSchTools(server, bridge);
	registerPcbTools(server, bridge);

	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error('[a2n-mcp] a2n.EasyEDA MCP server started');
	console.error(`[a2n-mcp] Waiting for EasyEDA extension on ws://${WS_HOST}:${WS_PORT}`);

	const shutdown = async () => {
		await bridge.stop();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main().catch((err) => {
	console.error('[a2n-mcp] Fatal error:', err);
	process.exit(1);
});

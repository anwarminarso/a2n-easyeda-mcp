import esbuild from 'esbuild';

// Extension build: IIFE for EDA Pro browser environment
const extensionConfig: esbuild.BuildOptions = {
	entryPoints: { index: './src/extension/index' },
	entryNames: '[name]',
	bundle: true,
	minify: false,
	outdir: './dist/',
	platform: 'browser',
	format: 'iife',
	// EasyEDA's extension loader resolves exported menu functions from this exact
	// global name. Do not change it, or menu items will not invoke anything.
	globalName: 'edaEsbuildExportName',
	treeShaking: true,
	ignoreAnnotations: true,
};

// MCP Server build: CJS for Node.js. Self-contained (deps bundled), with a CLI shebang
// so it can be published to npm and run via `npx a2n-easyeda-mcp`.
const mcpServerConfig: esbuild.BuildOptions = {
	entryPoints: { index: './src/mcp-server/index' },
	entryNames: '[name]',
	bundle: true,
	minify: false,
	outdir: './dist/mcp-server/',
	platform: 'node',
	format: 'cjs',
	treeShaking: true,
	external: [],
	banner: { js: '#!/usr/bin/env node' },
};

(async () => {
	await esbuild.build(extensionConfig);
	console.log('[esbuild] a2n extension built -> dist/index.js');

	await esbuild.build(mcpServerConfig);
	console.log('[esbuild] a2n MCP server built -> dist/mcp-server/index.js');
})();

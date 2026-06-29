type Handler = (params: Record<string, any>) => Promise<any>;

async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(((reader.result as string).split(',')[1]) || '');
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

function isFileLike(v: any): v is File {
	return v && typeof v === 'object' && typeof v.arrayBuffer === 'function' && typeof v.name === 'string';
}

/**
 * Generic reflective executor.
 *
 * Lets the Node side invoke ANY `eda.*` API by dotted path without adding a
 * dedicated handler here. This keeps the extension stable: new MCP capabilities
 * are implemented Node-side only (no extension reinstall needed).
 *
 * Example: { path: "sch_ManufactureData.getExportDocumentFile", args: ["sch", "PNG", {...}, "Current Schematic Page"] }
 *
 * File results are auto-converted to { __file: true, data: <base64>, ... }.
 */
export const execHandlers: Record<string, Handler> = {
	'eda.exec': async (p) => {
		const path = String(p.path || '');
		if (!path) throw new Error('eda.exec: missing "path"');

		const parts = path.split('.');
		let parent: any = null;
		let ctx: any = eda;
		for (const part of parts) {
			if (ctx == null) throw new Error(`eda.exec: cannot resolve "${path}" (null at "${part}")`);
			parent = ctx;
			ctx = ctx[part];
		}

		let result: any;
		if (typeof ctx === 'function') {
			const args = Array.isArray(p.args) ? p.args : [];
			result = await ctx.apply(parent, args);
		} else {
			// Property access (return the value as-is).
			result = ctx;
		}

		if (isFileLike(result)) {
			return {
				__file: true,
				fileName: result.name,
				mimeType: result.type || 'application/octet-stream',
				size: result.size,
				data: await fileToBase64(result),
			};
		}

		return result;
	},
};

type Handler = (params: Record<string, any>) => Promise<any>;

async function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(((reader.result as string).split(',')[1]) || '');
		reader.onerror = () => reject(new Error('Failed to read image data'));
		reader.readAsDataURL(blob);
	});
}

/** Reject if a promise does not settle within `ms`, so a stuck UI call never hangs the bridge. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

export const exportHandlers: Record<string, Handler> = {
	// Capture the current schematic page as a PNG, returned as base64.
	//
	// IMPORTANT: we deliberately do NOT use eda.sch_ManufactureData.getExportDocumentFile().
	// In current EasyEDA Pro builds that API opens an interactive "Export Document" dialog and
	// only resolves after the user clicks Export, so a programmatic call hangs until the bridge
	// times out (~5 min). Instead we fit the sheet and grab the rendered canvas directly, which
	// is non-interactive and fast. Every editor call is also guarded with a short timeout so a
	// stuck UI (e.g. a stray modal dialog) surfaces a fast error instead of hanging the bridge.
	'sch.exportImage': async (p) => {
		// Fail fast when nothing is open — avoids waiting on a non-existent canvas.
		const projectInfo = await eda.dmt_Project.getCurrentProjectInfo();
		if (!projectInfo) {
			throw new Error('No project is open. Open a schematic page before exporting an image.');
		}

		const editor: any = eda.dmt_EditorControl;

		// Fit the whole sheet into the viewport so the capture shows the entire schematic.
		if (p.fit !== false && typeof editor.zoomToAllPrimitives === 'function') {
			try {
				await withTimeout(Promise.resolve(editor.zoomToAllPrimitives(p.tabId)), 15000, 'zoomToAllPrimitives');
			} catch {
				/* best-effort fit; continue with current view */
			}
		}

		if (typeof editor.getCurrentRenderedAreaImage !== 'function') {
			throw new Error('getCurrentRenderedAreaImage is not available in this EasyEDA Pro build.');
		}

		const blob: Blob | undefined = await withTimeout(
			Promise.resolve(editor.getCurrentRenderedAreaImage(p.tabId)),
			20000,
			'getCurrentRenderedAreaImage',
		);
		if (!blob) throw new Error('Capture returned no image. Make sure a schematic page is the active document.');

		const data = await blobToBase64(blob);
		return {
			fileName: `${p.fileName || 'schematic'}.png`,
			mimeType: blob.type || 'image/png',
			size: blob.size,
			data,
		};
	},
};

import * as http from 'http';
import { WebSocket } from 'ws';

/**
 * Capture the FULL schematic sheet of EasyEDA Pro as a PNG, reproducing the built-in
 * "Export -> PNG" (whole A4 sheet, border, title block, every component) WITHOUT the
 * interactive export dialog (which hangs) and without viewport cropping.
 *
 * Implemented with the raw Chrome DevTools Protocol over a WebSocket (the `ws` dep) —
 * no Playwright. We attach to EasyEDA's Electron renderer, locate the schematic frame's
 * JS execution context, and evaluate an in-page routine that:
 *   - clones the schematic SVG (#root) and inlines computed styles (SVG-as-image ignores
 *     external CSS),
 *   - converts the title-block <foreignObject> HTML into native SVG <text>,
 *   - drops the editor grid/background, reframes the viewBox to the full content bbox,
 *   - rasterizes to a white-background PNG with the true export colors.
 *
 * Requires EasyEDA launched with remote debugging + rendering keep-alive flags:
 *   --remote-debugging-port=9222 --disable-renderer-backgrounding
 *   --disable-backgrounding-occluded-windows --disable-background-timer-throttling
 */

export interface CdpCaptureResult {
	data: string; // base64 PNG
	mimeType: string;
	width: number;
	height: number;
	title: string;
}

interface CdpTarget {
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl: string;
}

// Runs INSIDE the schematic frame; returns a PNG data URL of the full sheet.
// Must be fully self-contained (serialized via toString and injected via CDP).
/* eslint-disable */
function renderSheetInFrame(scale: number): Promise<{ dataUrl?: string; w?: number; h?: number; err?: string }> {
	return new Promise((resolve) => {
		const live = document.querySelector('svg#root') as any;
		if (!live) return resolve({ err: 'no svg#root' });
		let bb: any;
		try { bb = live.getBBox(); } catch (e) { return resolve({ err: 'getBBox failed' }); }
		if (!(bb.width > 50)) return resolve({ err: 'empty bbox' });

		const clone = live.cloneNode(true) as any;

		const PROPS = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'color', 'letter-spacing', 'display', 'visibility'];
		const liveEls = live.querySelectorAll('*');
		const cloneEls = clone.querySelectorAll('*');
		const nEls = Math.min(liveEls.length, cloneEls.length);
		for (let i = 0; i < nEls; i++) {
			let cs: any;
			try { cs = getComputedStyle(liveEls[i]); } catch (e) { continue; }
			let s = cloneEls[i].getAttribute('style') || '';
			for (let j = 0; j < PROPS.length; j++) { const v = cs.getPropertyValue(PROPS[j]); if (v) s += ';' + PROPS[j] + ':' + v; }
			cloneEls[i].setAttribute('style', s);
		}

		const SVGNS = 'http://www.w3.org/2000/svg';
		const cloneGroup = clone.querySelector('#display-object-layer') || clone.querySelector('g') || clone;
		const fos = live.querySelectorAll('foreignObject');
		for (let k = 0; k < fos.length; k++) {
			const fo = fos[k];
			const parent = fo.parentNode;
			let inv: any;
			try { inv = parent.getScreenCTM().inverse(); } catch (e) { continue; }
			const toGroup = (cx: number, cy: number) => { const pt = live.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(inv); };
			const els = fo.querySelectorAll('*');
			for (let m = 0; m < els.length; m++) {
				const el = els[m];
				let t = '';
				for (let n = 0; n < el.childNodes.length; n++) { const cn = el.childNodes[n]; if (cn.nodeType === 3) t += cn.nodeValue; }
				t = t.replace(/\s+/g, ' ').trim();
				if (!t) continue;
				const r = el.getBoundingClientRect();
				if (!r.width && !r.height) continue;
				const cs = getComputedStyle(el);
				const fontSize = parseFloat(cs.fontSize) || 12;
				const tl = toGroup(r.left, r.top);
				const br = toGroup(r.right, r.bottom);
				const boxH = Math.abs(br.y - tl.y) || fontSize;
				const txt = document.createElementNS(SVGNS, 'text');
				txt.setAttribute('x', String(tl.x));
				txt.setAttribute('y', String(tl.y + boxH * 0.78));
				txt.setAttribute('style', 'font-family:' + cs.fontFamily + ';font-size:' + fontSize + 'px;font-weight:' + cs.fontWeight + ';fill:' + (cs.color || '#000000') + ';stroke:none;text-anchor:start');
				txt.textContent = t;
				cloneGroup.appendChild(txt);
			}
		}

		const rm = (sel: string) => { const list = clone.querySelectorAll(sel); for (let i = 0; i < list.length; i++) list[i].remove(); };
		rm('image'); rm('foreignObject');
		rm('#canvasBg,[class*="grid"],[class*="Grid"],[id*="grid"],[id*="Grid"]');
		const allc = clone.querySelectorAll('*');
		for (let i = 0; i < allc.length; i++) {
			const el = allc[i];
			const f = el.getAttribute && (el.getAttribute('fill') || '');
			const mk = el.getAttribute && (el.getAttribute('mask') || '');
			if ((f && f.indexOf('shapeFillStyle') !== -1) || (mk && mk.indexOf('shapeFillStyle') !== -1)) el.remove();
		}

		const pad = 20;
		const x = bb.x - pad, y = bb.y - pad, w = Math.ceil(bb.width + pad * 2), h = Math.ceil(bb.height + pad * 2);
		clone.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
		clone.setAttribute('width', String(w));
		clone.setAttribute('height', String(h));
		clone.setAttribute('preserveAspectRatio', 'xMinYMin meet');

		const xml = new XMLSerializer().serializeToString(clone);
		const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(w * scale);
				canvas.height = Math.round(h * scale);
				const ctx = canvas.getContext('2d')!;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
				const dataUrl = canvas.toDataURL('image/png');
				URL.revokeObjectURL(url);
				resolve({ dataUrl, w: canvas.width, h: canvas.height });
			} catch (e: any) {
				URL.revokeObjectURL(url);
				resolve({ err: 'raster: ' + (e && e.message) });
			}
		};
		img.onerror = () => { URL.revokeObjectURL(url); resolve({ err: 'svg image load failed' }); };
		img.src = url;
	});
}
/* eslint-enable */

function httpGetJson(port: number, path: string, timeoutMs: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
			let data = '';
			res.on('data', (c) => (data += c));
			res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid CDP JSON')); } });
		});
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => req.destroy(new Error('CDP HTTP timeout')));
	});
}

interface FrameNode { frame: { id: string; url: string }; childFrames?: FrameNode[] }

class CdpSession {
	private ws: WebSocket;
	private id = 0;
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	private cmdTimeout: number;
	// frameId -> execution contextId (default world)
	readonly contextByFrame = new Map<string, number>();

	constructor(ws: WebSocket, cmdTimeout: number) {
		this.ws = ws;
		this.cmdTimeout = cmdTimeout;
		ws.on('message', (buf: Buffer) => {
			let msg: any;
			try { msg = JSON.parse(buf.toString()); } catch (e) { return; }
			if (msg.id && this.pending.has(msg.id)) {
				const p = this.pending.get(msg.id)!;
				this.pending.delete(msg.id);
				clearTimeout(p.timer);
				if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
				else p.resolve(msg.result);
			} else if (msg.method === 'Runtime.executionContextCreated') {
				const ctx = msg.params && msg.params.context;
				const frameId = ctx && ctx.auxData && ctx.auxData.frameId;
				if (frameId && ctx.auxData.isDefault !== false) this.contextByFrame.set(frameId, ctx.id);
			}
		});
	}

	send<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
		return new Promise((resolve, reject) => {
			const mid = ++this.id;
			const timer = setTimeout(() => { this.pending.delete(mid); reject(new Error('CDP timeout: ' + method)); }, this.cmdTimeout);
			this.pending.set(mid, { resolve, reject, timer });
			this.ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
		});
	}

	close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

function connect(wsUrl: string, cmdTimeout: number): Promise<CdpSession> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
		const t = setTimeout(() => reject(new Error('CDP ws open timeout')), 8000);
		ws.on('open', () => { clearTimeout(t); resolve(new CdpSession(ws, cmdTimeout)); });
		ws.on('error', (e: Error) => { clearTimeout(t); reject(e); });
	});
}

function collectSchFrames(node: FrameNode | undefined, out: string[]): void {
	if (!node) return;
	if (node.frame && /entry=sch/.test(node.frame.url)) out.push(node.frame.id);
	if (node.childFrames) for (const c of node.childFrames) collectSchFrames(c, out);
}

async function captureFromTarget(target: CdpTarget, scale: number): Promise<{ dataUrl: string; w: number; h: number } | null> {
	const sess = await connect(target.webSocketDebuggerUrl, 15000);
	try {
		await sess.send('Page.enable');
		await sess.send('Runtime.enable'); // replays executionContextCreated for existing contexts
		// Give context events a moment to arrive.
		await new Promise((r) => setTimeout(r, 300));

		const tree = (await sess.send<{ frameTree: FrameNode }>('Page.getFrameTree')).frameTree;
		const schFrameIds: string[] = [];
		collectSchFrames(tree, schFrameIds);
		if (!schFrameIds.length) return null;

		const fnSrc = renderSheetInFrame.toString();
		for (const frameId of schFrameIds) {
			const contextId = sess.contextByFrame.get(frameId);
			if (contextId === undefined) continue;
			try {
				const res = await sess.send<{ result?: { value?: any }; exceptionDetails?: unknown }>('Runtime.evaluate', {
					expression: '(' + fnSrc + ')(' + scale + ')',
					contextId,
					awaitPromise: true,
					returnByValue: true,
				});
				if (res.exceptionDetails) continue;
				const val = res.result && res.result.value;
				if (val && val.dataUrl) return { dataUrl: val.dataUrl, w: val.w, h: val.h };
			} catch (e) { /* try next frame */ }
		}
		return null;
	} finally {
		sess.close();
	}
}

export async function captureEditorImage(opts: { port?: number; timeoutMs?: number; scale?: number } = {}): Promise<CdpCaptureResult> {
	const port = opts.port ?? (Number(process.env.A2N_EDA_CDP_PORT) || 9222);
	const scale = opts.scale ?? (Number(process.env.A2N_EDA_CAPTURE_SCALE) || 2);
	const overall = opts.timeoutMs ?? 40000;

	const run = (async (): Promise<CdpCaptureResult> => {
		let list: CdpTarget[];
		try {
			list = ((await httpGetJson(port, '/json/list', 5000)) as CdpTarget[]).filter((t) => t.type === 'page');
		} catch (e) {
			throw new Error(
				'Cannot reach EasyEDA CDP on 127.0.0.1:' + port + '. Launch EasyEDA Pro via run-easyeda-debug.bat ' +
					'or with "--remote-debugging-port=' + port + ' --disable-renderer-backgrounding ' +
					'--disable-backgrounding-occluded-windows --disable-background-timer-throttling". ' +
					'(' + (e instanceof Error ? e.message : String(e)) + ')',
			);
		}
		if (!list.length) throw new Error('No CDP page targets found in EasyEDA Pro.');

		// Prefer the editor page (title/url hints), but fall back to scanning all pages.
		list.sort((a, b) => (/(JLCEDA|VapeAI|editor)/i.test(b.title + b.url) ? 1 : 0) - (/(JLCEDA|VapeAI|editor)/i.test(a.title + a.url) ? 1 : 0));
		let title = list[0]?.title || 'EasyEDA';
		for (const target of list) {
			const shot = await captureFromTarget(target, scale);
			if (shot) return { data: shot.dataUrl.split(',')[1], mimeType: 'image/png', width: shot.w ?? 0, height: shot.h ?? 0, title: target.title || title };
		}
		throw new Error('No active schematic sheet found. Open a schematic page in EasyEDA Pro before exporting.');
	})();

	let timer: ReturnType<typeof setTimeout>;
	const guard = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('Schematic capture timed out after ' + overall + 'ms')), overall);
	});
	try {
		return await Promise.race([run, guard]);
	} finally {
		clearTimeout(timer!);
	}
}

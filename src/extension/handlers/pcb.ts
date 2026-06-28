type Handler = (params: Record<string, any>) => Promise<any>;

async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(((reader.result as string).split(',')[1]) || '');
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

function base64ToFile(base64: string, fileName: string, mimeType = 'application/octet-stream'): File {
	const binaryStr = atob(base64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
	return new File([bytes], fileName, { type: mimeType });
}

async function exportFile(file: File | undefined): Promise<{ fileName: string; data: string; size: number }> {
	if (!file) throw new Error('Failed to export file');
	const data = await fileToBase64(file);
	return { fileName: file.name, data, size: file.size };
}

export const pcbHandlers: Record<string, Handler> = {
	// ===== Component =====
	'pcb.getAll.component': async (p) => eda.pcb_PrimitiveComponent.getAll(p.layer),
	'pcb.get.component': async (p) => eda.pcb_PrimitiveComponent.get(p.primitiveIds),
	'pcb.modify.component': async (p) => eda.pcb_PrimitiveComponent.modify(p.primitiveId, p.property),
	'pcb.delete.component': async (p) => eda.pcb_PrimitiveComponent.delete(p.ids),
	'pcb.component.getPins': async (p) => eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(p.primitiveId),

	// ===== Line / Polyline (tracks) =====
	'pcb.getAll.line': async (p) => eda.pcb_PrimitiveLine.getAll(p.net, p.layer),
	'pcb.get.line': async (p) => eda.pcb_PrimitiveLine.get(p.primitiveIds),
	'pcb.create.line': async (p) => eda.pcb_PrimitiveLine.create(p.net, p.layer, p.startX, p.startY, p.endX, p.endY, p.lineWidth),
	'pcb.modify.line': async (p) => eda.pcb_PrimitiveLine.modify(p.primitiveId, p.property),
	'pcb.delete.line': async (p) => eda.pcb_PrimitiveLine.delete(p.ids),
	'pcb.getAll.polyline': async (p) => eda.pcb_PrimitivePolyline.getAll(p.net, p.layer),
	'pcb.get.polyline': async (p) => eda.pcb_PrimitivePolyline.get(p.primitiveIds),
	'pcb.create.polyline': async (p) => eda.pcb_PrimitivePolyline.create(p.net, p.layer, p.polygon, p.lineWidth),
	'pcb.modify.polyline': async (p) => eda.pcb_PrimitivePolyline.modify(p.primitiveId, p.property),
	'pcb.delete.polyline': async (p) => eda.pcb_PrimitivePolyline.delete(p.ids),

	// ===== Via =====
	'pcb.getAll.via': async (p) => eda.pcb_PrimitiveVia.getAll(p.net),
	'pcb.get.via': async (p) => eda.pcb_PrimitiveVia.get(p.primitiveIds),
	'pcb.create.via': async (p) => eda.pcb_PrimitiveVia.create(p.net, p.x, p.y, p.holeDiameter, p.diameter, p.viaType),
	'pcb.modify.via': async (p) => eda.pcb_PrimitiveVia.modify(p.primitiveId, p.property),
	'pcb.delete.via': async (p) => eda.pcb_PrimitiveVia.delete(p.ids),

	// ===== Net =====
	'pcb.net.getAllNames': async () => eda.pcb_Net.getAllNetsName(),
	'pcb.net.getPrimitives': async (p) => eda.pcb_Net.getAllPrimitivesByNet(p.net, p.types),
	'pcb.net.getLength': async (p) => eda.pcb_Net.getNetLength(p.net),
	'pcb.net.highlight': async (p) => eda.pcb_Net.highlightNet(p.net),
	'pcb.net.select': async (p) => eda.pcb_Net.selectNet(p.net),

	// ===== DRC =====
	'pcb.drc.check': async (p) => eda.pcb_Drc.check(p.strict, p.ui, p.verbose),
	'pcb.drc.getCurrentRuleConfigName': async () => eda.pcb_Drc.getCurrentRuleConfigurationName(),
	'pcb.drc.getRuleConfiguration': async () => eda.pcb_Drc.getCurrentRuleConfiguration(),
	'pcb.drc.getAllRuleConfigs': async (p) => eda.pcb_Drc.getAllRuleConfigurations(p.includeSystem),
	'pcb.drc.getAllNetClasses': async () => eda.pcb_Drc.getAllNetClasses(),
	'pcb.drc.createNetClass': async (p) => eda.pcb_Drc.createNetClass(p.netClassName, p.nets, p.color),
	'pcb.drc.deleteNetClass': async (p) => eda.pcb_Drc.deleteNetClass(p.netClassName),
	'pcb.drc.getDiffPairs': async () => eda.pcb_Drc.getAllDifferentialPairs(),
	'pcb.drc.createDiffPair': async (p) => eda.pcb_Drc.createDifferentialPair(p.name, p.positiveNet, p.negativeNet),

	// ===== Document / Selection / Pad =====
	'pcb.document.save': async (p) => eda.pcb_Document.save(p.uuid),
	'pcb.document.navigateTo': async (p) => eda.pcb_Document.navigateToCoordinates(p.x, p.y),
	'pcb.document.getPrimitiveAtPoint': async (p) => eda.pcb_Document.getPrimitiveAtPoint(p.x, p.y),
	'pcb.document.getPrimitivesInRegion': async (p) => eda.pcb_Document.getPrimitivesInRegion(p.left, p.right, p.top, p.bottom, p.leftToRight),
	'pcb.document.zoomToBoardOutline': async () => eda.pcb_Document.zoomToBoardOutline(),
	'pcb.select.getAll': async () => eda.pcb_SelectControl.getAllSelectedPrimitives(),
	'pcb.getAll.pad': async (p) => eda.pcb_PrimitivePad.getAll(p.layer, p.net),
	'pcb.get.pad': async (p) => eda.pcb_PrimitivePad.get(p.primitiveIds),
	'pcb.create.pad': async (p) =>
		eda.pcb_PrimitivePad.create(
			p.layer, p.padNumber, p.x, p.y, p.rotation, p.pad, p.net, p.hole, p.holeOffsetX, p.holeOffsetY, p.holeRotation,
			p.metallization, p.padType, p.specialPad, p.solderMaskAndPasteMaskExpansion, p.heatWelding, p.primitiveLock,
		),
	'pcb.modify.pad': async (p) => eda.pcb_PrimitivePad.modify(p.primitiveId, p.property),
	'pcb.delete.pad': async (p) => eda.pcb_PrimitivePad.delete(p.ids),

	// ===== Layer =====
	'pcb.layer.getAll': async () => eda.pcb_Layer.getAllLayers(),
	'pcb.layer.select': async (p) => eda.pcb_Layer.selectLayer(p.layer),
	'pcb.layer.setVisible': async (p) => eda.pcb_Layer.setLayerVisible(p.layer, p.setOtherLayerInvisible),
	'pcb.layer.setInvisible': async (p) => eda.pcb_Layer.setLayerInvisible(p.layer, p.setOtherLayerVisible),
	'pcb.layer.setCopperCount': async (p) => eda.pcb_Layer.setTheNumberOfCopperLayers(p.count),
	'pcb.layer.modify': async (p) => eda.pcb_Layer.modifyLayer(p.layer, p.property),

	// ===== Arc / Region =====
	'pcb.getAll.arc': async (p) => eda.pcb_PrimitiveArc.getAll(p.net, p.layer),
	'pcb.create.arc': async (p) =>
		eda.pcb_PrimitiveArc.create(p.net, p.layer, p.startX, p.startY, p.endX, p.endY, p.arcAngle, p.lineWidth, p.interactiveMode, p.primitiveLock),
	'pcb.modify.arc': async (p) => eda.pcb_PrimitiveArc.modify(p.primitiveId, p.property),
	'pcb.delete.arc': async (p) => eda.pcb_PrimitiveArc.delete(p.ids),
	'pcb.getAll.region': async (p) => eda.pcb_PrimitiveRegion.getAll(p.layer, p.ruleType),
	'pcb.create.region': async (p) => {
		const polygon = eda.pcb_MathPolygon.createPolygon(p.polygon);
		if (!polygon) throw new Error('Invalid polygon data');
		return eda.pcb_PrimitiveRegion.create(p.layer, polygon, p.ruleType, p.regionName, p.lineWidth, p.primitiveLock);
	},
	'pcb.delete.region': async (p) => eda.pcb_PrimitiveRegion.delete(p.ids),

	// ===== Pour / Fill =====
	'pcb.getAll.pour': async (p) => eda.pcb_PrimitivePour.getAll(p.net, p.layer),
	'pcb.create.pour': async (p) => {
		const polygon = eda.pcb_MathPolygon.createPolygon(p.polygon);
		if (!polygon) throw new Error('Invalid polygon data');
		return eda.pcb_PrimitivePour.create(p.net, p.layer, polygon, p.pourFillMethod, p.preserveSilos, p.pourName, p.pourPriority, p.lineWidth, p.primitiveLock);
	},
	'pcb.delete.pour': async (p) => eda.pcb_PrimitivePour.delete(p.ids),
	'pcb.getAll.fill': async (p) => eda.pcb_PrimitiveFill.getAll(p.layer, p.net),
	'pcb.create.fill': async (p) => {
		const polygon = eda.pcb_MathPolygon.createPolygon(p.polygon);
		if (!polygon) throw new Error('Invalid polygon data');
		return eda.pcb_PrimitiveFill.create(p.layer, polygon, p.net, p.fillMode, p.lineWidth, p.primitiveLock);
	},
	'pcb.delete.fill': async (p) => eda.pcb_PrimitiveFill.delete(p.ids),

	// ===== Manufacture (export returns base64) =====
	'pcb.manufacture.getGerberFile': async (p) =>
		exportFile(await eda.pcb_ManufactureData.getGerberFile(p.fileName, p.colorSilkscreen, p.unit, p.digitalFormat, p.other, p.layers, p.objects)),
	'pcb.manufacture.getBomFile': async (p) =>
		exportFile(await eda.pcb_ManufactureData.getBomFile(p.fileName, p.fileType, p.template, p.filterOptions, p.statistics, p.property, p.columns)),
	'pcb.manufacture.getPickAndPlaceFile': async (p) => exportFile(await eda.pcb_ManufactureData.getPickAndPlaceFile(p.fileName, p.fileType, p.unit)),
	'pcb.manufacture.get3DFile': async (p) => exportFile(await eda.pcb_ManufactureData.get3DFile(p.fileName, p.fileType, p.element, p.modelMode, p.autoGenerateModels)),
	'pcb.manufacture.getPdfFile': async (p) => exportFile(await eda.pcb_ManufactureData.getPdfFile(p.fileName)),
	'pcb.manufacture.getDsnFile': async (p) => exportFile(await eda.pcb_ManufactureData.getDsnFile(p.fileName)),
	'pcb.manufacture.importAutoRouteJson': async (p) => eda.pcb_Document.importAutoRouteJsonFile(base64ToFile(p.data, p.fileName || 'autoroute.json')),
	'pcb.manufacture.importAutoRouteSes': async (p) => {
		const doc = eda.pcb_Document as any;
		if (typeof doc.importAutoRouteSesFile !== 'function') throw new Error('importAutoRouteSesFile not available in this version');
		return doc.importAutoRouteSesFile(base64ToFile(p.data, p.fileName || 'autoroute.ses'));
	},
};

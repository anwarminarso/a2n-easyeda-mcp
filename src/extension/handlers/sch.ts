type Handler = (params: Record<string, any>) => Promise<any>;

export const schHandlers: Record<string, Handler> = {
	// ===== Component =====
	'sch.component.create': async (p) =>
		eda.sch_PrimitiveComponent.create(p.component, p.x, p.y, p.subPartName, p.rotation, p.mirror, p.addIntoBom, p.addIntoPcb),
	'sch.component.createNetFlag': async (p) => eda.sch_PrimitiveComponent.createNetFlag(p.identification, p.net, p.x, p.y, p.rotation, p.mirror),
	'sch.component.createNetPort': async (p) => eda.sch_PrimitiveComponent.createNetPort(p.direction, p.net, p.x, p.y, p.rotation, p.mirror),
	'sch.component.delete': async (p) => eda.sch_PrimitiveComponent.delete(p.ids),
	'sch.component.modify': async (p) => eda.sch_PrimitiveComponent.modify(p.primitiveId, p.property),
	'sch.component.get': async (p) => eda.sch_PrimitiveComponent.get(p.primitiveIds),
	'sch.component.getAll': async (p) => eda.sch_PrimitiveComponent.getAll(p.componentType, p.allSchematicPages),
	'sch.component.getAllPins': async (p) => eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(p.primitiveId),

	// ===== Wire =====
	'sch.wire.create': async (p) => eda.sch_PrimitiveWire.create(p.line, p.net, p.color, p.lineWidth, p.lineType),
	'sch.wire.delete': async (p) => eda.sch_PrimitiveWire.delete(p.ids),
	'sch.wire.modify': async (p) => eda.sch_PrimitiveWire.modify(p.primitiveId, p.property),
	'sch.wire.get': async (p) => eda.sch_PrimitiveWire.get(p.primitiveIds),
	'sch.wire.getAll': async (p) => eda.sch_PrimitiveWire.getAll(p.net),

	// ===== Document / Netlist / DRC =====
	'sch.document.save': async () => eda.sch_Document.save(),
	'sch.document.importChanges': async () => eda.sch_Document.importChanges(),
	'sch.drc.check': async (p) => eda.sch_Drc.check(p.strict, p.userInterface),
	'sch.netlist.get': async (p) => eda.sch_Netlist.getNetlist(p.type),
	'sch.netlist.set': async (p) => eda.sch_Netlist.setNetlist(p.type, p.netlist),

	// ===== Selection =====
	'sch.select.getAll': async () => eda.sch_SelectControl.getAllSelectedPrimitives(),
	'sch.select.getAllIds': async () => eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId(),
	'sch.select.select': async (p) => eda.sch_SelectControl.doSelectPrimitives(p.primitiveIds),
	'sch.select.clear': async () => eda.sch_SelectControl.clearSelected(),

	// ===== Primitive =====
	'sch.primitive.getType': async (p) => eda.sch_Primitive.getPrimitiveTypeByPrimitiveId(p.id),
	'sch.primitive.get': async (p) => eda.sch_Primitive.getPrimitiveByPrimitiveId(p.id),
	'sch.primitive.getBBox': async (p) => eda.sch_Primitive.getPrimitivesBBox(p.primitiveIds),
};

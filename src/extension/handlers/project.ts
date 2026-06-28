type Handler = (params: Record<string, any>) => Promise<any>;

export const projectHandlers: Record<string, Handler> = {
	'dmt.project.getInfo': async () => {
		const projectInfo = await eda.dmt_Project.getCurrentProjectInfo();
		if (!projectInfo) throw new Error('Current project info not found');

		const project_data: any[] = [];

		const filterSchPage = (page: any) => ({ name: page.name, itemType: page.itemType, uuid: page.uuid });
		const filterSch = (sch: any) => ({ name: sch.name, itemType: sch.itemType, page: sch.page.map(filterSchPage), uuid: sch.uuid });

		for (const item of projectInfo.data) {
			if (item.itemType === EDMT_ItemType.BOARD) {
				project_data.push({ name: item.name, itemType: item.itemType, schematic: filterSch(item.schematic) });
			} else if (item.itemType === EDMT_ItemType.SCHEMATIC) {
				project_data.push({ name: item.name, itemType: item.itemType, page: filterSch(item).page, uuid: item.uuid });
			}
		}

		return { data: project_data, project_name: projectInfo.friendlyName, description: projectInfo.description };
	},

	'dmt.editor.openDocument': async (p) => {
		if (typeof p.documentUuid !== 'string' || !p.documentUuid) throw new Error('Missing documentUuid');
		const tabId = await eda.dmt_EditorControl.openDocument(p.documentUuid);
		if (!tabId) throw new Error(`Failed to open document: ${p.documentUuid}`);
		return { tabId, documentUuid: p.documentUuid };
	},

	'dmt.schematic.create': async (p) => {
		const boardName = typeof p.boardName === 'string' ? p.boardName : undefined;
		const schematicFirstPageUuid = await eda.dmt_Schematic.createSchematic(boardName);
		if (!schematicFirstPageUuid) throw new Error('Failed to create schematic');
		return { schematicFirstPageUuid };
	},

	'dmt.schematic.createPage': async (p) => {
		if (typeof p.schematicUuid !== 'string' || !p.schematicUuid) throw new Error('Missing schematicUuid');
		const schematicPageUuid = await eda.dmt_Schematic.createSchematicPage(p.schematicUuid);
		if (!schematicPageUuid) throw new Error(`Failed to create schematic page for: ${p.schematicUuid}`);
		return { schematicUuid: p.schematicUuid, schematicPageUuid };
	},

	'dmt.schematic.rename': async (p) => {
		if (!p.schematicUuid || !p.schematicName) throw new Error('Missing schematicUuid or schematicName');
		const success = await eda.dmt_Schematic.modifySchematicName(p.schematicUuid, p.schematicName);
		return { success, schematicUuid: p.schematicUuid, schematicName: p.schematicName };
	},

	'dmt.schematic.renamePage': async (p) => {
		if (!p.schematicPageUuid || !p.schematicPageName) throw new Error('Missing schematicPageUuid or schematicPageName');
		const success = await eda.dmt_Schematic.modifySchematicPageName(p.schematicPageUuid, p.schematicPageName);
		return { success, schematicPageUuid: p.schematicPageUuid, schematicPageName: p.schematicPageName };
	},
};

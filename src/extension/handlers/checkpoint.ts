import { checkpointer } from '../eda/checkpointer';

type Handler = (params: Record<string, any>) => Promise<any>;

export const checkpointHandlers: Record<string, Handler> = {
	'checkpoint.save': async () => ({ checkpointId: await checkpointer.save(false) }),
	'checkpoint.list': async () => checkpointer.list(),
	'checkpoint.read': async (p) => {
		const cp = await checkpointer.read(String(p.id));
		if (!cp) throw new Error('Checkpoint not found');
		return { _id: cp._id, timestamp: cp.timestamp, pageId: cp.pageId };
	},
	'checkpoint.restore': async (p) => ({ restored: await checkpointer.restore(typeof p.id === 'string' ? p.id : undefined, true) }),
};

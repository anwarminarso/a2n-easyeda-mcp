import { pcbHandlers } from './pcb';
import { schHandlers } from './sch';
import { assembleHandlers } from './assemble';
import { projectHandlers } from './project';
import { checkpointHandlers } from './checkpoint';
import { configHandlers } from './config';
import { libHandlers } from './lib';
import { exportHandlers } from './export';
import { execHandlers } from './exec';

export type Handler = (params: Record<string, any>) => Promise<any>;

export const allHandlers: Record<string, Handler> = {
	...pcbHandlers,
	...schHandlers,
	...assembleHandlers,
	...projectHandlers,
	...checkpointHandlers,
	...configHandlers,
	...libHandlers,
	...exportHandlers,
	...execHandlers,
};

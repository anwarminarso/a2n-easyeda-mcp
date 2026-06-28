// Local, dependency-free circuit types (replaces @copilot/shared in the original engine).

export interface ExplainPin {
	pin_number: string | number;
	name: string;
	signal_name: string;
}

export interface ExplainComponent {
	designator: string;
	value: string;
	pins: ExplainPin[];
	part_uuid: string | null;
	pos?: { x: number; y: number; rotate?: number; mirror?: boolean };
	footprint_name?: string | null;
	code?: string;
}

export interface ExplainCircuit {
	components: ExplainComponent[];
}

export interface Entry {
	id: string;
	idx: number;
	coords?: [number, number];
	certain: boolean;
	urgent?: string;
	status?: string;
	address?: string;
	details?: string;
	people?: string;
	contact?: string;
	contactInfo?: string;
	animals?: string;
	data: Record<string, string>;
}

export interface EntryList {
	updated: string;
	entries: Entry[];
}

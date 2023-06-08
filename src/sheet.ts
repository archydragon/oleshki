import { sheets, sheets_v4 } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config } from './common.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { Entry, EntryList } from './entry';
import dayjs from 'dayjs';
import Schema$Spreadsheet = sheets_v4.Schema$Spreadsheet;
import Schema$CellData = sheets_v4.Schema$CellData;

await mkdir('data', { recursive: true });
const fn = 'data/sheet.json';

export async function fetchSheet() {

	const key = config.googleApiKey;
	const sh = sheets({ version: 'v4' });
	
	const doc = await sh.spreadsheets.get({
		spreadsheetId: config.spreadsheetId,
		key,
		includeGridData: true,
		fields: 'sheets.data.rowData.values(userEnteredValue,effectiveValue)',
		ranges: [config.sheetRange],
	});
	
	await writeFile(fn, JSON.stringify(doc.data, null, '\t'));
	
	return doc.data;
	
}

export async function parseSheet(data: sheets_v4.Schema$Spreadsheet) {

	const rowData = data.sheets![0].data![0].rowData!;
	const columns = rowData[0]!.values!.map(
		(cd, i) => cd.effectiveValue?.stringValue?.replace(/\s+/g, ' ') ?? String(i)
	);
	
	const val = (cd?: Schema$CellData) => {
		if (cd?.effectiveValue?.stringValue) return cd?.effectiveValue?.stringValue;
		if (cd?.effectiveValue?.numberValue) return String(cd?.effectiveValue?.numberValue);
		return undefined;
	};
	
	const cols = {
		city: columns.findIndex(s => s.includes('Город')),
		coords: columns.findIndex(s => s.includes('Координаты')),
		address: columns.findIndex(s => s.includes('адрес')),
		people: columns.findIndex(s => s.includes('ство человек')),
		contact: columns.findIndex(s => s.includes('Контактный номер')),
		contactInfo: columns.findIndex(s => s.includes('Контакт для связи')),
		animals: columns.findIndex(s => s.includes('ство жив')),
		details: columns.findIndex(s => s.includes('Другие комм')),
		status: columns.findIndex(s => s.includes('статус')),
		urgent: columns.findIndex(s => s.includes('Срочность')),
	};
	const verbatim = ['address', 'city', 'people', 'contact', 'contactInfo', 'animals', 'details', 'status', 'urgent'] as const;
	
	let entries = rowData.slice(1).filter(row => row.values?.slice(1)?.some(cd => !!val(cd))).map((row, i) => {
		const llMatch = val(row.values![cols.coords])?.match(/\d+\.\d+,\s*\d+\.\d+/);
		const coords = llMatch ? llMatch[0].split(',').map(s => Number(s.trim())) : null;
		const allData = Object.fromEntries(row.values!.map((cd, i) => [columns[i], val(cd)]));
		const etc = Object.fromEntries(verbatim.map(k => [k, val(row.values![cols[k]])]).filter(r => !!r[1]));
		const certain = !!etc.address && !etc.city?.includes('старые координаты');
		return <Entry> {
			id: val(row.values![0]),
			idx: i + 1,
			coords,
			certain,
			...etc,
			data: allData,
		};
	});
	
	const done = entries.filter(e => e.status == 'ВЫВЕЗЛИ').length;
	entries = entries.filter(e => e.status != 'ВЫВЕЗЛИ');
	
	const list: EntryList = {
		updated: dayjs().format(),
		done,
		columns,
		mapping: cols,
		entries,
	};
	
	await writeFile('data/entries.data.json', JSON.stringify(list, null, '\t'));
	
	entries.forEach(e => e.data = undefined);
	await writeFile('data/entries.json', JSON.stringify(list, null, '\t'));
	
	console.log(list.updated, entries.length);

}

if (process.argv.includes('fetch')) {
	const data = await fetchSheet();
	await parseSheet(data);
}
// else if (process.argv.includes('parse')) {
// 	const data = JSON.parse(await readFile(fn, 'utf8'));
// 	await parseSheet(data);
// }

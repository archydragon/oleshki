import { Component, createRef } from 'react';
import L, { LatLng, LatLngExpression } from 'leaflet';
import { Entry } from '../entry';
import { renderToString } from 'react-dom/server';
import 'leaflet.locatecontrol';
import { IconColor, icons } from './markers';

interface MapProps {
	entries?: Entry[];
	shown?: Entry[];
	clownMode: boolean;
	onUpdated: (state: MapViewState) => void;
	onSelected: (entries: Entry[]) => void;
	toggleSelected: (entry: Entry) => void;
	selected?: Entry[];
	selecting?: boolean;
}
interface MapState {

}
export interface MapViewState {
	bounds: L.LatLngBounds;
	center: L.LatLng;
	zoom: number;
}

export class MapView extends Component<MapProps, MapState> {

	div = createRef<HTMLDivElement>();
	map!: L.Map;
	
	markers = new Map<string, L.Marker>;
	selection?: L.Rectangle;
	selectionFrom?: L.LatLng;
	selectedLine?: L.Polyline;
	drawnBefore?: Entry[];
	drawnAtZoom = 0;
	
	render() {
		return <div className="map" ref={this.div} />;
	}
	
	shouldComponentUpdate(nextProps: Readonly<MapProps>, nextState: Readonly<MapState>, nextContext: any) {
		if (nextProps.shown && (nextProps.shown != this.props.shown || nextProps.selected != this.props.selected)) this.updateEntries(nextProps);
		return false;
	}
	
	componentDidMount() {
	
		const { clownMode } = this.props;
		
		const params = location.hash ? new URLSearchParams(location.hash.slice(1)) : null;
		const saved = params?.get('map')?.split(',').map(Number);
		const ll = saved?.slice(0, 2) ?? [46.61549, 32.69943];
		const zoom = saved?.[2] ?? 11;
	
		this.map = L.map(this.div.current!, {
			attributionControl: !clownMode,
		});
		
		const osm = L.tileLayer(`/osm/{z}/{x}/{y}.png`, {
			maxZoom: 19,
			attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
		});
		const visicom = new L.TileLayer(`/visicom/2.0.0/planet3/base/{z}/{x}/{y}.png${clownMode ? '?lang=ru' : ''}`, {
			attribution: '<a href=\'https://api.visicom.ua/\'>Визиком</a>',
			// subdomains: '123',
			maxZoom: 19,
			tms: true,
		}).addTo(this.map);
		L.control.locate({}).addTo(this.map);
		
		const bounds = { n: 46.70577000000003, s: 46.442814000000055, w: 32.47389300000003, e: 32.71770800000007 };
		const maxar = L.imageOverlay(`/104001008763D300.jpg`, [[bounds.n, bounds.w], [bounds.s, bounds.e]]);
		
		L.control.layers({
			OSM: osm,
			Visicom: visicom,
		}, clownMode ? {} : {
			maxar,
		}).addTo(this.map);
		
		this.map.on('moveend', this.saveState);
		this.map.on('zoomend', this.saveState);
		this.map.on('load', this.saveState);
		
		this.map.on('mousedown', event => {
			
			if (this.selection) this.selection.remove();
			if (!this.props.selecting || event.originalEvent.button) return;
			
			
			this.selectionFrom = event.latlng;
			this.selection = new L.Rectangle(new L.LatLngBounds(event.latlng, event.latlng), {
				color: '#f80',
			}).addTo(this.map);
			
			event.originalEvent.stopImmediatePropagation();
			event.originalEvent.preventDefault();
			
		});
		this.map.on('mousemove', event => {
			if (!this.selection || !this.selectionFrom) return;
			this.selection.setBounds(new L.LatLngBounds(this.selectionFrom, event.latlng));
			event.originalEvent.stopImmediatePropagation();
			event.originalEvent.preventDefault();
		});
		this.map.on('mouseup', event => {
			
			if (!this.selection || !this.selectionFrom) return;
			event.originalEvent.stopImmediatePropagation();
			event.originalEvent.preventDefault();
			
			const bounds = this.selection.getBounds();
			const found = this.props.shown!.filter(e => e.coords && bounds.contains(e.coords));
			const add: Entry[] = [];
			
			const prev = this.props.selected;
			let last: LatLngExpression = prev?.[prev?.length - 1].coords ?? this.selectionFrom!;
			while (found.length) {
				found.sort((a, b) => this.map.distance(last, a.coords!) - this.map.distance(last, b.coords!));
				const pt = found.shift()!;
				add.push(pt);
				last = pt.coords!;
			}
			
			this.props.onSelected(add);
			this.selection.remove();
			this.selection = undefined;
			
		});
		
		this.map.setView(ll as L.LatLngTuple, zoom);
		
		if (this.props.shown) this.updateEntries(this.props);
		
	}
	
	saveState = () => {
		
		const bounds = this.map.getBounds();
		const center = this.map.getCenter();
		const zoom = this.map.getZoom();
		
		this.props.onUpdated({ bounds, center, zoom });
		const state = [center.lat.toFixed(6), center.lng.toFixed(6), zoom].join(',');
		history.replaceState(null, '', `#map=${state}`);
		
		if (this.props.shown) this.updateEntries(this.props);
		
	};
	
	updateEntries({ shown, selected, clownMode }: MapProps) {
		
		type Group = {
			entry: Entry;
			entries: Entry[];
			color: IconColor;
		};
		
		const { markers, map } = this;
		
		const seen = new Set<string>();
		const selSet = new Set<string>((selected ?? []).map(e => e.id));
		const bounds = map.getBounds().pad(0.25);
		
		const getColor = (entry: Entry) => (selSet.has(entry.id)
			? (
				selected?.[0].id == entry.id ? 'orange'
				: selected?.[selected?.length - 1]?.id == entry.id ? 'green'
				: 'yellow'
			)
			: entry.uncertain ? 'violet'
			: entry.medical ? 'red'
			: entry.rescued ? 'green'
			: entry.remain ? 'teal'
			: 'blue'
		);
		
		const within: Group[] = shown!
			.filter(e => e.coords && bounds.contains(e.coords))
			.map(entry => ({ entry, entries: [entry], color: getColor(entry) }));
			
		const prio = new Set(this.drawnBefore && this.drawnAtZoom == map.getZoom() ? this.drawnBefore.map(e => e.id) : []);
		// console.log(prio);
		
		// stable shuffle-ish
		within.sort((a, b) => {
			const idA = a.entry.id ?? '';
			const idB = b.entry.id ?? '';
			const pA = prio.has(idA);
			const pB = prio.has(idB);
			if (pA != pB) return Number(pB) - Number(pA);
			return idA[idA.length - 1]?.localeCompare(idB[idB.length - 1] || '') || idA?.localeCompare(idB || '') || 0;
		});
		// console.log(within.map(e => e.entry.id));
		
		// const draw = new Set(within);
		const limit = 200;
		const draw: Group[] = [];
		let mustGroup = within.length - limit;
		const thresh = (map.getSize().x + map.getSize().y) / 50;
		// console.log('w', within.length, 'mg', mustGroup, 'th', thresh);
		
		// const t = performance.now();
		for (const group of within) {
			if (!selSet.has(group.entry.id) && !group.entry.medical && mustGroup > 0 && draw.length && !prio.has(group.entry.id)) {
				let best = draw[0];
				let bestDist = Infinity;
				for (const other of draw) {
					if (other.color != group.color) continue;
					const dist = map.distance(group.entry.coords!, other.entry.coords!);
					if (dist >= bestDist) continue;
					best = other;
					bestDist = dist;
				}
				const a = map.latLngToContainerPoint(group.entry.coords!);
				const b = map.latLngToContainerPoint(best.entry.coords!);
				if (a.distanceTo(b) < thresh) {
					best.entries.push(group.entry);
					mustGroup--;
					continue;
				}
			}
			draw.push(group);
		}
		// console.log('d', draw.length, 'mgl', mustGroup);
		// console.log('t', performance.now() - t);
		
		for (const { entry, entries, color } of draw) {
			if (!entry.coords) continue;
			const mark = selSet.has(entry.id);
			const key = JSON.stringify([entry.id, entry.medical, entry.status, entry.coords, mark]);
			seen.add(key);
			const popup = () => renderToString(<div className="popup">
				{entries.length > 1 && <h2>{entries.length} точек:</h2>}
				{entries.map(entry => <EntryPopup entry={entry} clownMode={clownMode} />)}
			</div>);
			const icon = icons[color][entries.length > 1 ? 'multi' : 'single'];
			let marker = markers.get(key);
			if (!marker) {
				marker = L.marker(entry.coords, {
					interactive: true,
					icon,
				}).addTo(map);
				markers.set(key, marker);
				marker.on('mousedown', event => {
					if (this.props.selecting && !event.originalEvent.button) {
						L.DomEvent.stop(event);
						this.props.toggleSelected(entry);
					}
				});
			}
			else {
				marker.setIcon(icon);
			}
			marker.bindPopup(popup);
		}
		
		if (this.selectedLine) {
			this.selectedLine.remove();
			this.selectedLine = undefined;
		}
		if (selected) {
			this.selectedLine = L.polyline(selected.map(e => e.coords!), { color: '#f80' }).addTo(map);
		}
		
		for (const [key, marker] of markers.entries()) {
			if (seen.has(key)) continue;
			// console.log('rm', key);
			marker.remove();
			markers.delete(key);
		}
		
		this.drawnBefore = draw.map(g => g.entry);
		this.drawnAtZoom = map.getZoom();
		
	}
	
}

export function EntryPopup({ entry, clownMode, noId }: { entry: Entry; clownMode?: boolean; noId?: boolean }) {
	const addr = !clownMode ? entry.address : entry.addressRu ?? entry.address?.split(' / ')[0];
	return <div className="entry">
		<div className="id">
			{!noId && <strong>#{entry.id}</strong>}
			{entry.urgent ? <strong>{!noId && ' - '}{entry.urgent}</strong> : ''}
			{entry.status && entry.status != 'добавлено' ? <em> - {entry.status}</em> : ''}
			{'\n'}
		</div>
		<div className="people">
			<span title="Людей">
				👥{' '}
				{entry.people ?? '?'}
			</span>
			{!!entry.animals && <span title="Животных">
				{' + 🐾 '}
				{entry.animals}
			</span>}
			{'\n'}
		</div>
		{!!addr && <div title="Адрес">🏠 {addr}{'\n'}</div>}
		{/*{!!entry.city && <div title="Город/село">🏢 {entry.city}</div>}*/}
		<div className="Координаты">🌐 {entry.coords?.join(', ')}{'\n'}</div>
		{!!entry.contact && <div title="Телефон">📞 {entry.contact}{'\n'}</div>}
		{!!entry.contactInfo && <div title="Контактная информация">💬 {entry.contactInfo}{'\n'}</div>}
		{!clownMode && !!entry.details && <div title="Детали">ℹ️ {entry.details}{'\n'}</div>}
	</div>;
}

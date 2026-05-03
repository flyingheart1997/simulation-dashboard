import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import * as THREE from 'three';
import { Protocol } from 'pmtiles';
import type { StyleSpecification } from 'maplibre-gl';
import type { MapType } from '../types/types';
import type { FlatMapBounds, LatLon } from '../utils/mapProjection';
import { getConfiguredMapLibreStyleUrl, getMapboxRasterTileTemplate, getPublicMapboxToken } from '../utils/mapSourceConfig';

let pmtilesProtocolRegistered = false;

function resolveMapStyle(mapType: MapType, token: string): StyleSpecification | string | null {
    const configuredStyleUrl = getConfiguredMapLibreStyleUrl(mapType);
    if (configuredStyleUrl) return configuredStyleUrl;
    if (token) return getMapboxRasterStyle(mapType, token);
    return null;
}

function getMapboxRasterStyle(mapType: MapType, token: string): StyleSpecification {
    return {
        version: 8,
        sources: {
            base: {
                type: 'raster',
                tiles: [
                    getMapboxRasterTileTemplate(mapType, token, true)
                ],
                tileSize: 512,
                attribution: '© Mapbox © OpenStreetMap'
            }
        },
        layers: [
            {
                id: 'base',
                type: 'raster',
                source: 'base',
                paint: {
                    'raster-fade-duration': 0
                }
            }
        ]
    };
}

export class MapLibreBaseLayer {
    private container: HTMLDivElement;
    private map: MapLibreMap | null = null;
    private active = false;
    private failed = false;
    private currentMapType: MapType | null = null;
    private transformRevision = 0;
    private viewportWidth = 1;
    private viewportHeight = 1;

    constructor(parent: HTMLElement, private readonly onlineMapEnabled: boolean) {
        this.container = document.createElement('div');
        this.container.className = 'sim-maplibre-base';
        this.container.style.display = 'none';
        parent.insertBefore(this.container, parent.firstChild);
        this.registerPmtilesProtocol();
    }

    setVisible(visible: boolean, mapType: MapType): boolean {
        if (!visible || this.failed || !this.onlineMapEnabled) {
            this.container.style.display = 'none';
            this.active = false;
            return false;
        }

        const token = getPublicMapboxToken();
        const style = resolveMapStyle(mapType, token);
        if (!style) {
            this.container.style.display = 'none';
            this.active = false;
            return false;
        }

        if (!this.map) {
            this.createMap(mapType, style);
        } else if (this.currentMapType !== mapType) {
            this.currentMapType = mapType;
            this.map.setStyle(style);
        }

        this.container.style.display = 'block';
        this.active = true;
        this.updateViewportSize();
        this.map?.resize();
        return true;
    }

    isActive(): boolean {
        return this.active && !!this.map && !this.failed;
    }

    resize(): void {
        this.updateViewportSize();
        this.map?.resize();
        this.transformRevision++;
    }

    panBy(deltaX: number, deltaY: number): void {
        if (!this.isActive()) return;
        this.map?.panBy([deltaX, deltaY], { duration: 0 });
        this.transformRevision++;
    }

    zoomByWheel(event: WheelEvent): void {
        if (!this.isActive() || !this.map) return;
        const rect = this.container.getBoundingClientRect();
        const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
        const around = this.map.unproject(point);
        const clampedDelta = Math.max(-240, Math.min(240, event.deltaY));
        const zoomDelta = -clampedDelta * 0.003;
        const nextZoom = Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), this.map.getZoom() + zoomDelta));
        this.map.zoomTo(nextZoom, { around, duration: 0 });
        this.transformRevision++;
    }

    getTransformRevision(): number {
        return this.transformRevision;
    }

    project(lat: number, lon: number, z: number, bounds: FlatMapBounds): THREE.Vector3 {
        const point = this.map?.project([lon, lat]);
        if (!point) return new THREE.Vector3(0, 0, z);
        return new THREE.Vector3(
            (point.x / this.viewportWidth - 0.5) * bounds.width,
            (0.5 - point.y / this.viewportHeight) * bounds.height,
            z
        );
    }

    getLatLonFromClientEvent(event: MouseEvent | WheelEvent): LatLon | null {
        if (!this.isActive() || !this.map) return null;
        const rect = this.container.getBoundingClientRect();
        const lngLat = this.map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
        return { lat: lngLat.lat, lon: lngLat.lng };
    }

    destroy(): void {
        this.map?.remove();
        this.map = null;
        this.container.remove();
    }

    private updateViewportSize(): void {
        const rect = this.container.getBoundingClientRect();
        this.viewportWidth = Math.max(1, rect.width);
        this.viewportHeight = Math.max(1, rect.height);
    }

    private createMap(mapType: MapType, style: StyleSpecification | string): void {
        this.currentMapType = mapType;
        this.map = new maplibregl.Map({
            container: this.container,
            style,
            center: [0, 10],
            zoom: 1,
            minZoom: 0,
            maxZoom: 8,
            interactive: false,
            attributionControl: false,
            fadeDuration: 0,
            renderWorldCopies: false
        });

        this.map.once('load', () => {
            this.map?.fitBounds([[-180, -72], [180, 82]], { duration: 0, padding: 0 });
            this.transformRevision++;
        });

        this.map.on('move', () => {
            this.transformRevision++;
        });

        this.map.on('error', () => {
            this.failed = true;
            this.active = false;
            this.container.style.display = 'none';
        });
    }

    private registerPmtilesProtocol(): void {
        if (pmtilesProtocolRegistered) return;
        const protocol = new Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        pmtilesProtocolRegistered = true;
    }
}

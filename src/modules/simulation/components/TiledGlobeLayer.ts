import * as THREE from 'three';
import type { MapType } from '../types';
import { latLonToVector3 } from '../utils/coordUtils';
import {
    getConfiguredMapLibreStyleUrl,
    getMapboxRasterTileTemplate,
    getPublicMapboxToken,
    resolveRasterTileUrl
} from '../utils/mapSourceConfig';

interface GlobeTile {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    texture: THREE.Texture;
}

export interface TiledGlobeStatus {
    onlinePreferred: boolean;
    active: boolean;
}

export class TiledGlobeLayer {
    private readonly group = new THREE.Group();
    private readonly textureLoader = new THREE.TextureLoader();
    private tiles: GlobeTile[] = [];
    private loadedCount = 0;
    private errorCount = 0;
    private totalCount = 0;
    private ready = false;
    private sourceKey = '';
    private pendingSourceKey = '';
    private readonly zoom = 3;
    private readonly tileSegments = 16;
    private readonly surfaceOffsetKm = 24;

    constructor(
        parent: THREE.Group,
        private readonly maxAnisotropy: number,
        private readonly onlineMapEnabled: boolean
    ) {
        this.group.name = 'online-tiled-globe-layer';
        this.group.visible = false;
        parent.add(this.group);
        this.textureLoader.setCrossOrigin('anonymous');
    }

    update(mapType: MapType): TiledGlobeStatus {
        const token = getPublicMapboxToken();
        const configuredStyleUrl = getConfiguredMapLibreStyleUrl(mapType);
        const onlinePreferred = this.onlineMapEnabled && (!!configuredStyleUrl || !!token);

        if (!onlinePreferred) {
            this.setVisible(false);
            return { onlinePreferred: false, active: false };
        }

        const nextSourceKey = `${mapType}:${configuredStyleUrl || token}`;
        if (this.sourceKey !== nextSourceKey && this.pendingSourceKey !== nextSourceKey) {
            this.prepareTiles(mapType, token, configuredStyleUrl, nextSourceKey);
        }

        const active = this.ready && this.tiles.length > 0;
        this.group.visible = active;
        return { onlinePreferred, active };
    }

    setVisible(visible: boolean): void {
        this.group.visible = visible && this.ready;
    }

    dispose(): void {
        this.clearTiles();
        this.group.removeFromParent();
    }

    private prepareTiles(mapType: MapType, token: string, configuredStyleUrl: string, sourceKey: string): void {
        this.sourceKey = '';
        this.pendingSourceKey = sourceKey;
        this.ready = false;
        this.loadedCount = 0;
        this.errorCount = 0;
        this.clearTiles();

        if (!configuredStyleUrl) {
            this.loadTiles(mapType, token, getMapboxRasterTileTemplate(mapType, token, true), sourceKey);
            return;
        }

        this.resolveConfiguredRasterTemplate(configuredStyleUrl)
            .then(template => {
                if (this.pendingSourceKey !== sourceKey) return;
                this.loadTiles(mapType, token, template || getMapboxRasterTileTemplate(mapType, token, true), sourceKey);
            })
            .catch(() => {
                if (this.pendingSourceKey !== sourceKey) return;
                this.loadTiles(mapType, token, getMapboxRasterTileTemplate(mapType, token, true), sourceKey);
            });
    }

    private loadTiles(mapType: MapType, token: string, tileTemplate: string, sourceKey: string): void {
        this.sourceKey = sourceKey;
        this.pendingSourceKey = '';
        this.ready = false;
        this.loadedCount = 0;
        this.errorCount = 0;
        this.clearTiles();

        const tileCount = 2 ** this.zoom;
        this.totalCount = tileCount * tileCount;

        for (let y = 0; y < tileCount; y++) {
            for (let x = 0; x < tileCount; x++) {
                const texture = this.textureLoader.load(
                    resolveRasterTileUrl(tileTemplate, mapType, this.zoom, x, y, token),
                    loadedTexture => {
                        this.configureTexture(loadedTexture);
                        this.loadedCount++;
                        this.updateReadyState();
                    },
                    undefined,
                    () => {
                        this.errorCount++;
                        this.updateReadyState();
                    }
                );
                this.configureTexture(texture);

                const material = new THREE.MeshBasicMaterial({
                    map: texture,
                    toneMapped: false,
                    depthTest: true,
                    depthWrite: true,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(this.buildTileGeometry(x, y), material);
                mesh.renderOrder = 2;
                mesh.frustumCulled = true;
                this.group.add(mesh);
                this.tiles.push({ mesh, texture });
            }
        }
    }

    private clearTiles(): void {
        this.tiles.forEach(tile => {
            this.group.remove(tile.mesh);
            tile.mesh.geometry.dispose();
            tile.mesh.material.dispose();
            tile.texture.dispose();
        });
        this.tiles = [];
    }

    private configureTexture(texture: THREE.Texture): void {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.maxAnisotropy;
    }

    private updateReadyState(): void {
        const settledCount = this.loadedCount + this.errorCount;
        const minimumLoadedCount = Math.max(1, Math.ceil(this.totalCount * 0.2));
        this.ready = this.loadedCount >= minimumLoadedCount;
        if (settledCount === this.totalCount && this.loadedCount === 0) {
            this.ready = false;
            this.group.visible = false;
        }
    }

    private async resolveConfiguredRasterTemplate(styleUrl: string): Promise<string | null> {
        if (!/^https?:\/\//i.test(styleUrl)) return null;

        const response = await fetch(styleUrl);
        if (!response.ok) return null;

        const style = await response.json();
        const sources = style?.sources && typeof style.sources === 'object'
            ? Object.values(style.sources)
            : [];

        for (const source of sources as any[]) {
            if (source?.type === 'raster' && Array.isArray(source.tiles) && source.tiles[0]) {
                return source.tiles[0];
            }
        }

        return null;
    }

    private buildTileGeometry(tileX: number, tileY: number): THREE.BufferGeometry {
        const tileCount = 2 ** this.zoom;
        const positions: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        for (let row = 0; row <= this.tileSegments; row++) {
            const v = row / this.tileSegments;
            for (let col = 0; col <= this.tileSegments; col++) {
                const u = col / this.tileSegments;
                const lon = ((tileX + u) / tileCount) * 360 - 180;
                const lat = this.tileYToLatitude(tileY + v, tileCount);
                const point = latLonToVector3(lat, lon, this.surfaceOffsetKm);
                positions.push(point.x, point.y, point.z);
                uvs.push(u, 1 - v);
            }
        }

        const rowStride = this.tileSegments + 1;
        for (let row = 0; row < this.tileSegments; row++) {
            for (let col = 0; col < this.tileSegments; col++) {
                const a = row * rowStride + col;
                const b = a + 1;
                const c = a + rowStride;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return geometry;
    }

    private tileYToLatitude(y: number, tileCount: number): number {
        const n = Math.PI - (2 * Math.PI * y) / tileCount;
        return THREE.MathUtils.radToDeg(Math.atan(Math.sinh(n)));
    }
}

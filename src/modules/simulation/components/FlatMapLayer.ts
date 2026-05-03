import * as THREE from 'three';
import { SatelliteInstancedMesh } from './SatelliteInstancedMesh';
import { EditablePolygon, GroundStation, GroundTarget, SimulatedSatellite, SimulationState } from '../modules/types';
import { FlatMapBounds, flatVectorToLatLon, latLonToFlatVector3 } from '../utils/mapProjection';
import { buildCoverageFootprint, findBestVisibleSatellite } from '../utils/visibilityUtils';
import { getSatelliteColor } from '../utils/satelliteUtils';
import { SIMULATION_DATA_LAYER_STYLES, SIMULATION_NIGHT_TEXTURE, getSimulationMapStyle } from '../utils/mapStyles';

interface GroundPointBuffers {
    geometry: THREE.BufferGeometry;
    points: THREE.Points;
    ids: string[];
    capacity: number;
    color: THREE.Color;
    activeColor: THREE.Color;
}

export class FlatMapLayer {
    private group: THREE.Group = new THREE.Group();
    private bounds: FlatMapBounds;
    private mapMesh: THREE.Mesh;
    private mapMaterial: THREE.ShaderMaterial;
    private textureLoader = new THREE.TextureLoader();
    private textures: Record<string, THREE.Texture> = {};
    private dataLayers: Map<string, THREE.Mesh> = new Map();
    private satelliteMesh: SatelliteInstancedMesh | null = null;
    private satellitePositions: Map<string, THREE.Vector3> = new Map();
    private groundStations: GroundPointBuffers;
    private groundTargets: GroundPointBuffers;
    private polygonVertices: GroundPointBuffers;
    private polygonLines: Map<string, THREE.Line> = new Map();
    private polygonFills: Map<string, THREE.Mesh> = new Map();
    private draftPreviewLine: THREE.Line | null = null;
    private orbitLines: Map<string, THREE.Line> = new Map();
    private commLines: Map<string, THREE.Line> = new Map();
    private coverageLines: Map<string, THREE.LineSegments> = new Map();
    private coverageFills: Map<string, THREE.Mesh> = new Map();
    private draftPolygonPreviewLatLon: { lat: number; lon: number } | null = null;
    private externalBaseProjector: ((lat: number, lon: number, z: number, bounds: FlatMapBounds) => THREE.Vector3) | null = null;
    private externalBaseActive = false;
    private externalBaseRevision = 0;
    private renderedExternalBaseRevision = -1;
    private lastCoverageRefreshMs = 0;
    private lastCommRefreshMs = 0;

    constructor(scene: THREE.Scene, bounds: FlatMapBounds) {
        this.bounds = bounds;
        this.group.name = 'flat-map-layer';
        this.group.visible = false;
        scene.add(this.group);

        this.textureLoader.setCrossOrigin('anonymous');
        this.textures.night = this.loadMapTexture(SIMULATION_NIGHT_TEXTURE);
        this.textures.dark = this.loadMapTexture(getSimulationMapStyle('dark').fallbackTexture);
        this.textures.satellite = this.loadMapTexture(getSimulationMapStyle('satellite').fallbackTexture);
        this.mapMaterial = this.createMapMaterial();
        this.mapMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 1, 1),
            this.mapMaterial
        );
        this.mapMesh.name = 'flat-map-plane';
        this.mapMesh.renderOrder = 0;
        this.group.add(this.mapMesh);

        SIMULATION_DATA_LAYER_STYLES.forEach((config, index) => {
            const layer = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1, 1, 1),
                new THREE.MeshBasicMaterial({
                    color: config.color,
                    transparent: true,
                    opacity: config.opacity2d,
                    depthWrite: false,
                    blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending
                })
            );
            layer.position.z = 4 + index * 0.05;
            layer.visible = false;
            this.dataLayers.set(config.id, layer);
            this.group.add(layer);
        });

        this.groundStations = this.createGroundPointLayer(this.createGroundStationTexture(), 44, 20, 0x00ff88);
        this.groundTargets = this.createGroundPointLayer(this.createGroundTargetTexture(), 38, 30, 0xffcc00);
        this.polygonVertices = this.createGroundPointLayer(this.createPolygonVertexTexture(), 26, 45, 0x00ffff);
        this.applyBounds(bounds);
    }

    setVisible(visible: boolean): void {
        this.group.visible = visible;
    }

    setExternalBaseProjection(
        active: boolean,
        projector: ((lat: number, lon: number, z: number, bounds: FlatMapBounds) => THREE.Vector3) | null,
        revision = 0
    ): void {
        this.externalBaseActive = active;
        this.externalBaseProjector = active ? projector : null;
        this.externalBaseRevision = active ? revision : 0;
        this.mapMaterial.uniforms.externalBaseActive.value = active ? 1.0 : 0.0;
        this.mapMesh.visible = true;
    }

    applyBounds(bounds: FlatMapBounds): void {
        this.bounds = bounds;
        this.mapMesh.scale.set(bounds.width, bounds.height, 1);
        this.dataLayers.forEach(layer => layer.scale.set(bounds.width, bounds.height, 1));
    }

    update(state: SimulationState, sunPosition: THREE.Vector3, camera: THREE.OrthographicCamera): void {
        this.updateMapBase(state, sunPosition, camera);
        this.updateSatellites(state.satellites, state.workspaceMode === 'inspect');
        this.updateGroundStations(this.getVisibleGroundStations(state));
        this.updateGroundTargets(this.getVisibleGroundTargets(state));
        this.updatePolygons(state);

        if (state.workspaceMode === 'inspect') {
            const projectionChanged = this.externalBaseActive && this.externalBaseRevision !== this.renderedExternalBaseRevision;
            this.updateOrbitPaths(state);
            this.updateCoverageAreas(state, projectionChanged);
            this.updateCommunicationLinks(state, projectionChanged);
            if (projectionChanged) this.renderedExternalBaseRevision = this.externalBaseRevision;
        } else {
            this.hideInspectionLayers();
        }

        this.dataLayers.forEach((layer, id) => {
            layer.visible = state.workspaceMode === 'inspect' && state.visibleLayers.includes(id);
        });
    }

    setDraftPolygonPreviewLatLon(latLon: { lat: number; lon: number } | null): void {
        this.draftPolygonPreviewLatLon = latLon;
    }

    pickMapLatLon(raycaster: THREE.Raycaster): { lat: number; lon: number } | null {
        const hit = raycaster.intersectObject(this.mapMesh, false)[0];
        if (!hit) return null;
        return flatVectorToLatLon(hit.point, this.bounds);
    }

    private projectLatLon(lat: number, lon: number, z: number): THREE.Vector3 {
        if (this.externalBaseActive && this.externalBaseProjector) {
            return this.externalBaseProjector(lat, lon, z, this.bounds);
        }
        return latLonToFlatVector3(lat, lon, z, this.bounds);
    }

    pickMapPoint(raycaster: THREE.Raycaster): THREE.Vector3 | null {
        return raycaster.intersectObject(this.mapMesh, false)[0]?.point || null;
    }

    pickSatellite(raycaster: THREE.Raycaster): string | null {
        if (!this.satelliteMesh) return null;
        const hit = raycaster.intersectObjects(this.satelliteMesh.getMeshes(), false)[0];
        const mesh = hit?.object as any;
        if (!hit || hit.index === undefined || !mesh.category) return null;
        return this.satelliteMesh.getSatelliteId(mesh.category, hit.index);
    }

    pickGroundStation(raycaster: THREE.Raycaster): string | null {
        return this.pickGroundPoint(raycaster, this.groundStations);
    }

    pickGroundTarget(raycaster: THREE.Raycaster): string | null {
        return this.pickGroundPoint(raycaster, this.groundTargets);
    }

    pickPolygon(raycaster: THREE.Raycaster): string | null {
        const meshes = Array.from(this.polygonFills.values()).filter(mesh => mesh.visible);
        const hit = raycaster.intersectObjects(meshes, false)[0];
        return hit?.object.userData.polygonId || null;
    }

    destroy(): void {
        this.satelliteMesh?.destroy();
        this.destroyGroundPointLayer(this.groundStations);
        this.destroyGroundPointLayer(this.groundTargets);
        this.destroyGroundPointLayer(this.polygonVertices);
        this.polygonLines.forEach(line => this.disposeLine(line));
        this.polygonFills.forEach(fill => {
            this.group.remove(fill);
            fill.geometry.dispose();
            (fill.material as THREE.Material).dispose();
        });
        if (this.draftPreviewLine) {
            this.disposeLine(this.draftPreviewLine);
            this.draftPreviewLine = null;
        }
        this.orbitLines.forEach(line => this.disposeLine(line));
        this.commLines.forEach(line => this.disposeLine(line));
        this.coverageLines.forEach(line => this.disposeLine(line));
        this.coverageFills.forEach(fill => {
            this.group.remove(fill);
            fill.geometry.dispose();
            (fill.material as THREE.Material).dispose();
        });
        this.dataLayers.forEach(layer => {
            this.group.remove(layer);
            layer.geometry.dispose();
            (layer.material as THREE.Material).dispose();
        });
        this.mapMesh.geometry.dispose();
        this.mapMaterial.dispose();
        Object.values(this.textures).forEach(texture => texture.dispose());
        this.group.removeFromParent();
    }

    private updateMapBase(state: SimulationState, sunPosition: THREE.Vector3, _camera: THREE.OrthographicCamera): void {
        const style = getSimulationMapStyle(state.selectedMap);
        this.mapMaterial.uniforms.dayTexture.value = this.textures[state.selectedMap] || this.textures.dark;
        this.mapMaterial.uniforms.nightTexture.value = this.textures.night;
        this.mapMaterial.uniforms.sunDirection.value.copy(sunPosition);
        this.mapMaterial.uniforms.showDayNight.value = state.showDayNightLayer ? 1.0 : 0.0;
        this.mapMaterial.uniforms.mode.value = state.selectedMap === 'dark' ? 0.0 : 1.0;
        this.mapMaterial.uniforms.background.value.setHex(style.background);
    }

    private loadMapTexture(url: string): THREE.Texture {
        const texture = this.textureLoader.load(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 8;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    private createMapMaterial(): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            uniforms: {
                dayTexture: { value: this.textures.dark },
                nightTexture: { value: this.textures.night },
                sunDirection: { value: new THREE.Vector3(1, 0, 0) },
                showDayNight: { value: 1.0 },
                mode: { value: 0.0 },
                externalBaseActive: { value: 0.0 },
                background: { value: new THREE.Color(0x020812) }
            },
            transparent: true,
            depthWrite: false,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D dayTexture;
                uniform sampler2D nightTexture;
                uniform vec3 sunDirection;
                uniform float showDayNight;
                uniform float mode;
                uniform float externalBaseActive;
                uniform vec3 background;
                varying vec2 vUv;
                void main() {
                    float lon = (vUv.x - 0.5) * 6.28318530718;
                    float lat = (vUv.y - 0.5) * 3.14159265359;
                    vec3 normal = normalize(vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)));
                    float intensity = dot(normal, normalize(sunDirection));
                    float lit = smoothstep(-0.22, 0.2, intensity);
                    float nightMask = 1.0 - lit;
                    vec3 dayColor = texture2D(dayTexture, vUv).rgb;
                    vec3 nightColor = texture2D(nightTexture, vUv).rgb;
                    vec3 visibleNight = min(vec3(1.0), pow(nightColor, vec3(0.78)) * 1.45);
                    if (mode < 0.5) {
                        dayColor = ((dayColor - 0.5) * 1.18 + 0.5) * vec3(0.86, 1.06, 1.2) + vec3(0.0, 0.02, 0.04);
                        dayColor *= 0.46;
                    }
                    if (externalBaseActive > 0.5) {
                        if (showDayNight < 0.5) discard;
                        float overlayAlpha = nightMask * (mode < 0.5 ? 0.72 : 0.58);
                        vec3 overlayColor = mix(vec3(0.0, 0.018, 0.04), vec3(0.0, 0.03, 0.07), mode);
                        gl_FragColor = vec4(overlayColor + visibleNight * nightMask * 0.08, overlayAlpha);
                    } else {
                        gl_FragColor = vec4(showDayNight > 0.5 ? mix(visibleNight, dayColor, lit) : dayColor, 1.0);
                    }
                }
            `
        });
    }

    private hideInspectionLayers(): void {
        this.orbitLines.forEach(line => { line.visible = false; });
        this.commLines.forEach(line => { line.visible = false; });
        this.coverageLines.forEach(line => { line.visible = false; });
        this.coverageFills.forEach(fill => { fill.visible = false; });
    }

    private getVisibleGroundStations(state: SimulationState): GroundStation[] {
        if (state.workspaceMode === 'inspect') return state.groundStations;
        if (state.workspaceMode === 'create-ground-station' && state.selectedGroundStationId) {
            return state.groundStations.filter(gs => gs.id === state.selectedGroundStationId);
        }
        return [];
    }

    private getVisibleGroundTargets(state: SimulationState): GroundTarget[] {
        if (state.workspaceMode === 'inspect') return state.groundTargets;
        if (state.workspaceMode === 'create-ground-target' && state.selectedGroundTargetId) {
            return state.groundTargets.filter(target => target.id === state.selectedGroundTargetId);
        }
        return [];
    }

    private getVisiblePolygons(state: SimulationState): EditablePolygon[] {
        if (state.workspaceMode === 'inspect') return state.polygons;
        if (state.workspaceMode === 'draw-polygon' && state.draftPolygonId) {
            return state.polygons.filter(poly => poly.id === state.draftPolygonId);
        }
        if (state.workspaceMode === 'edit-polygon' && state.selectedPolygonId) {
            return state.polygons.filter(poly => poly.id === state.selectedPolygonId);
        }
        return [];
    }

    private updateSatellites(satellites: Map<string, SimulatedSatellite>, visible: boolean): void {
        if (!this.satelliteMesh && satellites.size > 0) {
            this.satelliteMesh = new SatelliteInstancedMesh(this.group, satellites.size);
        }
        this.satelliteMesh?.setVisible(visible);
        if (!visible) return;

        this.satellitePositions.clear();
        satellites.forEach(sat => {
            this.satellitePositions.set(
                sat.id,
                this.projectLatLon(sat.position.lat, sat.position.lon, 20)
            );
        });

        this.satelliteMesh?.updatePositions(satellites, this.satellitePositions);
    }

    private updateGroundStations(stations: GroundStation[]): void {
        this.updateGroundPointBuffers(this.groundStations, stations.map(gs => ({
            id: gs.id,
            lat: gs.lat,
            lon: gs.lon,
            active: gs.isSelected || gs.isHovered
        })));
    }

    private updateGroundTargets(targets: GroundTarget[]): void {
        this.updateGroundPointBuffers(this.groundTargets, targets.map(target => ({
            id: target.id,
            lat: target.lat,
            lon: target.lon,
            active: target.isSelected || target.isHovered
        })));
    }

    private updatePolygons(state: SimulationState): void {
        const visiblePolygons = this.getVisiblePolygons(state);
        const activeIds = new Set(visiblePolygons.map(poly => poly.id));
        const vertices: { id: string; lat: number; lon: number; active: boolean }[] = [];
        const showEditableVertices = state.workspaceMode === 'draw-polygon' || state.workspaceMode === 'edit-polygon';
        visiblePolygons.forEach(poly => {
            let line = this.polygonLines.get(poly.id);
            const renderPath = this.getRenderPolygonPath(poly);
            const points = renderPath.map(point => this.projectLatLon(point.lat, point.lon, 40));
            if (poly.isClosed && points.length > 2) points.push(points[0].clone());
            if (showEditableVertices) {
                poly.points.forEach((point, index) => {
                    vertices.push({
                        id: `${poly.id}:${index}`,
                        lat: point.lat,
                        lon: point.lon,
                        active: poly.isSelected || poly.isHovered
                    });
                });
            }

            if (!line) {
                line = new THREE.Line(
                    new THREE.BufferGeometry(),
                    new THREE.LineBasicMaterial({
                        color: poly.isSelected ? 0x00ffff : 0x00ff88,
                        transparent: true,
                        opacity: 1,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    })
                );
                line.renderOrder = 20;
                this.polygonLines.set(poly.id, line);
                this.group.add(line);
            }

            line.visible = points.length > 1;
            line.geometry.setFromPoints(points);
            const lineMaterial = line.material as THREE.LineBasicMaterial;
            const isActive = poly.isSelected || poly.isHovered;
            lineMaterial.color.setHex(isActive ? 0x7cffb4 : 0x42ff94);
            lineMaterial.opacity = isActive ? 1 : 0.82;

            let fill = this.polygonFills.get(poly.id);
            if (!fill) {
                fill = new THREE.Mesh(
                    new THREE.BufferGeometry(),
                    new THREE.MeshBasicMaterial({
                        color: 0x00ffff,
                        transparent: true,
                        opacity: 0.12,
                        depthWrite: false,
                        side: THREE.DoubleSide,
                        blending: THREE.NormalBlending
                    })
                );
                fill.renderOrder = 18;
                fill.userData.polygonId = poly.id;
                this.polygonFills.set(poly.id, fill);
                this.group.add(fill);
            }

            const shouldFill = poly.isClosed || renderPath.length >= 3;
            const fillGeometry = shouldFill ? this.buildPolygonFillGeometry(renderPath, 38) : null;
            if (fillGeometry) {
                fill.geometry.dispose();
                fill.geometry = fillGeometry;
                fill.visible = true;
                const fillMaterial = fill.material as THREE.MeshBasicMaterial;
                fillMaterial.color.setHex(isActive ? 0x1abf78 : 0x118b5b);
                fillMaterial.opacity = isActive ? 0.42 : 0.28;
            } else {
                fill.visible = false;
            }
        });

        this.updateGroundPointBuffers(this.polygonVertices, vertices);
        this.updateDraftPolygonPreviewLine(state);

        this.polygonLines.forEach((line, id) => {
            if (!activeIds.has(id)) {
                this.disposeLine(line);
                this.polygonLines.delete(id);
            }
        });
        this.polygonFills.forEach((fill, id) => {
            if (!activeIds.has(id)) {
                this.group.remove(fill);
                fill.geometry.dispose();
                (fill.material as THREE.Material).dispose();
                this.polygonFills.delete(id);
            }
        });
    }

    private updateDraftPolygonPreviewLine(state: SimulationState): void {
        const draft = state.workspaceMode === 'draw-polygon' && state.draftPolygonId
            ? state.polygons.find(poly => poly.id === state.draftPolygonId)
            : null;

        if (!draft || draft.points.length === 0 || !this.draftPolygonPreviewLatLon) {
            if (this.draftPreviewLine) this.draftPreviewLine.visible = false;
            return;
        }

        const lastPoint = draft.points[draft.points.length - 1];
        if (
            Math.abs(lastPoint.lat - this.draftPolygonPreviewLatLon.lat) < 0.0001
            && Math.abs(lastPoint.lon - this.draftPolygonPreviewLatLon.lon) < 0.0001
        ) {
            if (this.draftPreviewLine) this.draftPreviewLine.visible = false;
            return;
        }

        if (!this.draftPreviewLine) {
            this.draftPreviewLine = new THREE.Line(
                new THREE.BufferGeometry(),
                new THREE.LineBasicMaterial({
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.95,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                })
            );
            this.draftPreviewLine.renderOrder = 52;
            this.group.add(this.draftPreviewLine);
        }

        this.draftPreviewLine.geometry.setFromPoints([
            this.projectLatLon(lastPoint.lat, lastPoint.lon, 52),
            this.projectLatLon(this.draftPolygonPreviewLatLon.lat, this.draftPolygonPreviewLatLon.lon, 52)
        ]);
        this.draftPreviewLine.visible = true;
    }

    private getRenderPolygonPath(poly: EditablePolygon): { lat: number; lon: number }[] {
        if (poly.isClosed || !this.draftPolygonPreviewLatLon || poly.points.length === 0) return poly.points;
        const duplicate = poly.points.some(point =>
            Math.abs(point.lat - this.draftPolygonPreviewLatLon!.lat) < 0.0001
            && Math.abs(point.lon - this.draftPolygonPreviewLatLon!.lon) < 0.0001
        );
        return duplicate ? poly.points : [...poly.points, this.draftPolygonPreviewLatLon];
    }

    private updateOrbitPaths(state: SimulationState): void {
        const activeIds = new Set<string>();
        if (state.selectedSatelliteId) activeIds.add(state.selectedSatelliteId);
        if (state.hoveredSatelliteId) activeIds.add(state.hoveredSatelliteId);

        activeIds.forEach(id => {
            const sat = state.satellites.get(id);
            if (!sat?.orbitPath?.length) return;

            let line = this.orbitLines.get(id);
            const points = this.buildWrappedPolylineSegments(sat.orbitPath, 12);
            if (!line) {
                line = new THREE.LineSegments(
                    new THREE.BufferGeometry(),
                    new THREE.LineBasicMaterial({
                        transparent: true,
                        opacity: 0.75,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    })
                );
                line.renderOrder = 10;
                this.orbitLines.set(id, line);
                this.group.add(line);
            }
            line.geometry.setFromPoints(points);
            (line.material as THREE.LineBasicMaterial).color.copy(getSatelliteColor(sat.category, sat.id));
            line.visible = points.length > 0;
        });

        this.orbitLines.forEach((line, id) => {
            if (!activeIds.has(id)) line.visible = false;
        });
    }

    private updateCommunicationLinks(state: SimulationState, forceRefresh = false): void {
        if (!state.showCommLinks) {
            this.commLines.forEach(line => { line.visible = false; });
            return;
        }

        const now = performance.now();
        if (!forceRefresh && now - this.lastCommRefreshMs < 120 && this.commLines.size > 0) return;
        this.lastCommRefreshMs = now;

        const activeGsIds = new Set<string>();
        state.groundStations.forEach(gs => {
            const bestLink = findBestVisibleSatellite(gs, state.satellites.values());
            if (!bestLink) return;
            const sat = bestLink.satellite;
            activeGsIds.add(gs.id);

            let line = this.commLines.get(gs.id);
            if (!line) {
                line = new THREE.LineSegments(
                    new THREE.BufferGeometry(),
                    new THREE.LineBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.65,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    })
                );
                line.renderOrder = 14;
                this.commLines.set(gs.id, line);
                this.group.add(line);
            }

            const isSelected = gs.id === state.selectedGroundStationId || sat.id === state.selectedSatelliteId;
            const points = this.buildWrappedSegment(
                { lat: gs.lat, lon: gs.lon },
                { lat: sat.position.lat, lon: sat.position.lon },
                16
            );
            line.geometry.setFromPoints(points);
            line.visible = points.length > 0;
            const material = line.material as THREE.LineBasicMaterial;
            material.color.setHex(isSelected ? 0x00ffff : 0x00ff88);
            material.opacity = isSelected ? 0.95 : 0.65;
        });

        this.commLines.forEach((line, gsId) => {
            if (!activeGsIds.has(gsId)) line.visible = false;
        });
    }

    private updateCoverageAreas(state: SimulationState, forceRefresh = false): void {
        if (!state.showGSNCoverage) {
            this.coverageLines.forEach(line => { line.visible = false; });
            this.coverageFills.forEach(fill => { fill.visible = false; });
            return;
        }

        const now = performance.now();
        if (!forceRefresh && now - this.lastCoverageRefreshMs < 120 && this.coverageLines.size > 0) return;
        this.lastCoverageRefreshMs = now;

        const activeGsIds = new Set<string>();
        state.groundStations.forEach(gs => {
            const bestLink = findBestVisibleSatellite(gs, state.satellites.values());
            if (!bestLink) return;

            activeGsIds.add(gs.id);
            const footprint = buildCoverageFootprint(gs, bestLink.coverageCentralAngleRad, 144);
            let line = this.coverageLines.get(gs.id);
            let fill = this.coverageFills.get(gs.id);
            if (!line) {
                line = new THREE.LineSegments(
                    new THREE.BufferGeometry(),
                    new THREE.LineBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.32,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    })
                );
                line.renderOrder = 13;
                this.coverageLines.set(gs.id, line);
                this.group.add(line);
            }
            if (!fill) {
                fill = new THREE.Mesh(
                    new THREE.BufferGeometry(),
                    new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.13,
                        depthWrite: false,
                        side: THREE.DoubleSide,
                        blending: THREE.NormalBlending
                    })
                );
                fill.renderOrder = 12;
                this.coverageFills.set(gs.id, fill);
                this.group.add(fill);
            }

            const fillGeometry = this.buildCoverageFillGeometry(footprint, 12.5);
            if (fillGeometry) {
                fill.geometry.dispose();
                fill.geometry = fillGeometry;
                fill.visible = true;
                const fillMaterial = fill.material as THREE.MeshBasicMaterial;
                fillMaterial.color.setHex(gs.id === state.selectedGroundStationId ? 0x00ffff : 0x00ff88);
                fillMaterial.opacity = gs.id === state.selectedGroundStationId ? 0.2 : 0.13;
            } else {
                fill.visible = false;
            }

            const points = this.buildWrappedPolylineSegments(footprint, 13);
            line.geometry.setFromPoints(points);
            line.visible = points.length > 0;
            const material = line.material as THREE.LineBasicMaterial;
            material.color.setHex(gs.id === state.selectedGroundStationId ? 0x00ffff : 0x00ff88);
            material.opacity = gs.id === state.selectedGroundStationId ? 0.62 : 0.28;
        });

        this.coverageLines.forEach((line, id) => {
            if (!activeGsIds.has(id)) line.visible = false;
        });
        this.coverageFills.forEach((fill, id) => {
            if (!activeGsIds.has(id)) fill.visible = false;
        });
    }

    private buildWrappedSegment(a: { lat: number; lon: number }, b: { lat: number; lon: number }, z: number): THREE.Vector3[] {
        if (Math.abs(a.lon - b.lon) > 180) return [];
        return [
            this.projectLatLon(a.lat, a.lon, z),
            this.projectLatLon(b.lat, b.lon, z)
        ];
    }

    private buildWrappedPolylineSegments(path: { lat: number; lon: number }[], z: number): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        for (let i = 1; i < path.length; i++) {
            const prev = path[i - 1];
            const current = path[i];
            if (Math.abs(current.lon - prev.lon) > 180) continue;
            points.push(
                this.projectLatLon(prev.lat, prev.lon, z),
                this.projectLatLon(current.lat, current.lon, z)
            );
        }
        return points;
    }

    private buildCoverageFillGeometry(path: { lat: number; lon: number }[], z: number): THREE.BufferGeometry | null {
        if (path.length < 3) return null;
        for (let i = 1; i < path.length; i++) {
            if (Math.abs(path[i].lon - path[i - 1].lon) > 180) return null;
        }
        const shape = new THREE.Shape();
        path.forEach((point, index) => {
            const projected = this.projectLatLon(point.lat, point.lon, z);
            if (index === 0) shape.moveTo(projected.x, projected.y);
            else shape.lineTo(projected.x, projected.y);
        });
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.translate(0, 0, z);
        return geometry;
    }

    private buildPolygonFillGeometry(path: { lat: number; lon: number }[], z: number): THREE.BufferGeometry | null {
        if (path.length < 3) return null;
        for (let i = 1; i < path.length; i++) {
            if (Math.abs(path[i].lon - path[i - 1].lon) > 180) return null;
        }
        const shape = new THREE.Shape();
        path.forEach((point, index) => {
            const projected = this.projectLatLon(point.lat, point.lon, 0);
            if (index === 0) shape.moveTo(projected.x, projected.y);
            else shape.lineTo(projected.x, projected.y);
        });
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.translate(0, 0, z);
        return geometry;
    }

    private createGroundPointLayer(texture: THREE.Texture, size: number, z: number, colorHex: number): GroundPointBuffers {
        const capacity = 512;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
        const material = new THREE.PointsMaterial({
            size,
            map: texture,
            vertexColors: true,
            transparent: true,
            alphaTest: 0.05,
            sizeAttenuation: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const points = new THREE.Points(geometry, material);
        points.position.z = z;
        points.frustumCulled = false;
        this.group.add(points);
        return {
            geometry,
            points,
            ids: [],
            capacity,
            color: new THREE.Color(colorHex),
            activeColor: new THREE.Color(0xffffff)
        };
    }

    private updateGroundPointBuffers(
        layer: GroundPointBuffers,
        points: { id: string; lat: number; lon: number; active: boolean }[]
    ): void {
        const posAttr = layer.geometry.getAttribute('position') as THREE.BufferAttribute;
        const colorAttr = layer.geometry.getAttribute('color') as THREE.BufferAttribute;
        const count = Math.min(points.length, layer.capacity);
        for (let i = 0; i < count; i++) {
            const point = points[i];
            const pos = this.projectLatLon(point.lat, point.lon, 0);
            posAttr.setXYZ(i, pos.x, pos.y, pos.z);
            const color = point.active ? layer.activeColor : layer.color;
            colorAttr.setXYZ(i, color.r, color.g, color.b);
            layer.ids[i] = point.id;
        }
        layer.ids.length = count;
        layer.geometry.setDrawRange(0, count);
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
    }

    private pickGroundPoint(raycaster: THREE.Raycaster, layer: GroundPointBuffers): string | null {
        const hit = raycaster.intersectObject(layer.points, false)[0];
        if (!hit || hit.index === undefined) return null;
        return layer.ids[hit.index] || null;
    }

    private destroyGroundPointLayer(layer: GroundPointBuffers): void {
        this.group.remove(layer.points);
        layer.geometry.dispose();
        (layer.points.material as THREE.Material).dispose();
    }

    private createGroundStationTexture(): THREE.Texture {
        return this.createPointTexture('#00ff88', true);
    }

    private createGroundTargetTexture(): THREE.Texture {
        return this.createPointTexture('#ffcc00', false);
    }

    private createPolygonVertexTexture(): THREE.Texture {
        return this.createPointTexture('#00ffff', true);
    }

    private createPointTexture(color: string, ring: boolean): THREE.Texture {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 46);
        gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
        gradient.addColorStop(0.22, color);
        gradient.addColorStop(0.58, 'rgba(0,255,180,0.12)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(64, 64, ring ? 30 : 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(64, 64, ring ? 42 : 34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (!ring) {
            ctx.beginPath();
            ctx.moveTo(64, 22);
            ctx.lineTo(92, 78);
            ctx.lineTo(36, 78);
            ctx.closePath();
            ctx.stroke();
        }
        return new THREE.CanvasTexture(canvas);
    }

    private disposeLine(line: THREE.Line | THREE.LineSegments): void {
        this.group.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
    }
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import gsap from 'gsap';
import { EarthScene } from './EarthScene';
import { SatelliteInstancedMesh } from './SatelliteInstancedMesh';
import { GroundStationLayer } from './GroundStationMesh';
import { FlatMapLayer } from './FlatMapLayer';
import { MapLibreBaseLayer } from './MapLibreBaseLayer';
import type { EditablePolygon, SimulatedSatellite } from '../modules/types';
import { simulationStore } from '../stores/simulationStore';
import { getSunPosition } from '../utils/sunUtils';
import { getSatelliteColor } from '../utils/satelliteUtils';
import { latLonToVector3 } from '../utils/coordUtils';
import { calculateCoveringFlatBounds } from '../utils/mapProjection';
import {
    buildCoverageFootprint,
    calculateCoverageCentralAngleRad,
    calculateElevationDeg,
    findBestVisibleSatellite
} from '../utils/visibilityUtils';

type VisibilityTargetKind = 'ground-station' | 'point-target' | 'area-of-interest';

interface VisibilityTarget {
    id: string;
    kind: VisibilityTargetKind;
    label: string;
    position: THREE.Vector3;
    lat: number;
    lon: number;
    minElevationDeg: number;
    groundStation?: any;
}

type EditableDragTarget =
    | { kind: 'ground-station'; id: string; lastLatLon: { lat: number; lon: number }; moved: boolean }
    | { kind: 'ground-target'; id: string; lastLatLon: { lat: number; lon: number }; moved: boolean }
    | { kind: 'polygon'; id: string; lastLatLon: { lat: number; lon: number }; moved: boolean };

export class SatelliteSimulation {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private flatCamera: THREE.OrthographicCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private earth: EarthScene;
    private flatMap: FlatMapLayer;
    private mapLibreBase: MapLibreBaseLayer;
    private spaceBackground: THREE.Texture | THREE.CubeTexture | THREE.Color | null = null;
    private instancedMesh: SatelliteInstancedMesh | null = null;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();
    private container: HTMLElement;
    private focusedModel: THREE.Group | null = null;
    private activeModelSatId: string | null = null;
    private orbitPathLines: Map<string, THREE.Line> = new Map();
    private aoi3dLines: Map<string, THREE.Line> = new Map();
    private aoi3dFills: Map<string, THREE.Mesh> = new Map();
    private aoi3dGeometrySignatures: Map<string, string> = new Map();
    private isZoomed: boolean = false;
    private lastSelectedSatId: string | null = null;
    private lastSelectedGsId: string | null = null;
    private defaultCameraDistance = 45000;
    private groundStationLayer: GroundStationLayer | null = null;
    private sunLight: THREE.DirectionalLight;
    private boundResize: () => void;
    private boundClick: (e: MouseEvent) => void;
    private boundMouseMove: (e: MouseEvent) => void;
    private boundMouseDown: (e: MouseEvent) => void;
    private boundMouseUp: () => void;
    private boundWheel: (e: WheelEvent) => void;
    private lastFollowSatPos: THREE.Vector3 | null = null;
    private flatBounds = calculateCoveringFlatBounds(1, 1);
    private isFlatDragging = false;
    private flatDragMoved = false;
    private flatDragLast: THREE.Vector2 = new THREE.Vector2();
    private editableDragTarget: EditableDragTarget | null = null;
    private suppressNextFlatClick = false;
    private lastGroundStationSignature = '';

    private visibilityCones: Map<string, THREE.Mesh> = new Map();
    private gsCoverageMeshes: Map<string, THREE.LineSegments> = new Map();
    private visibilityTargets: VisibilityTarget[] = [];
    private visibilityTargetById: Map<string, VisibilityTarget> = new Map();
    private activeVisibilityLinks: Map<string, { targetId: string; elevationDeg: number; distanceSq: number; centralAngleRad: number }> = new Map();
    private lastVisibilityTargetSignature: string = '';
    private lastVisibilityRefreshMs: number = 0;
    private visibilityConeFrame: number = 0;

    private static readonly MAX_ACTIVE_VISIBILITY_CONES = 512;
    private static readonly VISIBILITY_REFRESH_MS = 250;
    private static readonly MAX_FLAT_ZOOM = 6;

    constructor(container: HTMLElement, private readonly onlineMapEnabled: boolean) {
        this.container = container;
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 10, 2000000);
        this.camera.position.set(12000, 12000, 24000);
        const flatBounds = calculateCoveringFlatBounds(container.clientWidth, container.clientHeight);
        this.flatBounds = flatBounds;
        this.flatCamera = new THREE.OrthographicCamera(
            -flatBounds.width / 2,
            flatBounds.width / 2,
            flatBounds.height / 2,
            -flatBounds.height / 2,
            1,
            100000
        );
        this.flatCamera.position.set(0, 0, 20000);
        this.flatCamera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true,
            logarithmicDepthBuffer: true // Anti-flicker for space scale
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 7500;
        this.controls.maxDistance = 500000;

        // TRACK INTERACTION
        this.controls.addEventListener('start', () => { (this as any)._isInteracting = true; });
        this.controls.addEventListener('end', () => { (this as any)._isInteracting = false; });

        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 2);
        this.sunLight.position.set(5, 3, 5).normalize();
        this.scene.add(this.sunLight);

        this.earth = new EarthScene(this.scene, onlineMapEnabled);
        this.spaceBackground = this.scene.background as THREE.Texture | THREE.CubeTexture | THREE.Color | null;
        const earthGroup = this.earth.getGroup();
        earthGroup.name = 'earth';
        this.scene.add(earthGroup);
        this.flatMap = new FlatMapLayer(this.scene, flatBounds);
        this.mapLibreBase = new MapLibreBaseLayer(container, onlineMapEnabled);

        this.boundResize = this.onResize.bind(this);
        this.boundClick = this.onClick.bind(this);
        this.boundMouseMove = this.onMouseMove.bind(this);
        this.boundMouseDown = this.onMouseDown.bind(this);
        this.boundMouseUp = this.onMouseUp.bind(this);
        this.boundWheel = this.onWheel.bind(this);

        window.addEventListener('resize', this.boundResize);
        window.addEventListener('mouseup', this.boundMouseUp);
        this.renderer.domElement.addEventListener('click', this.boundClick);
        this.renderer.domElement.addEventListener('mousemove', this.boundMouseMove);
        this.renderer.domElement.addEventListener('mousedown', this.boundMouseDown);
        this.renderer.domElement.addEventListener('wheel', this.boundWheel, { passive: false });

        this.groundStationLayer = new GroundStationLayer(
            this.scene, this.camera, this.controls, this.renderer
        );
        const gs = simulationStore.getState().groundStations;
        this.groundStationLayer.updateStations(gs);
    }

    initSatellites(satelliteCount: number): void {
        if (this.instancedMesh) {
            this.instancedMesh.destroy();
        }
        this.instancedMesh = new SatelliteInstancedMesh(this.scene, satelliteCount);
    }

    updateSatellites(satellites: Map<string, SimulatedSatellite>): void {
        const state = simulationStore.getState();
        const hoveredId = state.hoveredSatelliteId;
        const selectedId = state.selectedSatelliteId;

        if (!this.instancedMesh) {
            if (satellites.size > 0) {
                this.initSatellites(satellites.size);
            }
            return;
        }

        if (this.instancedMesh && satellites.size > 0) {
            const activeOrbitIds = new Set<string>();
            if (selectedId) activeOrbitIds.add(selectedId);
            if (hoveredId) activeOrbitIds.add(hoveredId);

            activeOrbitIds.forEach(id => {
                const pathSat = satellites.get(id);
                if (pathSat && pathSat.orbitPath && pathSat.orbitPath.length > 0) {
                    this.updateOrbitPath(pathSat);
                }
            });

            for (const [id, line] of this.orbitPathLines.entries()) {
                if (!activeOrbitIds.has(id)) {
                    this.scene.remove(line);
                    line.geometry.dispose();
                    (line.material as THREE.Material).dispose();
                    this.orbitPathLines.delete(id);
                }
            }

            if (!selectedId) {
                this.controls.minDistance = 7500;
                this.removeFocusedModel();
            }

            const currentGs = simulationStore.getState().groundStations;
            if (this.groundStationLayer && (this as any)._lastGsCount !== currentGs.length) {
                this.groundStationLayer.updateStations(currentGs);
                (this as any)._lastGsCount = currentGs.length;
            }
        }
    }

    private resetCameraZoom() {
        const state = simulationStore.getState();
        this.lastSelectedSatId = null;
        this.lastSelectedGsId = null;
        this.lastFollowSatPos = null;
        this.isZoomed = false;

        this.cameraTween?.kill();
        this.targetTween?.kill();

        // Closer Home positions for better visibility
        const targetPos = state.viewMode === '2d' 
            ? new THREE.Vector3(0, 0, 35000) 
            : new THREE.Vector3(12000, 12000, 24000);

        this.targetTween = gsap.to(this.controls.target, {
            x: 0,
            y: 0,
            z: 0,
            duration: 1.5,
            ease: "power2.inOut"
        });

        this.cameraTween = gsap.to(this.camera.position, {
            x: targetPos.x,
            y: targetPos.y,
            z: targetPos.z,
            duration: 1.5,
            ease: "power2.inOut",
            onComplete: () => {
                this.controls.minDistance = 7500;
            }
        });
    }

    private updateFocusedModel(pos: THREE.Vector3, velocity: THREE.Vector3, satId: string, color: THREE.Color) {
        if (!this.focusedModel || this.activeModelSatId !== satId) {
            this.removeFocusedModel();
            this.focusedModel = this.createSatelliteModel(color);
            this.activeModelSatId = satId;
            this.scene.add(this.focusedModel);
        }
        this.focusedModel.position.copy(pos);
        const targetPos = pos.clone().add(velocity);
        const upVec = new THREE.Vector3(0, 0, 0).sub(pos).normalize();
        this.focusedModel.up.copy(upVec);
        this.focusedModel.lookAt(targetPos);
    }

    private createSatelliteModel(color: THREE.Color): THREE.Group {
        const group = new THREE.Group();
        const foilMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.4, metalness: 0.8 });
        const solarPanelMat = new THREE.MeshStandardMaterial({ color: 0x051024, roughness: 0.2, metalness: 0.9, side: THREE.DoubleSide });
        const silverMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.7 });
        const indicatorMat = new THREE.MeshBasicMaterial({ color: color });

        const body = new THREE.Mesh(new THREE.BoxGeometry(180, 180, 180), foilMat);
        group.add(body);

        const stripe = new THREE.Mesh(new THREE.BoxGeometry(190, 30, 190), indicatorMat);
        group.add(stripe);

        const panW = 100, panH = 260, gap = 8, numPanels = 3;
        [-1, 1].forEach(side => {
            const strutLength = 100 + (panW + gap) * numPanels;
            const strut = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, strutLength), silverMat);
            strut.rotation.z = Math.PI / 2;
            strut.position.x = side * (strutLength / 2 + 80);
            group.add(strut);

            for (let i = 0; i < numPanels; i++) {
                const panel = new THREE.Mesh(new THREE.BoxGeometry(panW, 4, panH), solarPanelMat);
                panel.position.x = side * (160 + i * (panW + gap) + panW / 2);
                panel.rotation.x = Math.PI / 12;
                group.add(panel);
            }
        });

        const dishGroup = new THREE.Group();
        dishGroup.position.set(0, 90, 0);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 50), silverMat);
        mast.position.y = 25;
        dishGroup.add(mast);
        const dish = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.5), silverMat);
        dish.position.y = 60;
        dish.rotation.x = Math.PI;
        dishGroup.add(dish);
        group.add(dishGroup);

        group.scale.set(1.5, 1.5, 1.5);
        return group;
    }

    private updateOrbitPath(sat: SimulatedSatellite) {
        if (!sat.orbitPath) return;

        const points = sat.orbitPath.map(p => latLonToVector3(p.lat, p.lon, p.alt));
        const line = this.orbitPathLines.get(sat.id);

        if (line) {
            line.geometry.setFromPoints(points);
            line.geometry.attributes.position.needsUpdate = true;
        } else {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const color = getSatelliteColor(sat.category, sat.id);
            const material = new THREE.LineBasicMaterial({
                color: color.getHex(),
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending
            });
            const orbitLine = new THREE.Line(geometry, material);
            this.orbitPathLines.set(sat.id, orbitLine);
            this.scene.add(orbitLine);
        }
    }

    private removeFocusedModel() {
        if (this.focusedModel) {
            this.scene.remove(this.focusedModel);
            this.focusedModel = null;
            this.activeModelSatId = null;
        }
    }

    private updateRaycaster(event: MouseEvent) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const activeCamera = this.getActiveCamera();
        this.raycaster.setFromCamera(this.mouse, activeCamera);
        const camDist = activeCamera.position.length();
        if (simulationStore.getState().viewMode === '2d') {
            const worldUnitsPerPixel = (this.flatCamera.right - this.flatCamera.left) / (this.container.clientWidth * this.flatCamera.zoom);
            this.raycaster.params.Points = { threshold: Math.max(36, worldUnitsPerPixel * 18) };
        } else {
            this.raycaster.params.Points = { threshold: Math.max(15, camDist / 160) };
        }
    }

    private onMouseDown(event: MouseEvent): void {
        if (simulationStore.getState().viewMode !== '2d' || event.button !== 0) return;
        this.updateRaycaster(event);
        const state = simulationStore.getState();
        if (state.workspaceMode !== 'inspect' && state.workspaceMode !== 'draw-polygon') {
            const latLon = this.getFlatLatLonFromEvent(event);
            const target = this.pickEditableFlatTarget();
            if (latLon && target) {
                this.editableDragTarget = { ...target, lastLatLon: latLon, moved: false };
                this.flatDragMoved = false;
                this.renderer.domElement.style.cursor = 'grabbing';
                return;
            }
        }
        this.isFlatDragging = true;
        this.flatDragMoved = false;
        this.flatDragLast.set(event.clientX, event.clientY);
        this.renderer.domElement.style.cursor = 'grabbing';
    }

    private onMouseUp(): void {
        if (this.editableDragTarget) {
            if (this.editableDragTarget.moved) this.suppressNextFlatClick = true;
            this.editableDragTarget = null;
        }
        this.isFlatDragging = false;
        if (simulationStore.getState().viewMode === '2d') {
            this.renderer.domElement.style.cursor = 'default';
        }
    }

    private onWheel(event: WheelEvent): void {
        if (simulationStore.getState().viewMode !== '2d') return;
        event.preventDefault();
        if (this.mapLibreBase.isActive()) {
            this.mapLibreBase.zoomByWheel(event);
            return;
        }
        const before = this.getFlatWorldPointFromEvent(event);
        const clampedDelta = Math.max(-240, Math.min(240, event.deltaY));
        const zoomFactor = Math.exp(-clampedDelta * 0.0012);
        this.flatCamera.zoom = Math.max(1, Math.min(SatelliteSimulation.MAX_FLAT_ZOOM, this.flatCamera.zoom * zoomFactor));
        this.flatCamera.updateProjectionMatrix();

        if (before) {
            const after = this.getFlatWorldPointFromEvent(event);
            if (after) {
                this.flatCamera.position.x += before.x - after.x;
                this.flatCamera.position.y += before.y - after.y;
            }
        }

        this.clampFlatCamera();
    }

    private getFlatWorldPointFromEvent(event: MouseEvent | WheelEvent): THREE.Vector3 | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        const visibleWidth = (this.flatCamera.right - this.flatCamera.left) / this.flatCamera.zoom;
        const visibleHeight = (this.flatCamera.top - this.flatCamera.bottom) / this.flatCamera.zoom;
        return new THREE.Vector3(
            this.flatCamera.position.x + ndcX * visibleWidth * 0.5,
            this.flatCamera.position.y + ndcY * visibleHeight * 0.5,
            0
        );
    }

    private getFlatLatLonFromEvent(event: MouseEvent | WheelEvent): { lat: number; lon: number } | null {
        if (this.mapLibreBase.isActive()) {
            return this.mapLibreBase.getLatLonFromClientEvent(event);
        }
        this.updateRaycaster(event as MouseEvent);
        return this.flatMap.pickMapLatLon(this.raycaster);
    }

    private pickEditableFlatTarget(): Omit<EditableDragTarget, 'lastLatLon' | 'moved'> | null {
        const gsId = this.flatMap.pickGroundStation(this.raycaster);
        if (gsId) return { kind: 'ground-station', id: gsId };

        const gtId = this.flatMap.pickGroundTarget(this.raycaster);
        if (gtId) return { kind: 'ground-target', id: gtId };

        const polygonId = this.flatMap.pickPolygon(this.raycaster);
        if (polygonId) return { kind: 'polygon', id: polygonId };

        return null;
    }

    private pickAoi3dPolygon(): string | null {
        const meshes = Array.from(this.aoi3dFills.values()).filter(mesh => mesh.visible);
        const hit = this.raycaster.intersectObjects(meshes, false)[0];
        return hit?.object.userData.polygonId || null;
    }

    private onClick(event: MouseEvent) {
        this.updateRaycaster(event);
        if (simulationStore.getState().viewMode === '2d') {
            if (this.suppressNextFlatClick) {
                this.suppressNextFlatClick = false;
                return;
            }
            if (this.flatDragMoved) {
                this.flatDragMoved = false;
                return;
            }
            this.handleFlatMapClick(event);
            return;
        }
        if (simulationStore.getState().workspaceMode !== 'inspect') {
            return;
        }
        
        const satHit = this.getIntersectedSatelliteHit();
        const gsId = this.groundStationLayer?.getIntersectedGsId(this.raycaster);
        const polygonId = this.pickAoi3dPolygon();
        const earthIntersect = this.raycaster.intersectObject(this.scene.getObjectByName('earth') || this.scene, true);
        
        // Pick the closest hit logically
        // Note: For GS, we don't have the distance here easily without refactoring GS layer, 
        // but we can assume if gsId is found, it's a valid intent.
        
        if (satHit && !gsId) {
            simulationStore.selectSatellite(satHit.id);
            simulationStore.selectGroundStation(null);
            this.lastFollowSatPos = null;
            this.isZoomed = false;
        } else if (gsId) {
            simulationStore.selectGroundStation(gsId);
            simulationStore.selectSatellite(null);
            simulationStore.selectPolygon(null);
            this.lastFollowSatPos = null;
            this.isZoomed = false;
            this.lastSelectedSatId = null;
            this.removeFocusedModel();
        } else if (polygonId) {
            simulationStore.selectPolygon(polygonId);
            simulationStore.selectSatellite(null);
            simulationStore.selectGroundStation(null);
            this.lastFollowSatPos = null;
            this.isZoomed = false;
            this.lastSelectedSatId = null;
            this.removeFocusedModel();
        } else if (earthIntersect.length > 0) {
            // Clicked on Earth -> Do nothing, don't reset camera
        } else {
            // Clicked on empty space -> Reset only if something was selected
            const state = simulationStore.getState();
            if (state.selectedSatelliteId || state.selectedGroundStationId || state.selectedPolygonId) {
                simulationStore.selectSatellite(null);
                simulationStore.selectGroundStation(null);
                simulationStore.selectPolygon(null);
                this.resetCameraZoom();
            }
            this.lastFollowSatPos = null;
        }
    }

    private onMouseMove(event: MouseEvent) {
        if (simulationStore.getState().viewMode === '2d' && this.editableDragTarget) {
            this.updateRaycaster(event);
            const latLon = this.getFlatLatLonFromEvent(event);
            if (!latLon) return;
            const deltaLat = latLon.lat - this.editableDragTarget.lastLatLon.lat;
            const deltaLon = latLon.lon - this.editableDragTarget.lastLatLon.lon;
            if (Math.abs(deltaLat) + Math.abs(deltaLon) > 0.000001) {
                this.editableDragTarget.moved = true;
                this.flatDragMoved = true;
                if (this.editableDragTarget.kind === 'ground-station') {
                    simulationStore.moveGroundStation(this.editableDragTarget.id, latLon.lat, latLon.lon);
                } else if (this.editableDragTarget.kind === 'ground-target') {
                    simulationStore.moveGroundTarget(this.editableDragTarget.id, latLon.lat, latLon.lon);
                } else {
                    simulationStore.movePolygonByDelta(this.editableDragTarget.id, deltaLat, deltaLon);
                }
                this.editableDragTarget.lastLatLon = latLon;
            }
            this.renderer.domElement.style.cursor = 'grabbing';
            return;
        }

        if (simulationStore.getState().viewMode === '2d' && this.isFlatDragging) {
            const dx = event.clientX - this.flatDragLast.x;
            const dy = event.clientY - this.flatDragLast.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) this.flatDragMoved = true;
            if (this.mapLibreBase.isActive()) {
                this.mapLibreBase.panBy(-dx, -dy);
                this.flatDragLast.set(event.clientX, event.clientY);
                return;
            }
            const unitsPerPixelX = (this.flatCamera.right - this.flatCamera.left) / (this.container.clientWidth * this.flatCamera.zoom);
            const unitsPerPixelY = (this.flatCamera.top - this.flatCamera.bottom) / (this.container.clientHeight * this.flatCamera.zoom);
            this.flatCamera.position.x -= dx * unitsPerPixelX;
            this.flatCamera.position.y += dy * unitsPerPixelY;
            this.flatDragLast.set(event.clientX, event.clientY);
            this.clampFlatCamera();
            return;
        }

        this.updateRaycaster(event);
        if (simulationStore.getState().viewMode === '2d') {
            this.handleFlatMapMouseMove(event);
            return;
        }

        if (simulationStore.getState().workspaceMode !== 'inspect') {
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setTooltipPos(null);
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'crosshair';
            return;
        }
        
        const satHit = this.getIntersectedSatelliteHit();
        const gsId = this.groundStationLayer?.getIntersectedGsId(this.raycaster);
        const polygonId = this.pickAoi3dPolygon();

        if (satHit) {
            simulationStore.hoverSatellite(satHit.id);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else if (gsId) {
            simulationStore.hoverGroundStation(gsId);
            simulationStore.hoverSatellite(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setGsTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else if (polygonId) {
            simulationStore.hoverPolygon(polygonId);
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
            simulationStore.setTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else {
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setTooltipPos(null);
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'default';
        }
    }

    private getIntersectedSatelliteHit(): { id: string, distance: number } | null {
        if (!this.instancedMesh) return null;
        
        const meshes = this.instancedMesh.getMeshes();
        const satIntersects = this.raycaster.intersectObjects(meshes);
        if (satIntersects.length === 0) return null;

        const firstSat = satIntersects[0];
        
        // 1. Occlusion Check: Does Earth block this satellite?
        const earthIntersect = this.raycaster.intersectObject(this.earth.getGroup(), true);
        if (earthIntersect.length > 0 && earthIntersect[0].distance < firstSat.distance) {
            return null; // Earth is in front
        }

        const mesh = firstSat.object as any;
        const index = firstSat.index;

        if (index !== undefined && mesh.category) {
            const id = this.instancedMesh.getSatelliteId(mesh.category, index);
            if (id) return { id, distance: firstSat.distance };
        }
        return null;
    }

    private onResize(): void {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        const flatBounds = calculateCoveringFlatBounds(this.container.clientWidth, this.container.clientHeight);
        this.flatBounds = flatBounds;
        this.flatCamera.left = -flatBounds.width / 2;
        this.flatCamera.right = flatBounds.width / 2;
        this.flatCamera.top = flatBounds.height / 2;
        this.flatCamera.bottom = -flatBounds.height / 2;
        this.flatCamera.updateProjectionMatrix();
        this.flatMap.applyBounds(flatBounds);
        this.mapLibreBase.resize();
        this.clampFlatCamera();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    private getActiveCamera(): THREE.Camera {
        return simulationStore.getState().viewMode === '2d' ? this.flatCamera : this.camera;
    }

    private clampFlatCamera(): void {
        const visibleWidth = (this.flatCamera.right - this.flatCamera.left) / this.flatCamera.zoom;
        const visibleHeight = (this.flatCamera.top - this.flatCamera.bottom) / this.flatCamera.zoom;
        const maxX = Math.max(0, (this.flatBounds.width - visibleWidth) / 2);
        const maxY = Math.max(0, (this.flatBounds.height - visibleHeight) / 2);
        this.flatCamera.position.x = Math.max(-maxX, Math.min(maxX, this.flatCamera.position.x));
        this.flatCamera.position.y = Math.max(-maxY, Math.min(maxY, this.flatCamera.position.y));
    }

    private handleFlatMapClick(event: MouseEvent): void {
        const state = simulationStore.getState();
        const latLon = this.getFlatLatLonFromEvent(event);

        if (state.workspaceMode === 'create-ground-station' && latLon) {
            simulationStore.createGroundStationAt(latLon.lat, latLon.lon);
            return;
        }
        if (state.workspaceMode === 'create-ground-target' && latLon) {
            simulationStore.createGroundTargetAt(latLon.lat, latLon.lon);
            return;
        }
        if (state.workspaceMode === 'draw-polygon' && latLon) {
            if (event.detail >= 2) {
                simulationStore.addPolygonPoint(latLon.lat, latLon.lon);
                simulationStore.finishDraftPolygon();
                this.flatMap.setDraftPolygonPreviewLatLon(null);
                return;
            }
            simulationStore.addPolygonPoint(latLon.lat, latLon.lon);
            return;
        }
        if (state.workspaceMode !== 'inspect') {
            return;
        }

        const satId = this.flatMap.pickSatellite(this.raycaster);
        const gsId = this.flatMap.pickGroundStation(this.raycaster);
        const gtId = this.flatMap.pickGroundTarget(this.raycaster);
        const polygonId = this.flatMap.pickPolygon(this.raycaster);

        if (satId && !gsId) {
            simulationStore.selectSatellite(satId);
            simulationStore.selectGroundStation(null);
            simulationStore.selectGroundTarget(null);
            simulationStore.selectPolygon(null);
            simulationStore.setViewMode('3d');
            this.lastFollowSatPos = null;
            this.isZoomed = false;
            this.lastSelectedSatId = null;
        } else if (gsId) {
            simulationStore.selectGroundStation(gsId);
            simulationStore.selectSatellite(null);
            simulationStore.selectGroundTarget(null);
            simulationStore.selectPolygon(null);
        } else if (gtId) {
            simulationStore.selectGroundTarget(gtId);
            simulationStore.selectGroundStation(null);
            simulationStore.selectSatellite(null);
            simulationStore.selectPolygon(null);
        } else if (polygonId) {
            simulationStore.selectPolygon(polygonId);
            simulationStore.selectGroundTarget(null);
            simulationStore.selectGroundStation(null);
            simulationStore.selectSatellite(null);
        } else {
            simulationStore.selectSatellite(null);
            simulationStore.selectGroundStation(null);
            simulationStore.selectGroundTarget(null);
            simulationStore.selectPolygon(null);
        }
    }

    private handleFlatMapMouseMove(event: MouseEvent): void {
        const state = simulationStore.getState();
        const latLon = this.getFlatLatLonFromEvent(event);

        if (state.workspaceMode !== 'inspect') {
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverGroundTarget(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setTooltipPos(null);
            simulationStore.setGsTooltipPos(null);
            this.flatMap.setDraftPolygonPreviewLatLon(state.workspaceMode === 'draw-polygon' ? latLon : null);
            const editableTarget = state.workspaceMode === 'draw-polygon' ? null : this.pickEditableFlatTarget();
            this.renderer.domElement.style.cursor = editableTarget ? 'grab' : (latLon ? 'crosshair' : 'default');
            return;
        }

        this.flatMap.setDraftPolygonPreviewLatLon(null);
        const satId = this.flatMap.pickSatellite(this.raycaster);
        const gsId = this.flatMap.pickGroundStation(this.raycaster);
        const gtId = this.flatMap.pickGroundTarget(this.raycaster);
        const polygonId = this.flatMap.pickPolygon(this.raycaster);

        if (satId && state.workspaceMode === 'inspect') {
            simulationStore.hoverSatellite(satId);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverGroundTarget(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else if (gsId && state.workspaceMode === 'inspect') {
            simulationStore.hoverGroundStation(gsId);
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundTarget(null);
            simulationStore.hoverPolygon(null);
            simulationStore.setGsTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else if (polygonId && state.workspaceMode === 'inspect') {
            simulationStore.hoverPolygon(polygonId);
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverGroundTarget(null);
            simulationStore.setTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else {
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
            simulationStore.hoverGroundTarget(gtId && state.workspaceMode === 'inspect' ? gtId : null);
            simulationStore.hoverPolygon(null);
            simulationStore.setTooltipPos(null);
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = state.workspaceMode === 'inspect' && !gtId ? 'default' : 'crosshair';
        }
    }

    private lastViewMode: string = '3d';
    private satCartesianPositions: Map<string, THREE.Vector3> = new Map();
    private cameraTween: gsap.core.Tween | null = null;
    private targetTween: gsap.core.Tween | null = null;

    public tick(): void {
        const state = simulationStore.getState();
        const is2d = state.viewMode === '2d';
        const sunPos = getSunPosition(state.simulationTime);
        const mapLibreActive = this.mapLibreBase.setVisible(is2d, state.selectedMap);
        const onlineFlatBasePreferred = is2d && this.onlineMapEnabled;

        this.scene.background = (mapLibreActive || onlineFlatBasePreferred) ? null : this.spaceBackground;
        this.earth.getGroup().visible = !is2d;
        this.flatMap.setVisible(is2d);
        this.flatMap.setExternalBaseProjection(
            onlineFlatBasePreferred,
            mapLibreActive ? ((lat, lon, z, bounds) => this.mapLibreBase.project(lat, lon, z, bounds)) : null
        );
        this.controls.enabled = !is2d;
        this.instancedMesh?.setVisible(!is2d);
        this.groundStationLayer?.setVisible(!is2d);
        this.orbitPathLines.forEach(line => { line.visible = !is2d; });
        if (state.workspaceMode !== 'inspect') {
            this.visibilityCones.forEach(cone => { cone.visible = false; });
            this.gsCoverageMeshes.forEach(mesh => { mesh.visible = false; });
        } else {
            this.visibilityCones.forEach(cone => { cone.visible = !is2d && cone.visible; });
            this.gsCoverageMeshes.forEach(mesh => { mesh.visible = !is2d && mesh.visible; });
        }

        if (is2d) {
            this.removeFocusedModel();
            this.hideAoi3dLayer();
            if (mapLibreActive) {
                this.flatCamera.position.set(0, 0, 20000);
                this.flatCamera.zoom = 1;
                this.flatCamera.updateProjectionMatrix();
            }
            this.flatMap.update(state, sunPos, this.flatCamera);
            this.renderer.render(this.scene, this.flatCamera);
            return;
        }

        // 1. Scene Transition (2D/3D via GSAP)
        if (state.viewMode !== this.lastViewMode) {
            this.lastViewMode = state.viewMode;
            
            const targetPos = state.viewMode === '2d' 
                ? new THREE.Vector3(0, 0, 35000) 
                : new THREE.Vector3(12000, 12000, 24000);
            
            this.cameraTween?.kill();
            this.targetTween?.kill();

            this.cameraTween = gsap.to(this.camera.position, {
                x: targetPos.x,
                y: targetPos.y,
                z: targetPos.z,
                duration: 1.5,
                ease: "power2.inOut"
            });

            this.targetTween = gsap.to(this.controls.target, {
                x: 0, y: 0, z: 0,
                duration: 1.5,
                ease: "power2.inOut"
            });
        }

        // 2. PRE-CALCULATE COORDINATES (Single Pass)
        this.satCartesianPositions.clear();
        state.satellites.forEach((sat: SimulatedSatellite) => {
            if (sat.position) {
                this.satCartesianPositions.set(
                    sat.id, 
                    latLonToVector3(sat.position.lat, sat.position.lon, sat.position.alt)
                );
            }
        });

        // 3. Selection & Tracking Logic
        const selectedId = state.selectedSatelliteId;
        const selectedGsId = state.selectedGroundStationId;

        if (selectedId) {
            const sat = state.satellites.get(selectedId);
            const pos = this.satCartesianPositions.get(selectedId);
            const propagator = simulationStore.getPropagators().get(selectedId);

            if (sat && pos && propagator) {
                const satColor = getSatelliteColor(sat.category, sat.id);

                // High-precision orientation (Lookahead +1s)
                const lookaheadTime = new Date(state.simulationTime.getTime() + 1000);
                const nextLla = propagator.propagate(lookaheadTime);
                let velocityVector = new THREE.Vector3(1, 0, 0);
                if (nextLla) {
                    const nextPos = latLonToVector3(nextLla.lat, nextLla.lon, nextLla.alt);
                    velocityVector.copy(nextPos).sub(pos).normalize();
                }

                this.updateFocusedModel(pos, velocityVector, sat.id, satColor);

                if (this.lastSelectedSatId !== selectedId) {
                    this.lastSelectedSatId = selectedId;
                    this.lastSelectedGsId = null;
                    this.isZoomed = false;
                    this.controls.minDistance = 500; // Allow close zoom
                    
                    // Smooth Jump to Satellite using GSAP
                    this.cameraTween?.kill();
                    this.targetTween?.kill();
                    
                    const upDir = pos.clone().normalize();
                    const desiredCamPos = pos.clone().add(upDir.multiplyScalar(10000));
                    
                    this.targetTween = gsap.to(this.controls.target, {
                        x: pos.x, y: pos.y, z: pos.z,
                        duration: 1.2,
                        ease: "power3.out"
                    });
                    
                    this.cameraTween = gsap.to(this.camera.position, {
                        x: desiredCamPos.x, y: desiredCamPos.y, z: desiredCamPos.z,
                        duration: 1.2,
                        ease: "power3.out",
                        onComplete: () => { this.isZoomed = true; }
                    });
                } else if (this.isZoomed && !(this as any)._isInteracting) {
                    // Constant Update (Sync with prop) ONLY IF NOT INTERACTING
                    const lastSatPos = this.lastFollowSatPos || pos.clone();
                    this.lastFollowSatPos = pos.clone();
                    
                    const v1 = lastSatPos.clone().normalize();
                    const v2 = pos.clone().normalize();
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(v1, v2);
                    
                    this.camera.position.applyQuaternion(quaternion);
                    this.controls.target.copy(pos);
                }
            }
        } else if (selectedGsId) {
            const gs = state.groundStations?.find((g: any) => g.id === selectedGsId);
            if (gs) {
                const pos = latLonToVector3(gs.lat, gs.lon, 35);
                if (this.lastSelectedGsId !== selectedGsId) {
                    this.lastSelectedGsId = selectedGsId;
                    this.lastSelectedSatId = null;
                    this.isZoomed = false;
                    this.controls.minDistance = 500;

                    this.cameraTween?.kill();
                    this.targetTween?.kill();

                    const upDir = pos.clone().normalize();
                    const targetCamPos = pos.clone().add(upDir.multiplyScalar(10000));

                    this.targetTween = gsap.to(this.controls.target, {
                        x: pos.x, y: pos.y, z: pos.z,
                        duration: 1.5,
                        ease: "power2.inOut"
                    });

                    this.cameraTween = gsap.to(this.camera.position, {
                        x: targetCamPos.x, y: targetCamPos.y, z: targetCamPos.z,
                        duration: 1.5,
                        ease: "power2.inOut",
                        onComplete: () => { this.isZoomed = true; }
                    });
                }
            }
        } else {
            if (this.lastSelectedSatId || this.lastSelectedGsId) {
                this.lastSelectedSatId = null;
                this.lastSelectedGsId = null;
                this.removeFocusedModel();
            }
        }

        this.controls.update();

        // 4. Update Layers using the cached positions
        this.sunLight.position.copy(sunPos).multiplyScalar(100000);

        this.earth.update(this.camera.position, state.visibleLayers, state.selectedMap, state.showDayNightLayer, sunPos);
        
        if (this.instancedMesh) {
            this.instancedMesh.updatePositions(state.satellites, this.satCartesianPositions);
        }

        this.updateSimulationLayers(state, this.satCartesianPositions);
        this.updateAoi3dLayer(state);
        this.syncGroundStationLayer(state.groundStations);
        this.groundStationLayer?.tick(null, this.satCartesianPositions);

        this.renderer.render(this.scene, this.camera);
    }

    private updateAoi3dLayer(state: any): void {
        const visiblePolygons = this.getVisibleAoi3dPolygons(state);
        const activeIds = new Set(visiblePolygons.map(poly => poly.id));

        visiblePolygons.forEach(poly => {
            const geometrySignature = poly.points
                .map(point => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`)
                .join('|');
            const geometryChanged = this.aoi3dGeometrySignatures.get(poly.id) !== geometrySignature;
            let line = this.aoi3dLines.get(poly.id);
            if (!line) {
                line = new THREE.Line(
                    new THREE.BufferGeometry(),
                    new THREE.LineBasicMaterial({
                        color: 0x00ffff,
                        transparent: true,
                        opacity: 0.9,
                        depthWrite: false,
                        depthTest: true,
                        blending: THREE.AdditiveBlending
                    })
                );
                line.renderOrder = 8;
                line.name = `aoi-outline-${poly.id}`;
                line.userData.polygonId = poly.id;
                this.aoi3dLines.set(poly.id, line);
                this.scene.add(line);
            }

            if (geometryChanged) {
                line.geometry.setFromPoints(this.buildAoi3dOutlinePoints(poly, 145));
            }
            line.visible = poly.points.length >= 3;
            const lineMaterial = line.material as THREE.LineBasicMaterial;
            const isActive = poly.isSelected || poly.isHovered;
            lineMaterial.color.setHex(isActive ? 0xa4ffd0 : 0x42ff94);
            lineMaterial.opacity = isActive ? 0.98 : 0.78;

            let fill = this.aoi3dFills.get(poly.id);
            if (!fill) {
                fill = new THREE.Mesh(
                    new THREE.BufferGeometry(),
                    new THREE.MeshBasicMaterial({
                        color: 0x2aff99,
                        transparent: true,
                        opacity: 0.24,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                        depthTest: true,
                        blending: THREE.NormalBlending
                    })
                );
                fill.renderOrder = 7;
                fill.name = `aoi-fill-${poly.id}`;
                fill.userData.polygonId = poly.id;
                this.aoi3dFills.set(poly.id, fill);
                this.scene.add(fill);
            }

            const fillGeometry = geometryChanged ? this.buildAoi3dFillGeometry(poly) : null;
            if (fillGeometry) {
                fill.geometry.dispose();
                fill.geometry = fillGeometry;
                fill.visible = true;
                this.aoi3dGeometrySignatures.set(poly.id, geometrySignature);
            } else {
                fill.visible = poly.isClosed && poly.points.length >= 3 && !!fill.geometry.getAttribute('position');
            }
            const fillMaterial = fill.material as THREE.MeshBasicMaterial;
            fillMaterial.color.setHex(isActive ? 0x4dffac : 0x2bd27f);
            fillMaterial.opacity = isActive ? 0.34 : 0.24;
        });

        this.aoi3dLines.forEach((line, id) => {
            if (!activeIds.has(id)) {
                this.scene.remove(line);
                line.geometry.dispose();
                (line.material as THREE.Material).dispose();
                this.aoi3dLines.delete(id);
                this.aoi3dGeometrySignatures.delete(id);
            }
        });
        this.aoi3dFills.forEach((fill, id) => {
            if (!activeIds.has(id)) {
                this.scene.remove(fill);
                fill.geometry.dispose();
                (fill.material as THREE.Material).dispose();
                this.aoi3dFills.delete(id);
            }
        });
    }

    private getVisibleAoi3dPolygons(state: any): EditablePolygon[] {
        const polygons = (state.polygons || []) as EditablePolygon[];
        if (state.workspaceMode === 'inspect') {
            return polygons.filter(poly => poly.isClosed && poly.points.length >= 3);
        }
        if (state.selectedPolygonId) {
            return polygons.filter(poly =>
                poly.id === state.selectedPolygonId
                && poly.isClosed
                && poly.points.length >= 3
            );
        }
        return [];
    }

    private buildAoi3dFillGeometry(poly: EditablePolygon): THREE.BufferGeometry | null {
        if (!poly.isClosed || poly.points.length < 3) return null;
        const center = this.getAoiProjectionCenter(poly);
        const projectedPath = poly.points.map(point => this.projectAoiPoint(point, center));
        const bounds = projectedPath.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            maxX: Math.max(acc.maxX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxY: Math.max(acc.maxY, point.y)
        }), {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity
        });

        const width = Math.max(0.1, bounds.maxX - bounds.minX);
        const height = Math.max(0.1, bounds.maxY - bounds.minY);
        const columns = Math.min(72, Math.max(8, Math.ceil(width / 1.5)));
        const rows = Math.min(72, Math.max(8, Math.ceil(height / 1.5)));
        const positions: number[] = [];

        for (let y = 0; y < rows; y++) {
            const y0 = bounds.minY + (height * y) / rows;
            const y1 = bounds.minY + (height * (y + 1)) / rows;
            for (let x = 0; x < columns; x++) {
                const x0 = bounds.minX + (width * x) / columns;
                const x1 = bounds.minX + (width * (x + 1)) / columns;
                const clippedCell = this.clipAoiCellToPolygon([
                    { x: x0, y: y0 },
                    { x: x1, y: y0 },
                    { x: x1, y: y1 },
                    { x: x0, y: y1 }
                ], projectedPath);
                if (clippedCell.length < 3) continue;

                for (let i = 1; i < clippedCell.length - 1; i++) {
                    this.pushAoiSurfaceTriangle(positions, center, [
                        clippedCell[0],
                        clippedCell[i],
                        clippedCell[i + 1]
                    ]);
                }
            }
        }

        if (positions.length === 0) return null;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return geometry;
    }

    private buildAoi3dOutlinePoints(poly: EditablePolygon, altitudeKm: number): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i < poly.points.length; i++) {
            const start = poly.points[i];
            const end = poly.points[(i + 1) % poly.points.length];
            const deltaLon = this.shortestDeltaLon(start.lon, end.lon);
            const steps = Math.max(2, Math.ceil(Math.max(Math.abs(end.lat - start.lat), Math.abs(deltaLon)) / 2));
            for (let step = 0; step < steps; step++) {
                const t = step / steps;
                points.push(latLonToVector3(
                    start.lat + (end.lat - start.lat) * t,
                    this.normalizeLongitude(start.lon + deltaLon * t),
                    altitudeKm
                ));
            }
        }
        if (points.length > 0) points.push(points[0].clone());
        return points;
    }

    private pushAoiSurfaceTriangle(
        positions: number[],
        center: { lat: number; lon: number; cosLat: number },
        projectedPoints: { x: number; y: number }[]
    ): void {
        projectedPoints.forEach(projected => {
            const latLon = this.unprojectAoiPoint(projected, center);
            const surface = latLonToVector3(latLon.lat, latLon.lon, 118);
            positions.push(surface.x, surface.y, surface.z);
        });
    }

    private isPointInAoiProjection(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const current = polygon[i];
            const previous = polygon[j];
            const intersects = ((current.y > point.y) !== (previous.y > point.y))
                && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
            if (intersects) inside = !inside;
        }
        return inside;
    }

    private clipAoiCellToPolygon(
        cell: { x: number; y: number }[],
        polygon: { x: number; y: number }[]
    ): { x: number; y: number }[] {
        const orientation = this.getAoiProjectionArea(polygon) >= 0 ? 1 : -1;
        let output = cell;

        for (let i = 0; i < polygon.length; i++) {
            if (output.length === 0) break;
            const edgeStart = polygon[i];
            const edgeEnd = polygon[(i + 1) % polygon.length];
            const input = output;
            output = [];

            for (let j = 0; j < input.length; j++) {
                const current = input[j];
                const previous = input[(j + input.length - 1) % input.length];
                const currentInside = this.isInsideAoiClipEdge(current, edgeStart, edgeEnd, orientation);
                const previousInside = this.isInsideAoiClipEdge(previous, edgeStart, edgeEnd, orientation);

                if (currentInside) {
                    if (!previousInside) {
                        output.push(this.getAoiClipIntersection(previous, current, edgeStart, edgeEnd));
                    }
                    output.push(current);
                } else if (previousInside) {
                    output.push(this.getAoiClipIntersection(previous, current, edgeStart, edgeEnd));
                }
            }
        }

        return output;
    }

    private getAoiProjectionArea(polygon: { x: number; y: number }[]): number {
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const current = polygon[i];
            const next = polygon[(i + 1) % polygon.length];
            area += current.x * next.y - next.x * current.y;
        }
        return area * 0.5;
    }

    private isInsideAoiClipEdge(
        point: { x: number; y: number },
        edgeStart: { x: number; y: number },
        edgeEnd: { x: number; y: number },
        orientation: number
    ): boolean {
        const cross = (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y)
            - (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
        return orientation * cross >= -1e-8;
    }

    private getAoiClipIntersection(
        segmentStart: { x: number; y: number },
        segmentEnd: { x: number; y: number },
        edgeStart: { x: number; y: number },
        edgeEnd: { x: number; y: number }
    ): { x: number; y: number } {
        const segmentDx = segmentEnd.x - segmentStart.x;
        const segmentDy = segmentEnd.y - segmentStart.y;
        const edgeDx = edgeEnd.x - edgeStart.x;
        const edgeDy = edgeEnd.y - edgeStart.y;
        const denominator = segmentDx * edgeDy - segmentDy * edgeDx;
        if (Math.abs(denominator) < 1e-8) return segmentEnd;

        const t = ((edgeStart.x - segmentStart.x) * edgeDy - (edgeStart.y - segmentStart.y) * edgeDx) / denominator;
        return {
            x: segmentStart.x + segmentDx * t,
            y: segmentStart.y + segmentDy * t
        };
    }

    private getAoiProjectionCenter(poly: EditablePolygon): { lat: number; lon: number; cosLat: number } {
        const lat = poly.points.reduce((sum, point) => sum + point.lat, 0) / poly.points.length;
        const lonVector = poly.points.reduce((sum, point) => {
            const lonRad = THREE.MathUtils.degToRad(point.lon);
            sum.x += Math.cos(lonRad);
            sum.y += Math.sin(lonRad);
            return sum;
        }, new THREE.Vector2());
        const lon = THREE.MathUtils.radToDeg(Math.atan2(lonVector.y, lonVector.x));
        return {
            lat,
            lon,
            cosLat: Math.max(0.1, Math.cos(THREE.MathUtils.degToRad(lat)))
        };
    }

    private projectAoiPoint(
        point: { lat: number; lon: number },
        center: { lat: number; lon: number; cosLat: number }
    ): { x: number; y: number } {
        return {
            x: this.shortestDeltaLon(center.lon, point.lon) * center.cosLat,
            y: point.lat - center.lat
        };
    }

    private unprojectAoiPoint(
        point: { x: number; y: number },
        center: { lat: number; lon: number; cosLat: number }
    ): { lat: number; lon: number } {
        return {
            lat: center.lat + point.y,
            lon: this.normalizeLongitude(center.lon + point.x / center.cosLat)
        };
    }

    private shortestDeltaLon(fromLon: number, toLon: number): number {
        return this.normalizeLongitude(toLon - fromLon);
    }

    private normalizeLongitude(lon: number): number {
        let normalized = lon;
        while (normalized <= -180) normalized += 360;
        while (normalized > 180) normalized -= 360;
        return normalized;
    }

    private hideAoi3dLayer(): void {
        this.aoi3dLines.forEach(line => { line.visible = false; });
        this.aoi3dFills.forEach(fill => { fill.visible = false; });
    }

    private disposeAoi3dLayer(): void {
        this.aoi3dLines.forEach(line => {
            this.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        });
        this.aoi3dLines.clear();
        this.aoi3dFills.forEach(fill => {
            this.scene.remove(fill);
            fill.geometry.dispose();
            (fill.material as THREE.Material).dispose();
        });
        this.aoi3dFills.clear();
        this.aoi3dGeometrySignatures.clear();
    }

    private syncGroundStationLayer(groundStations: any[]): void {
        const signature = groundStations
            .map(gs => `${gs.id}:${gs.lat.toFixed(5)}:${gs.lon.toFixed(5)}`)
            .join('|');
        if (signature === this.lastGroundStationSignature) return;
        this.lastGroundStationSignature = signature;
        this.groundStationLayer?.updateStations(groundStations);
    }

    private updateSimulationLayers(state: any, satPositions: Map<string, THREE.Vector3>) {
        const groundStations = state.groundStations;

        if (state.workspaceMode !== 'inspect') {
            this.visibilityCones.forEach(cone => { cone.visible = false; });
            this.gsCoverageMeshes.forEach(mesh => { mesh.visible = false; });
            return;
        }

        this.updateTargetedVisibilityCones(state, satPositions);

        if (state.showGSNCoverage) {
            const activeCoverageIds = new Set<string>();
            groundStations.forEach((gs: any) => {
                const bestLink = findBestVisibleSatellite(gs, state.satellites.values());
                if (!bestLink) return;

                activeCoverageIds.add(gs.id);
                let ring = this.gsCoverageMeshes.get(gs.id);
                if (!ring) {
                    const geometry = new THREE.BufferGeometry();
                    const material = new THREE.LineBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.45,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending
                    });
                    ring = new THREE.LineSegments(geometry, material);
                    ring.renderOrder = 9;
                    this.gsCoverageMeshes.set(gs.id, ring);
                    this.scene.add(ring);
                }

                const footprint = buildCoverageFootprint(gs, bestLink.coverageCentralAngleRad, 144);
                const points: THREE.Vector3[] = [];
                for (let i = 1; i < footprint.length; i++) {
                    const prev = footprint[i - 1];
                    const current = footprint[i];
                    if (Math.abs(current.lon - prev.lon) > 180) continue;
                    points.push(
                        latLonToVector3(prev.lat, prev.lon, 15),
                        latLonToVector3(current.lat, current.lon, 15)
                    );
                }

                ring.geometry.setFromPoints(points);
                ring.visible = points.length > 0;
                const material = ring.material as THREE.LineBasicMaterial;
                material.color.setHex(gs.id === state.selectedGroundStationId ? 0x00ffff : 0x00ff88);
                material.opacity = gs.id === state.selectedGroundStationId ? 0.85 : 0.45;
            });

            this.gsCoverageMeshes.forEach((ring, id) => {
                if (!activeCoverageIds.has(id)) ring.visible = false;
            });
        } else {
            this.gsCoverageMeshes.forEach(m => m.visible = false);
        }
    }

    private updateTargetedVisibilityCones(state: any, satPositions: Map<string, THREE.Vector3>): void {
        if (!state.showVisibilityCones) {
            this.activeVisibilityLinks.clear();
            this.visibilityCones.forEach(cone => { cone.visible = false; });
            return;
        }

        this.syncVisibilityTargets(state.groundStations || []);
        this.refreshActiveVisibilityLinks(state.satellites, satPositions);

        this.visibilityConeFrame++;

        this.activeVisibilityLinks.forEach((link, satId) => {
            const sat = state.satellites.get(satId) as SimulatedSatellite | undefined;
            const satPos = satPositions.get(satId);
            const target = this.visibilityTargetById.get(link.targetId);
            if (!sat || !satPos || !target) return;

            let cone = this.visibilityCones.get(satId);
            if (!cone) {
                cone = this.createVisibilityCone(sat);
                this.visibilityCones.set(satId, cone);
                this.scene.add(cone);
            }

            const footprint = buildCoverageFootprint(
                { lat: target.lat, lon: target.lon },
                link.centralAngleRad,
                96
            );
            const geometry = this.buildVisibilityConeGeometry(satPos, footprint);
            if (!geometry) {
                cone.visible = false;
                return;
            }

            cone.geometry.dispose();
            cone.geometry = geometry;
            cone.visible = true;
            cone.userData.activeFrame = this.visibilityConeFrame;

            const material = cone.material as THREE.MeshBasicMaterial;
            material.color.copy(getSatelliteColor(sat.category, sat.id));
            material.opacity = sat.isSelected || sat.isHovered ? 0.32 : 0.18;
        });

        this.visibilityCones.forEach(cone => {
            if (cone.userData.activeFrame !== this.visibilityConeFrame) {
                cone.visible = false;
            }
        });
    }

    private buildVisibilityConeGeometry(
        apex: THREE.Vector3,
        footprint: { lat: number; lon: number }[]
    ): THREE.BufferGeometry | null {
        if (footprint.length < 3) return null;
        const positions: number[] = [];
        const surfaceOffsetKm = 45;

        for (let i = 1; i < footprint.length; i++) {
            const prev = latLonToVector3(footprint[i - 1].lat, footprint[i - 1].lon, surfaceOffsetKm);
            const current = latLonToVector3(footprint[i].lat, footprint[i].lon, surfaceOffsetKm);
            positions.push(
                apex.x, apex.y, apex.z,
                prev.x, prev.y, prev.z,
                current.x, current.y, current.z
            );
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();
        return geometry;
    }

    private createVisibilityCone(sat: SimulatedSatellite): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({
            color: getSatelliteColor(sat.category, sat.id),
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending
        });
        const cone = new THREE.Mesh(new THREE.BufferGeometry(), material);
        cone.renderOrder = 4;
        cone.name = `visibility-cone-${sat.id}`;
        return cone;
    }

    private syncVisibilityTargets(groundStations: any[]): void {
        const signature = groundStations
            .map(gs => `${gs.id}:${gs.lat}:${gs.lon}:${gs.minElevation ?? 10}`)
            .join('|');

        if (signature === this.lastVisibilityTargetSignature) return;
        this.lastVisibilityTargetSignature = signature;
        this.visibilityTargets = [];
        this.visibilityTargetById.clear();

        groundStations.forEach(gs => {
            const position = latLonToVector3(gs.lat, gs.lon, 0);
            const target: VisibilityTarget = {
                id: `gs:${gs.id}`,
                kind: 'ground-station',
                label: gs.name,
                position,
                lat: gs.lat,
                lon: gs.lon,
                minElevationDeg: gs.minElevation ?? 10,
                groundStation: gs
            };
            this.visibilityTargets.push(target);
            this.visibilityTargetById.set(target.id, target);
        });
    }

    private refreshActiveVisibilityLinks(
        satellites: Map<string, SimulatedSatellite>,
        satPositions: Map<string, THREE.Vector3>
    ): void {
        const now = performance.now();
        if (now - this.lastVisibilityRefreshMs < SatelliteSimulation.VISIBILITY_REFRESH_MS) return;
        this.lastVisibilityRefreshMs = now;
        this.activeVisibilityLinks.clear();

        if (this.visibilityTargets.length === 0 || satellites.size === 0) return;

        const candidates: { satId: string; targetId: string; elevationDeg: number; distanceSq: number; centralAngleRad: number }[] = [];

        satellites.forEach((sat, satId) => {
            const satPos = satPositions.get(satId);
            if (!satPos) return;

            let bestTarget: VisibilityTarget | null = null;
            let bestElevation = -90;
            let bestDistanceSq = Infinity;

            for (const target of this.visibilityTargets) {
                const distanceSq = target.position.distanceToSquared(satPos);
                const elevationDeg = target.groundStation
                    ? calculateElevationDeg(sat.position, target.groundStation)
                    : -90;

                if (elevationDeg >= target.minElevationDeg && elevationDeg > bestElevation) {
                    bestTarget = target;
                    bestElevation = elevationDeg;
                    bestDistanceSq = distanceSq;
                }
            }

            if (bestTarget) {
                candidates.push({
                    satId,
                    targetId: bestTarget.id,
                    elevationDeg: bestElevation,
                    distanceSq: bestDistanceSq,
                    centralAngleRad: calculateCoverageCentralAngleRad(
                        sat.position.alt,
                        bestTarget.minElevationDeg
                    )
                });
            }
        });

        if (candidates.length > SatelliteSimulation.MAX_ACTIVE_VISIBILITY_CONES) {
            candidates.sort((a, b) => b.elevationDeg - a.elevationDeg || a.distanceSq - b.distanceSq);
            candidates.length = SatelliteSimulation.MAX_ACTIVE_VISIBILITY_CONES;
        }

        candidates.forEach(candidate => {
            this.activeVisibilityLinks.set(candidate.satId, {
                targetId: candidate.targetId,
                elevationDeg: candidate.elevationDeg,
                distanceSq: candidate.distanceSq,
                centralAngleRad: candidate.centralAngleRad
            });
        });
    }

    destroy(): void {
        window.removeEventListener('resize', this.boundResize);
        window.removeEventListener('mouseup', this.boundMouseUp);
        this.renderer.domElement.removeEventListener('click', this.boundClick);
        this.renderer.domElement.removeEventListener('mousemove', this.boundMouseMove);
        this.renderer.domElement.removeEventListener('mousedown', this.boundMouseDown);
        this.renderer.domElement.removeEventListener('wheel', this.boundWheel);
        this.cameraTween?.kill();
        this.targetTween?.kill();
        this.groundStationLayer?.destroy();
        this.instancedMesh?.destroy();
        this.flatMap.destroy();
        this.mapLibreBase.destroy();
        this.disposeAoi3dLayer();
        this.orbitPathLines.forEach(line => {
            this.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        });
        this.visibilityCones.forEach(cone => {
            this.scene.remove(cone);
            cone.geometry.dispose();
            (cone.material as THREE.Material).dispose();
        });
        this.gsCoverageMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        });
        this.earth.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GroundStation, SimulatedSatellite } from '../modules/types';
import { simulationStore } from '../stores/simulationStore';
import { latLonToVector3 } from '../utils/coordUtils';

/**
 * Creates a canvas texture for the ground station icon.
 * A distinct downward-triangle (dish) shape with a glowing green hue.
 */
function createGSIconTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const centerX = size / 2;
    const centerY = size / 2;

    // ── Outer glow halo ──────────────────────────────────────────
    const glow = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, 120);
    glow.addColorStop(0, 'rgba(0, 255, 136, 0.2)');
    glow.addColorStop(0.6, 'rgba(0, 255, 136, 0.05)');
    glow.addColorStop(1, 'rgba(0, 255, 136, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // ── Hexagonal Frame ──────────────────────────────────────────
    const hexRadius = 70;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = centerX + hexRadius * Math.cos(angle);
        const y = centerY + hexRadius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 255, 136, 0.1)';
    ctx.fill();

    // ── Signal Pulse Rings ───────────────────────────────────────
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, 45, -Math.PI * 0.4, -Math.PI * 0.6, true);
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // ── Central Glow Core ────────────────────────────────────────
    const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 15);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.4, '#00ff88');
    coreGrad.addColorStop(1, 'rgba(0,255,136,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

export class GroundStationLayer {
    public points: THREE.Points;
    private groundStations: GroundStation[] = [];
    private geometry: THREE.BufferGeometry;
    private focusedModel: THREE.Group | null = null;
    private activeModelGsId: string | null = null;
    private isZoomed: boolean = false;
    private defaultCameraDistance = 25000;
    private commLines: THREE.Line[] = [];
    private commLinePulse = 0;

    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private controls: OrbitControls;
    private renderer: THREE.WebGLRenderer;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();

    private boundMouseMove: (e: MouseEvent) => void;

    private static readonly RADIUS = 6371;

    private onSelectGs?: (id: string | null) => void;
    private onHoverGs?: (id: string | null, pos: { x: number, y: number } | null) => void;

    constructor(
        scene: THREE.Scene,
        camera: THREE.PerspectiveCamera,
        controls: OrbitControls,
        renderer: THREE.WebGLRenderer,
        onSelect?: (id: string | null) => void,
        onHover?: (id: string | null, pos: { x: number, y: number } | null) => void
    ) {
        this.scene = scene;
        this.camera = camera;
        this.controls = controls;
        this.renderer = renderer;
        this.renderer = renderer;

        this.geometry = new THREE.BufferGeometry();
        const iconTexture = createGSIconTexture();
        const material = new THREE.PointsMaterial({
            color: 0x00ff88,
            size: 30, // Reduced from 45 as per request
            sizeAttenuation: false,
            map: iconTexture,
            transparent: true,
            alphaTest: 0.01,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1, // Pull slightly towards camera to avoid z-fighting
            blending: THREE.AdditiveBlending,
        });

        this.points = new THREE.Points(this.geometry, material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 2;
        scene.add(this.points);

        this.boundMouseMove = this.onMouseMove.bind(this);
        renderer.domElement.addEventListener('mousemove', this.boundMouseMove);
    }

    updateStations(stations: GroundStation[]): void {
        this.groundStations = stations;
        const positions = new Float32Array(stations.length * 3);

        stations.forEach((gs, i) => {
            const v = latLonToVector3(gs.lat, gs.lon, 35);
            positions[i * 3] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
        });

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // Ensure positions are valid before computing bounding sphere
        let hasNaN = false;
        for (let i = 0; i < positions.length; i++) {
            if (isNaN(positions[i])) {
                hasNaN = true;
                break;
            }
        }

        if (!hasNaN && positions.length > 0) {
            this.geometry.computeBoundingSphere();
            const bs = this.geometry.boundingSphere;
            if (bs) bs.radius = 100000;
        }

        const posAttr = this.geometry.attributes['position'];
        if (posAttr) posAttr.needsUpdate = true;
    }

    tick(selectedGsId: string | null = null, satPositions?: Map<string, THREE.Vector3>): void {
        const state = simulationStore.getState();
        const selectedId = selectedGsId || state.selectedGroundStationId;

        this.updateCommLines(state, satPositions);

        if (selectedId) {
            const gs = this.groundStations.find(g => g.id === selectedId);
            if (gs) {
                const pos = latLonToVector3(gs.lat, gs.lon, 35);
                this.updateFocusedModel(pos, gs.id, pos.clone().normalize());

                this.controls.target.lerp(pos, 0.1);
                const upDir = pos.clone().normalize();
                const targetCamPos = pos.clone().add(upDir.multiplyScalar(4000));
                this.camera.position.lerp(targetCamPos, 0.06);
                this.isZoomed = true;
            }
        } else {
            this.removeFocusedModel();
            this.resetZoom();
        }
    }

    public getIntersectedGsId(raycaster: THREE.Raycaster): string | null {
        const camDist = this.camera.position.length();
        raycaster.params.Points = { threshold: Math.max(30, camDist / 100) };
        const hits = raycaster.intersectObject(this.points);
        if (hits.length > 0) {
            const hit = hits[0];
            const idx = hit?.index ?? -1;
            if (idx >= 0 && idx < this.groundStations.length) {
                return this.groundStations[idx].id;
            }
        }
        return null;
    }


    private onMouseMove(e: MouseEvent): void {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const camDist2 = this.camera.position.length();
        this.raycaster.params.Points = { threshold: Math.max(30, camDist2 / 100) };
        const hits = this.raycaster.intersectObject(this.points);
        if (hits.length > 0) {
            const hit = hits[0];
            const idx = hit?.index ?? -1;
            if (idx >= 0 && idx < this.groundStations.length) {
                const gs = this.groundStations[idx];
                if (gs) {
                    simulationStore.hoverGroundStation(gs.id);
                    simulationStore.setGsTooltipPos({ x: e.clientX, y: e.clientY });
                    this.onHoverGs?.(gs.id, { x: e.clientX, y: e.clientY });
                    this.renderer.domElement.style.cursor = 'pointer';
                    return;
                }
            }
        }
        simulationStore.hoverGroundStation(null);
        simulationStore.setGsTooltipPos(null);
        this.onHoverGs?.(null, null);
        this.renderer.domElement.style.cursor = '';
    }

    private updateFocusedModel(pos: THREE.Vector3, gsId: string, surfaceNormal: THREE.Vector3): void {
        if (!this.focusedModel || this.activeModelGsId !== gsId) {
            this.removeFocusedModel();
            this.focusedModel = this.createDishModel();
            this.activeModelGsId = gsId;
            this.scene.add(this.focusedModel);
        }
        this.focusedModel.position.copy(pos);
    }

    private createDishModel(): THREE.Group {
        const group = new THREE.Group();
        // Removed selection rings based on user feedback
        return group;
    }

    private updateCommLines(state: any, satPositions?: Map<string, THREE.Vector3>): void {
        for (const line of this.commLines) {
            this.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        }
        this.commLines = [];

        if (!state.showCommLinks) return;

        const satelliteMap = state.satellites as Map<string, SimulatedSatellite>;
        if (!satelliteMap || satelliteMap.size === 0) return;

        this.commLinePulse = (this.commLinePulse + 0.025) % (Math.PI * 2);
        const pulse = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.commLinePulse));

        const selectedGsId = state.selectedGroundStationId as string | null;

        for (const gs of this.groundStations) {
            const gsPos = latLonToVector3(gs.lat, gs.lon, 35);
            const gsVec = gsPos.clone().normalize().multiplyScalar(GroundStationLayer.RADIUS);
            const minElev = gs.minElevation || 10;

            let bestSatPos: THREE.Vector3 | null = null;
            let maxElev = -90;

            satelliteMap.forEach((sat, id) => {
                const cachedPos = satPositions?.get(id);
                if (cachedPos || sat?.position) {
                    const satPos = cachedPos || latLonToVector3(sat.position.lat, sat.position.lon, sat.position.alt);

                    // Connection logic: check elevation
                    const rangeVec = satPos.clone().sub(gsVec);
                    const upVec = gsVec.clone().normalize();
                    const dot = rangeVec.clone().normalize().dot(upVec);
                    const elev = Math.asin(dot) * 180 / Math.PI;

                    if (elev > minElev) { 
                        if (elev > maxElev) {
                            maxElev = elev;
                            bestSatPos = satPos;
                        }
                    }
                }
            });

            if (!bestSatPos) continue;
            const satPos = bestSatPos as THREE.Vector3;

            const isSelected = gs.id === selectedGsId;
            
            // DYNAMIC CURVATURE: Check if straight line intersects Earth
            const lineDir = satPos.clone().sub(gsVec);
            const lineLen = lineDir.length();
            lineDir.normalize();
            
            // Closest point to origin on the line: gsVec + t * lineDir
            // t = - (gsVec . lineDir)
            const t = -gsVec.dot(lineDir);
            let minDistToOrigin = gsVec.length(); 
            if (t > 0 && t < lineLen) {
                minDistToOrigin = gsVec.clone().add(lineDir.clone().multiplyScalar(t)).length();
            }

            const earthRadius = GroundStationLayer.RADIUS;
            let points: THREE.Vector3[] = [];
            
            if (minDistToOrigin > earthRadius + 50) {
                // CLEAR LINE OF SIGHT: Straight line
                points = [gsPos, satPos];
            } else {
                // OBSTRUCTED: Create Curved Arc (Quadratic Bezier)
                const height = 1500;
                const mid = gsPos.clone().lerp(satPos, 0.5).normalize().multiplyScalar(earthRadius + height);
                const curve = new THREE.QuadraticBezierCurve3(gsPos, mid, satPos);
                points = curve.getPoints(20);
            }

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            
            const mat = new THREE.LineBasicMaterial({
                color: isSelected ? 0x00ffff : 0x00ff88,
                transparent: true,
                opacity: isSelected ? 1.0 : 0.8,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 10;
            this.scene.add(line);
            this.commLines.push(line);
        }
    }

    private resetZoom(): void {
        this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.08);
        const distToOrigin = this.controls.target.length();
        const distToDefault = Math.abs(this.camera.position.length() - this.defaultCameraDistance);

        if (distToOrigin > 10 || distToDefault > 100) {
            const globalPos = this.camera.position.clone().setLength(this.defaultCameraDistance);
            this.camera.position.lerp(globalPos, 0.08);
        } else {
            this.isZoomed = false;
        }
    }

    private removeFocusedModel(): void {
        if (this.focusedModel) {
            this.scene.remove(this.focusedModel);
            this.focusedModel = null;
            this.activeModelGsId = null;
        }
    }

    // Local latLonToCartesian removed in favor of shared latLonToVector3

    destroy(): void {
        this.renderer.domElement.removeEventListener('mousemove', this.boundMouseMove);
        for (const line of this.commLines) {
            this.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        }
        this.geometry.dispose();
        (this.points.material as THREE.PointsMaterial).dispose();
        this.removeFocusedModel();
        this.scene.remove(this.points);
    }
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GroundStation } from '../modules/types';
import { simulationStore } from '../stores/simulationStore';

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

    // ── Outer glow halo ──────────────────────────────────────────
    const glow = ctx.createRadialGradient(128, 128, 10, 128, 128, 120);
    glow.addColorStop(0, 'rgba(0, 255, 136, 0.25)');
    glow.addColorStop(0.5, 'rgba(0, 255, 136, 0.08)');
    glow.addColorStop(1, 'rgba(0, 255, 136, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = '#00ff88';
    ctx.fillStyle = 'rgba(0, 255, 136, 0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ── Parabolic dish bowl ──────────────────────────────────────
    const dishX = 128;   // center
    const dishY = 90;    // apex of the bowl (bottom)
    const dishW = 80;    // half-width
    const dishH = 45;    // depth

    ctx.beginPath();
    ctx.moveTo(dishX - dishW, dishY - dishH);
    ctx.quadraticCurveTo(dishX, dishY + 20, dishX + dishW, dishY - dishH);
    ctx.lineTo(dishX - dishW, dishY - dishH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 255, 136, 0.22)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(dishX - dishW, dishY - dishH);
    ctx.quadraticCurveTo(dishX, dishY + 20, dishX + dishW, dishY - dishH);
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(dishX - dishW, dishY - dishH);
    ctx.lineTo(dishX + dishW, dishY - dishH);
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Feed arm (line from center of dish to focal point above) ─
    ctx.beginPath();
    ctx.moveTo(dishX, dishY + 10); // near apex
    ctx.lineTo(dishX - 18, dishY - dishH - 18); // feed horn at left
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#00ff88';
    ctx.fillRect(dishX - 22, dishY - dishH - 22, 8, 8);

    // ── Vertical support mast ────────────────────────────────────
    const mastTopY = dishY + 20;
    const mastBotY = 195;
    ctx.beginPath();
    ctx.moveTo(dishX, mastTopY);
    ctx.lineTo(dishX, mastBotY);
    ctx.lineWidth = 4;
    ctx.stroke();

    // ── Platform / base legs ────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(dishX, mastBotY);
    ctx.lineTo(dishX - 36, mastBotY + 18);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dishX, mastBotY);
    ctx.lineTo(dishX + 36, mastBotY + 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dishX - 40, mastBotY + 20);
    ctx.lineTo(dishX + 40, mastBotY + 20);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // ── Bright focal point dot ───────────────────────────────────
    const dotGrad = ctx.createRadialGradient(dishX, dishY + 10, 0, dishX, dishY + 10, 8);
    dotGrad.addColorStop(0, '#ffffff');
    dotGrad.addColorStop(0.4, '#00ff88');
    dotGrad.addColorStop(1, 'rgba(0,255,136,0)');
    ctx.fillStyle = dotGrad;
    ctx.beginPath();
    ctx.arc(dishX, dishY + 10, 8, 0, Math.PI * 2);
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

    private boundClick: (e: MouseEvent) => void;
    private boundMouseMove: (e: MouseEvent) => void;

    private static readonly RADIUS = 6371;

    constructor(
        scene: THREE.Scene,
        camera: THREE.PerspectiveCamera,
        controls: OrbitControls,
        renderer: THREE.WebGLRenderer
    ) {
        this.scene = scene;
        this.camera = camera;
        this.controls = controls;
        this.renderer = renderer;

        this.geometry = new THREE.BufferGeometry();
        const iconTexture = createGSIconTexture();
        const material = new THREE.PointsMaterial({
            color: 0x00ff88,
            size: 1400,
            sizeAttenuation: true,
            map: iconTexture,
            transparent: true,
            alphaTest: 0.01,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.points = new THREE.Points(this.geometry, material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 2;
        scene.add(this.points);

        this.boundClick = this.onClick.bind(this);
        this.boundMouseMove = this.onMouseMove.bind(this);
        renderer.domElement.addEventListener('click', this.boundClick);
        renderer.domElement.addEventListener('mousemove', this.boundMouseMove);
    }

    updateStations(stations: GroundStation[]): void {
        this.groundStations = stations;
        const positions = new Float32Array(stations.length * 3);

        stations.forEach((gs, i) => {
            const v = this.latLonToCartesian(gs.lat, gs.lon);
            positions[i * 3] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
        });

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.computeBoundingSphere();
        const bs = this.geometry.boundingSphere;
        if (bs) bs.radius = 100000;
        const posAttr = this.geometry.attributes['position'];
        if (posAttr) posAttr.needsUpdate = true;
    }

    tick(): void {
        const state = simulationStore.getState();
        const selectedId = state.selectedGroundStationId;

        this.updateCommLines(state);

        if (selectedId) {
            const gs = this.groundStations.find(g => g.id === selectedId);
            if (gs) {
                const pos = this.latLonToCartesian(gs.lat, gs.lon);
                this.updateFocusedModel(pos, gs.id, pos.clone().normalize());

                if (this.focusedModel?.userData['isPulseGroup']) {
                    this.focusedModel.quaternion.copy(this.camera.quaternion);
                    const p = 0.5 + 0.5 * Math.sin(Date.now() * 0.003);
                    this.focusedModel.children.forEach((child, i) => {
                        const mat = (child as THREE.LineLoop).material as THREE.LineBasicMaterial;
                        if (mat) mat.opacity = i === 0 ? 0.5 + p * 0.5 : 0.2 + p * 0.3;
                    });
                }

                this.controls.target.lerp(pos, 0.1);
                const upDir = pos.clone().normalize();
                const targetCamPos = pos.clone().add(upDir.multiplyScalar(150));
                this.camera.position.lerp(targetCamPos, 0.06);
                this.isZoomed = true;
            }
        } else {
            this.removeFocusedModel();
            this.resetZoom();
        }
    }

    private onClick(e: MouseEvent): void {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const camDist = this.camera.position.length();
        this.raycaster.params.Points = { threshold: Math.max(30, camDist / 100) };
        const hits = this.raycaster.intersectObject(this.points);
        if (hits.length > 0) {
            const hit = hits[0];
            const idx = hit?.index ?? -1;
            if (idx >= 0 && idx < this.groundStations.length) {
                const gs = this.groundStations[idx];
                if (gs) {
                    simulationStore.selectGroundStation(gs.id);
                    simulationStore.selectSatellite(null);
                }
            }
        } else {
            simulationStore.selectGroundStation(null);
        }
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
                    this.renderer.domElement.style.cursor = 'pointer';
                    return;
                }
            }
        }
        simulationStore.hoverGroundStation(null);
        simulationStore.setGsTooltipPos(null);
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
        const buildRing = (radius: number, color: number, opacity: number) => {
            const segments = 48;
            const pts: THREE.Vector3[] = [];
            for (let i = 0; i <= segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
            }
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            return new THREE.LineLoop(geo, mat);
        };
        group.add(buildRing(350, 0x00ff88, 0.9));
        group.add(buildRing(550, 0x00ffcc, 0.4));
        group.userData['isPulseGroup'] = true;
        return group;
    }

    private updateCommLines(state: any): void {
        for (const line of this.commLines) {
            this.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        }
        this.commLines = [];

        const satelliteMap = state.satellites as Map<string, any>;
        if (!satelliteMap || satelliteMap.size === 0) return;

        const satPositions: THREE.Vector3[] = [];
        satelliteMap.forEach((sat: any) => {
            if (sat?.position) {
                const alt = sat.position.alt ?? 550;
                const phi = (90 - sat.position.lat) * (Math.PI / 180);
                const theta = (sat.position.lon + 180) * (Math.PI / 180);
                const r = GroundStationLayer.RADIUS + alt;
                satPositions.push(new THREE.Vector3(
                    -r * Math.sin(phi) * Math.cos(theta),
                    r * Math.cos(phi),
                    r * Math.sin(phi) * Math.sin(theta)
                ));
            }
        });
        if (satPositions.length === 0) return;

        this.commLinePulse = (this.commLinePulse + 0.025) % (Math.PI * 2);
        const pulse = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.commLinePulse));

        const selectedGsId = state.selectedGroundStationId as string | null;

        for (const gs of this.groundStations) {
            const gsPos = this.latLonToCartesian(gs.lat, gs.lon);
            let nearestPos: THREE.Vector3 | null = null;
            let minDist = 12000;
            for (const sp of satPositions) {
                const d = gsPos.distanceTo(sp);
                if (d < minDist) { minDist = d; nearestPos = sp; }
            }
            if (!nearestPos) continue;

            const isSelected = gs.id === selectedGsId;
            const geo = new THREE.BufferGeometry().setFromPoints([gsPos, nearestPos]);
            const mat = new THREE.LineBasicMaterial({
                color: isSelected ? 0x00ffff : 0x00ff44,
                transparent: true,
                opacity: isSelected ? Math.min(1, pulse + 0.3) : pulse * 0.7,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const line = new THREE.Line(geo, mat);
            this.scene.add(line);
            this.commLines.push(line);
        }
    }

    private resetZoom(): void {
        if (this.isZoomed) {
            this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.05);
            const currentDist = this.camera.position.length();
            if (currentDist < this.defaultCameraDistance - 100) {
                const globalPos = this.camera.position.clone().setLength(this.defaultCameraDistance);
                this.camera.position.lerp(globalPos, 0.05);
            } else {
                this.isZoomed = false;
            }
        }
    }

    private removeFocusedModel(): void {
        if (this.focusedModel) {
            this.scene.remove(this.focusedModel);
            this.focusedModel = null;
            this.activeModelGsId = null;
        }
    }

    private latLonToCartesian(lat: number, lon: number): THREE.Vector3 {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        const r = GroundStationLayer.RADIUS + 250;
        return new THREE.Vector3(
            -r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );
    }

    destroy(): void {
        this.renderer.domElement.removeEventListener('click', this.boundClick);
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

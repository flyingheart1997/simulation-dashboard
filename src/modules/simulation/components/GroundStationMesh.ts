import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GroundStation, SimulatedSatellite } from '../types';
import { simulationStore } from '../stores/simulationStore';
import { latLonToVector3 } from '../utils/coordUtils';
import { findBestVisibleSatellite } from '../utils/visibilityUtils';

/**
 * Creates a modern, premium canvas texture for the ground station icon.
 * Features a radar dish silhouette, concentric tech-rings, and signal pulses.
 */
function createModernGSIconTexture(): THREE.Texture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const centerX = size / 2;
    const centerY = size / 2;

    // ── Outer Glow & Atmosphere ──────────────────────────────────
    const glow = ctx.createRadialGradient(centerX, centerY, 50, centerX, centerY, 240);
    glow.addColorStop(0, 'rgba(0, 255, 136, 0.15)');
    glow.addColorStop(0.5, 'rgba(0, 255, 255, 0.05)');
    glow.addColorStop(1, 'rgba(0, 255, 136, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // ── Outer Tech-Rings (Dashed) ────────────────────────────────
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.4)';
    ctx.setLineDash([15, 10]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 180, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 210, 0, Math.PI * 2);
    ctx.stroke();

    // ── Concentric Inner UI Rings ────────────────────────────────
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 140, 0, Math.PI * 2);
    ctx.stroke();

    // ── Radar Dish Silhouette ───────────────────────────────────
    ctx.save();
    ctx.translate(centerX, centerY);

    // Dish Base (Static)
    ctx.fillStyle = '#00ff88';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ff88';

    // Main Dish Curve
    ctx.beginPath();
    ctx.arc(0, -20, 80, Math.PI * 0.1, Math.PI * 0.9);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#00ff88';
    ctx.stroke();

    // Dish Support/Feed Horn
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -60);
    ctx.lineWidth = 8;
    ctx.stroke();

    // Signal Emission Point (Glowing Core)
    const coreGrad = ctx.createRadialGradient(0, -70, 0, 0, -70, 20);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.5, '#00ffff');
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, -70, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Signal Pulse Lines ───────────────────────────────────────
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.8)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (i - 1) * 0.4;
        const x1 = centerX + 100 * Math.cos(angle);
        const y1 = centerY - 100 + 100 * Math.sin(angle);
        const x2 = centerX + 140 * Math.cos(angle);
        const y2 = centerY - 100 + 140 * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

export class GroundStationLayer {
    private iconGroup: THREE.Group;
    private groundStations: GroundStation[] = [];
    private iconMeshes: Map<string, THREE.Mesh> = new Map();
    private commLines: Map<string, THREE.Line> = new Map();

    private cachedTexture: THREE.Texture | null = null;
    private cachedGeometry: THREE.CircleGeometry | null = null;

    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private controls: OrbitControls;
    private renderer: THREE.WebGLRenderer;

    private static readonly RADIUS = 6371;
    private static readonly ICON_BASE_UNIT = 400; // 400km base radius
    private static readonly ICON_ALTITUDE = 100; // km above surface to clear data layers

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

        this.iconGroup = new THREE.Group();
        this.iconGroup.name = 'gs-icons';
        scene.add(this.iconGroup);

        this.cachedTexture = createModernGSIconTexture();
        this.cachedGeometry = new THREE.CircleGeometry(1, 32); // Use 1 unit base, scale by ICON_BASE_UNIT
    }

    private createIconMesh(gs: GroundStation): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({
            map: this.cachedTexture,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            opacity: 0.95
        });

        const mesh = new THREE.Mesh(this.cachedGeometry!, material);
        mesh.userData = { gsId: gs.id };
        mesh.renderOrder = 200; // Highest priority for surface features

        const pos = latLonToVector3(gs.lat, gs.lon, GroundStationLayer.ICON_ALTITUDE);
        mesh.position.copy(pos);

        // Orient flat to surface normal
        const normal = pos.clone().normalize();
        mesh.lookAt(pos.clone().add(normal));

        // Set initial scale
        mesh.scale.set(GroundStationLayer.ICON_BASE_UNIT, GroundStationLayer.ICON_BASE_UNIT, 1);

        return mesh;
    }

    updateStations(stations: GroundStation[]): void {
        this.groundStations = stations;

        // Remove stale meshes
        const stationIds = new Set(stations.map(s => s.id));
        this.iconMeshes.forEach((mesh, id) => {
            if (!stationIds.has(id)) {
                this.iconGroup.remove(mesh);
                (mesh.material as THREE.Material).dispose();
                this.iconMeshes.delete(id);
            }
        });

        // Add/Update meshes
        stations.forEach(gs => {
            if (!this.iconMeshes.has(gs.id)) {
                const mesh = this.createIconMesh(gs);
                this.iconGroup.add(mesh);
                this.iconMeshes.set(gs.id, mesh);
            } else {
                // Update position in case it changed (rare for GS but good practice)
                const mesh = this.iconMeshes.get(gs.id)!;
                const pos = latLonToVector3(gs.lat, gs.lon, GroundStationLayer.ICON_ALTITUDE);
                mesh.position.copy(pos);
                const normal = pos.clone().normalize();
                mesh.lookAt(pos.clone().add(normal));
            }
        });
    }

    setVisible(visible: boolean): void {
        this.iconGroup.visible = visible;
        this.commLines.forEach(line => {
            line.visible = visible && line.visible;
        });
    }

    tick(selectedGsId: string | null = null, satPositions?: Map<string, THREE.Vector3>): void {
        const state = simulationStore.getState();
        const selectedId = selectedGsId || state.selectedGroundStationId;

        this.updateCommLines(state, satPositions);

        // Update scaling for selected state (Unified size for both cases)
        this.iconMeshes.forEach((mesh) => {
            const targetSize = GroundStationLayer.ICON_BASE_UNIT;

            if (mesh.scale.x !== targetSize) {
                mesh.scale.set(targetSize, targetSize, 1);
            }
        });
    }

    public getIntersectedGsId(raycaster: THREE.Raycaster): string | null {
        // Broad phase: just icons
        const hits = raycaster.intersectObjects(this.iconGroup.children);
        if (hits.length > 0) {
            // Find the first hit that isn't occluded by Earth
            // Sort hits by distance
            hits.sort((a, b) => a.distance - b.distance);

            for (const hit of hits) {
                // Occlusion Check: Does Earth block this Ground Station?
                // Look for the Earth specifically using the group property
                const earthObj = this.scene.children.find(c => (c as any).isEarthGroup);
                if (earthObj) {
                    const earthIntersects = raycaster.intersectObject(earthObj, true);
                    if (earthIntersects.length > 0 && earthIntersects[0].distance < hit.distance - 10) {
                        continue; // Blocked by Earth, try next GS hit
                    }
                }

                return hit.object.userData.gsId;
            }
        }
        return null;
    }

    private updateCommLines(state: any, satPositions?: Map<string, THREE.Vector3>): void {
        if (!state.showCommLinks || state.workspaceMode !== 'inspect') {
            this.commLines.forEach(line => line.visible = false);
            return;
        }

        const satelliteMap = state.satellites as Map<string, SimulatedSatellite>;
        if (!satelliteMap || satelliteMap.size === 0) {
            this.commLines.forEach(line => line.visible = false); // Hide all lines if no satellites
            return;
        }

        const selectedGsId = state.selectedGroundStationId as string | null;
        const selectedSatId = state.selectedSatelliteId as string | null;
        const activeGsIds = new Set<string>();
        const satellites = Array.from(satelliteMap.values());

        for (const gs of this.groundStations) {
            // Comm lines start from surface height (35km for visibility)
            const gsPos = latLonToVector3(gs.lat, gs.lon, 35);
            const bestLink = findBestVisibleSatellite(gs, satellites);
            const bestSatPos = bestLink ? satPositions?.get(bestLink.satellite.id) : null;

            if (bestSatPos) {
                const satPos = bestSatPos;
                activeGsIds.add(gs.id);
                const isSelected = gs.id === selectedGsId || bestLink?.satellite.id === selectedSatId;

                let line = this.commLines.get(gs.id);

                const earthRadius = GroundStationLayer.RADIUS;
                const mid = gsPos.clone().lerp(satPos, 0.5).normalize().multiplyScalar(earthRadius + 1500);
                const curve = new THREE.QuadraticBezierCurve3(gsPos, mid, satPos);
                const points = curve.getPoints(12);

                if (!line) {
                    const geo = new THREE.BufferGeometry().setFromPoints(points);
                    const mat = new THREE.LineBasicMaterial({
                        color: isSelected ? 0x00ffff : 0x00ff88,
                        transparent: true,
                        opacity: 0.8,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending,
                    });
                    line = new THREE.Line(geo, mat);
                    line.renderOrder = 10;
                    this.scene.add(line);
                    this.commLines.set(gs.id, line);
                } else {
                    line.visible = true;
                    line.geometry.setFromPoints(points);
                    (line.material as THREE.LineBasicMaterial).color.setHex(isSelected ? 0x00ffff : 0x00ff88);
                    (line.material as THREE.LineBasicMaterial).opacity = isSelected ? 1.0 : 0.8;
                }
            }
        }

        this.commLines.forEach((line, gsId) => {
            if (!activeGsIds.has(gsId)) {
                line.visible = false;
            }
        });
    }

    destroy(): void {
        this.commLines.forEach(line => {
            this.scene.remove(line);
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        });

        this.iconMeshes.forEach(mesh => {
            this.iconGroup.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        });

        if (this.cachedTexture) this.cachedTexture.dispose();
        if (this.cachedGeometry) this.cachedGeometry.dispose();
        this.scene.remove(this.iconGroup);
    }
}

import * as THREE from 'three';
import { SimulatedSatellite } from '../modules/types';
import { getSatelliteColor } from '../utils/satelliteUtils';

export class SatelliteInstancedMesh {
    private meshes: Map<string, THREE.Points> = new Map();
    private geometries: Map<string, THREE.BufferGeometry> = new Map();
    private positionBuffers: Map<string, Float32Array> = new Map();
    private colorBuffers: Map<string, Float32Array> = new Map();
    private maxCount: number;
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene, initialCount: number = 0) {
        this.scene = scene;
        this.maxCount = Math.max(initialCount, 15000);

        ['starlink', 'gps', 'weather', 'communication', 'operational', 'default'].forEach(cat => {
            this.initCategoryMesh(cat);
        });
    }

    private initCategoryMesh(category: string) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.maxCount * 3);
        const colors = new Float32Array(this.maxCount * 3);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const texture = this.createIconTexture(category);

        const material = new THREE.PointsMaterial({
            size: 20,
            map: texture,
            vertexColors: true,
            transparent: true,
            alphaTest: 0.05,
            sizeAttenuation: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        const mesh = new THREE.Points(geometry, material);
        (mesh as any).category = category;
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;

        this.geometries.set(category, geometry);
        this.positionBuffers.set(category, positions);
        this.colorBuffers.set(category, colors);
        this.meshes.set(category, mesh);
        this.scene.add(mesh);
    }

    private createIconTexture(category: string): THREE.CanvasTexture {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;

        const cx = 32, cy = 32;

        // Glowing core
        const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
        coreGradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        coreGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.7)');
        coreGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = coreGradient;
        ctx.fillRect(0, 0, 64, 64);

        // Radar/Target ring
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Tilted orbit line crosshair
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 6); // slight upward tilt
        ctx.beginPath();

        // Vary shape based on category
        if (category === 'starlink') {
            // Simple dash
            ctx.moveTo(-28, 0); ctx.lineTo(28, 0);
        } else if (category === 'gps') {
            // Double cross
            ctx.moveTo(-28, -6); ctx.lineTo(28, -6);
            ctx.moveTo(-28, 6); ctx.lineTo(28, 6);
        } else if (category === 'weather') {
            // Triangle marker
            ctx.moveTo(0, -28); ctx.lineTo(24, 14); ctx.lineTo(-24, 14); ctx.closePath();
        } else if (category === 'communication') {
            // Box marker
            ctx.rect(-20, -20, 40, 40);
        } else {
            // Default cross
            ctx.moveTo(-24, -24); ctx.lineTo(24, 24);
            ctx.moveTo(24, -24); ctx.lineTo(-24, 24);
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    updatePositions(satellites: Map<string, SimulatedSatellite>, cartesianPositions: Map<string, THREE.Vector3>) {
        const categoryGroups = new Map<string, SimulatedSatellite[]>();
        for (const sat of satellites.values()) {
            const cat = (sat.category || 'default').toLowerCase();
            const list = categoryGroups.get(cat) || [];
            list.push(sat);
            categoryGroups.set(cat, list);
        }

        this.geometries.forEach((geo, cat) => {
            const sats = categoryGroups.get(cat) || [];
            const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
            const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;

            for (let i = 0; i < sats.length; i++) {
                const sat = sats[i];
                const pos = cartesianPositions.get(sat.id);
                
                if (pos) {
                    posAttr.setXYZ(i, pos.x, pos.y, pos.z);
                } else {
                    // Fallback to zero if position not found (shouldn't happen with unified cache)
                    posAttr.setXYZ(i, 0, 0, 0);
                }

                const color = getSatelliteColor(sat.category, sat.id);
                if (sat.isSelected) color.setHex(0xffffff);
                else if (sat.isHovered) color.addScalar(0.2);

                colAttr.setXYZ(i, color.r, color.g, color.b);
            }

            posAttr.needsUpdate = true;
            colAttr.needsUpdate = true;
            geo.setDrawRange(0, sats.length);
        });
    }

    public getMeshes(): THREE.Points[] {
        return Array.from(this.meshes.values());
    }

    destroy() {
        this.geometries.forEach(g => g.dispose());
        this.meshes.forEach(m => {
            (m.material as THREE.Material).dispose();
            this.scene.remove(m);
        });
    }
}

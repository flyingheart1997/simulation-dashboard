import * as THREE from 'three';
import { SimulatedSatellite } from '../types';
import { getSatelliteColor } from '../utils/satelliteUtils';

export class SatelliteInstancedMesh {
    private readonly categories = ['starlink', 'gps', 'weather', 'communication', 'operational', 'default'];
    private meshes: Map<string, THREE.Points> = new Map();
    private geometries: Map<string, THREE.BufferGeometry> = new Map();
    private positionBuffers: Map<string, Float32Array> = new Map();
    private colorBuffers: Map<string, Float32Array> = new Map();
    private categoryIds: Map<string, string[]> = new Map();
    private textures: Map<string, THREE.Texture> = new Map();
    private maxCount: number;
    private scene: THREE.Object3D;

    constructor(scene: THREE.Object3D, initialCount: number = 0) {
        this.scene = scene;
        this.maxCount = Math.max(initialCount, 15000);

        this.categories.forEach(cat => {
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
        this.textures.set(category, texture);

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
        this.categoryIds.set(category, []);
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
        const categoryCounts = new Map<string, number>();
        this.categories.forEach(cat => categoryCounts.set(cat, 0));

        for (const sat of satellites.values()) {
            const rawCategory = (sat.category || 'default').toLowerCase();
            const category = this.geometries.has(rawCategory) ? rawCategory : 'default';
            const index = categoryCounts.get(category) || 0;
            if (index >= this.maxCount) continue;

            const positions = this.positionBuffers.get(category);
            const colors = this.colorBuffers.get(category);
            const ids = this.categoryIds.get(category);
            if (!positions || !colors || !ids) continue;

            const pos = cartesianPositions.get(sat.id);
            const offset = index * 3;

            if (pos) {
                positions[offset] = pos.x;
                positions[offset + 1] = pos.y;
                positions[offset + 2] = pos.z;
            } else {
                positions[offset] = 0;
                positions[offset + 1] = 0;
                positions[offset + 2] = 0;
            }

            const color = getSatelliteColor(sat.category, sat.id);
            if (sat.isSelected) color.setHex(0xffffff);
            else if (sat.isHovered) color.addScalar(0.2);

            colors[offset] = color.r;
            colors[offset + 1] = color.g;
            colors[offset + 2] = color.b;
            ids[index] = sat.id;
            categoryCounts.set(category, index + 1);
        }

        this.geometries.forEach((geo, category) => {
            const count = categoryCounts.get(category) || 0;
            const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
            const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
            posAttr.needsUpdate = true;
            colAttr.needsUpdate = true;
            geo.setDrawRange(0, count);
            const ids = this.categoryIds.get(category);
            if (ids) ids.length = count;
        });
    }

    public getMeshes(): THREE.Points[] {
        return Array.from(this.meshes.values());
    }

    public setVisible(visible: boolean): void {
        this.meshes.forEach(mesh => { mesh.visible = visible; });
    }

    public getSatelliteId(category: string, index: number): string | null {
        return this.categoryIds.get(category)?.[index] || null;
    }

    destroy() {
        this.geometries.forEach(g => g.dispose());
        this.meshes.forEach(m => {
            (m.material as THREE.Material).dispose();
            this.scene.remove(m);
        });
        this.textures.forEach(texture => texture.dispose());
    }
}

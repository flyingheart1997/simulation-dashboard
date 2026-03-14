import * as THREE from 'three';
import { SimulatedSatellite } from '../modules/types';

export class SatelliteInstancedMesh {
    public mesh: THREE.Points;
    private positions: Float32Array;
    private colors: Float32Array;
    private geometry: THREE.BufferGeometry;

    constructor(initialCount: number = 0) {
        // Allocate a massive buffer up front to handle all Celestrak sats (~8000-10000)
        // If initialCount is passed, we just use the max so we never overflow the TypedArray.
        const maxBufferCount = Math.max(initialCount, 15000);

        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(maxBufferCount * 3);
        this.colors = new Float32Array(maxBufferCount * 3);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

        const texture = this.createIconTexture();

        const material = new THREE.PointsMaterial({
            size: 20,
            map: texture,
            vertexColors: true,
            transparent: true,
            alphaTest: 0.05,
            sizeAttenuation: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending // gives a nice screen-glow
        });

        this.mesh = new THREE.Points(this.geometry, material);
        // CRITICAL FOR RAYCASTING: Without a bounding sphere, Raycaster instantly rejects collisions!
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 100000);
        this.mesh.frustumCulled = false; // Always render

        // Initially draw 0 until updated
        this.geometry.setDrawRange(0, initialCount);
    }

    private createIconTexture(): THREE.CanvasTexture {
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
        ctx.moveTo(-32, 0);
        ctx.lineTo(32, 0);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    updatePositions(satellites: SimulatedSatellite[]) {
        const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;

        for (let i = 0; i < satellites.length; i++) {
            const sat = satellites[i];
            if (!sat || !sat.position) continue;

            const phi = (90 - sat.position.lat) * (Math.PI / 180);
            const theta = (sat.position.lon + 180) * (Math.PI / 180);
            const r = 6371 + sat.position.alt;

            posAttr.setXYZ(
                i,
                -r * Math.sin(phi) * Math.cos(theta),
                r * Math.cos(phi),
                r * Math.sin(phi) * Math.sin(theta)
            );

            const color = new THREE.Color(this.getCategoryColor(sat.category, sat.id));
            if (sat.isSelected) color.setHex(0xffffff);
            else if (sat.isHovered) color.addScalar(0.2); // brighten on hover

            colAttr.setXYZ(i, color.r, color.g, color.b);
        }

        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        this.geometry.setDrawRange(0, satellites.length);
    }

    private getCategoryColor(category: string, id: string): number {
        void category; // keep for API compat; color now comes from ID hash
        // Same djb2 hash as SatelliteSimulation.getSatelliteColor()
        let hash = 5381;
        for (let i = 0; i < id.length; i++) {
            hash = ((hash << 5) + hash) + id.charCodeAt(i);
            hash = hash & hash;
        }
        const hue = Math.abs(hash % 360);
        const color = new THREE.Color();
        color.setHSL(hue / 360, 0.9, 0.55);
        return color.getHex();
    }

    destroy() {
        this.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

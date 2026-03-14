import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EarthScene } from './EarthScene';
import { SatelliteInstancedMesh } from './SatelliteInstancedMesh';
import { GroundStationLayer } from './GroundStationMesh';
import type { SimulatedSatellite } from '../modules/types';
import { simulationStore } from '../stores/simulationStore';

export class SatelliteSimulation {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private earth: EarthScene;
    private instancedMesh: SatelliteInstancedMesh | null = null;
    private animationId: number | null = null;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();
    private container: HTMLElement;
    private satelliteIds: string[] = [];
    private focusedModel: THREE.Group | null = null;
    private activeModelSatId: string | null = null;
    private orbitPathLines: Map<string, THREE.Line> = new Map();
    private isZoomed: boolean = false;
    private lastSelectedSatId: string | null = null; // detect satellite change for camera jump
    private defaultCameraDistance = 25000;
    private groundStationLayer: GroundStationLayer | null = null;
    private boundResize: any;
    private boundClick: any;
    private boundMouseMove: any;

    private latLonToCartesian(lat: number, lon: number, alt: number): THREE.Vector3 {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        const r = 6371 + alt;
        return new THREE.Vector3(
            -r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );
    }

    constructor(container: HTMLElement) {
        this.container = container;
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 10, 2000000);
        this.camera.position.set(0, 15000, 30000);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 7500;
        this.controls.maxDistance = 500000;

        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 2);
        sunLight.position.set(5, 3, 5).normalize();
        this.scene.add(sunLight);

        this.earth = new EarthScene(this.scene);
        this.scene.add(this.earth.getGroup());

        this.boundResize = this.onResize.bind(this);
        this.boundClick = this.onClick.bind(this);
        this.boundMouseMove = this.onMouseMove.bind(this);

        window.addEventListener('resize', this.boundResize);
        this.renderer.domElement.addEventListener('click', this.boundClick);
        this.renderer.domElement.addEventListener('mousemove', this.boundMouseMove);

        this.groundStationLayer = new GroundStationLayer(
            this.scene, this.camera, this.controls, this.renderer
        );
        const filteredGs = simulationStore.getFilteredGroundStations();
        this.groundStationLayer.updateStations(filteredGs);

        // We'll let the external loop handle updates to avoid flickering
    }

    initSatellites(satellites: SimulatedSatellite[]): void {
        this.satelliteIds = satellites.map(s => s.id);
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh.mesh);
            this.instancedMesh.destroy();
        }
        this.instancedMesh = new SatelliteInstancedMesh(satellites.length);
        this.scene.add(this.instancedMesh.mesh);
    }

    updateSatellites(satellites: SimulatedSatellite[]): void {
        const state = simulationStore.getState();
        const hoveredId = state.hoveredSatelliteId;
        const selectedId = state.selectedSatelliteId;

        if (!this.instancedMesh || this.satelliteIds.length !== satellites.length) {
            if (satellites.length > 0) {
                this.initSatellites(satellites);
            }
        }

        if (this.instancedMesh && satellites.length > 0) {
            this.instancedMesh.updatePositions(satellites);

            const activeOrbitIds = new Set<string>();
            if (selectedId) activeOrbitIds.add(selectedId);
            if (hoveredId) activeOrbitIds.add(hoveredId);

            activeOrbitIds.forEach(id => {
                const pathSat = satellites.find(s => s.id === id);
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

            if (selectedId) {
                const sat = satellites.find(s => s.id === selectedId);
                if (sat && sat.position) {
                    const pos = this.latLonToCartesian(sat.position.lat, sat.position.lon, sat.position.alt);
                    const satColor = this.getSatelliteColor(sat.id);

                    // FIXED: Handle velocity as number vs vector
                    let velocityVector = new THREE.Vector3(1, 0, 0);
                    if (sat.orbitPath && sat.orbitPath.length > 1) {
                        const p1 = this.latLonToCartesian(sat.position.lat, sat.position.lon, sat.position.alt);
                        const nextPos = sat.orbitPath[0];
                        if (nextPos) {
                            const p2 = this.latLonToCartesian(nextPos.lat, nextPos.lon, nextPos.alt);
                            velocityVector = p2.clone().sub(p1).normalize();
                        }
                    }

                    this.updateFocusedModel(pos, velocityVector, sat.id, satColor);
                    this.controls.target.lerp(pos, 0.08);

                    if (this.lastSelectedSatId !== selectedId) {
                        this.isZoomed = false;
                        this.lastSelectedSatId = selectedId;
                    }

                    if (!this.isZoomed) {
                        const upDir = pos.clone().normalize();
                        const targetPos = pos.clone().add(upDir.multiplyScalar(10000));
                        this.camera.position.lerp(targetPos, 0.05);

                        if (this.camera.position.distanceTo(targetPos) < 100) {
                            this.isZoomed = true;
                            this.controls.minDistance = 500;
                        }
                    }
                }
            } else {
                this.controls.minDistance = 7500;
                this.removeFocusedModel();
                this.resetCameraZoom();
            }
        }
    }

    private resetCameraZoom() {
        if (this.isZoomed) {
            this.lastSelectedSatId = null;
            this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.05);

            const currentDist = this.camera.position.length();
            const diff = Math.abs(currentDist - this.defaultCameraDistance);
            if (diff > 200) {
                const globalPos = this.camera.position.clone().setLength(this.defaultCameraDistance);
                this.camera.position.lerp(globalPos, 0.05);
            } else if (this.controls.target.lengthSq() < 500) {
                this.isZoomed = false;
                this.controls.minDistance = 7500;
            }
        }
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
        this.focusedModel.up.copy(pos.clone().normalize());
        this.focusedModel.lookAt(targetPos);
    }

    private getSatelliteColor(id: string): THREE.Color {
        let hash = 5381;
        for (let i = 0; i < id.length; i++) {
            hash = ((hash << 5) + hash) + id.charCodeAt(i);
            hash = hash & hash;
        }
        const hue = Math.abs(hash % 360);
        const color = new THREE.Color();
        color.setHSL(hue / 360, 0.9, 0.55);
        return color;
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
        if (!sat.orbitPath || this.orbitPathLines.has(sat.id)) return;
        const points = sat.orbitPath.map(p => this.latLonToCartesian(p.lat, p.lon, p.alt));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const color = this.getSatelliteColor(sat.id);
        const material = new THREE.LineBasicMaterial({ color: color.getHex(), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
        const orbitLine = new THREE.Line(geometry, material);
        this.orbitPathLines.set(sat.id, orbitLine);
        this.scene.add(orbitLine);
    }

    private removeFocusedModel() {
        if (this.focusedModel) {
            this.scene.remove(this.focusedModel);
            this.focusedModel = null;
        }
    }

    private onClick(event: MouseEvent) {
        const id = this.getIntersectedSatelliteId(event);
        simulationStore.selectSatellite(id);
    }

    private onMouseMove(event: MouseEvent) {
        const id = this.getIntersectedSatelliteId(event);
        simulationStore.hoverSatellite(id);

        if (id) {
            simulationStore.setTooltipPos({ x: event.clientX, y: event.clientY });
            this.renderer.domElement.style.cursor = 'pointer';
        } else {
            simulationStore.setTooltipPos(null);
            this.renderer.domElement.style.cursor = 'default';
        }
    }

    private getIntersectedSatelliteId(event: MouseEvent): string | null {
        if (!this.instancedMesh) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const camDist = this.camera.position.length();
        this.raycaster.params.Points = { threshold: Math.max(20, camDist / 120) };
        const intersects = this.raycaster.intersectObject(this.instancedMesh.mesh);
        if (intersects && intersects.length > 0) {
            const first = intersects[0];
            if (first && first.index !== undefined) return this.satelliteIds[first.index] || null;
        }
        return null;
    }

    private onResize(): void {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    private lastViewMode: string = '3d';
    private transitionFactor: number = 0;
    private isTransitioning: boolean = false;

    // Consolidated tick method to be called from external loop
    public tick(): void {
        const state = simulationStore.getState();

        // Handle View Mode Transition
        if (state.viewMode !== this.lastViewMode) {
            this.lastViewMode = state.viewMode;
            this.isTransitioning = true;
            this.transitionFactor = 0;
        }

        if (this.isTransitioning) {
            this.transitionFactor += 0.02;
            if (this.transitionFactor >= 1) {
                this.transitionFactor = 1;
                this.isTransitioning = false;
            }

            if (state.viewMode === '2d') {
                // Animate to top-down view
                const targetPos = new THREE.Vector3(0, 0, 45000);
                this.camera.position.lerp(targetPos, 0.1);
                this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.1);
            } else {
                // Animate to perspective view
                const targetPos = new THREE.Vector3(15000, 15000, 30000);
                this.camera.position.lerp(targetPos, 0.1);
                this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.1);
            }
        }

        this.controls.update();
        this.earth.update(this.camera.position, state.visibleLayers, state.selectedMap, state.showDayNightLayer);
        this.groundStationLayer?.tick();
        this.renderer.render(this.scene, this.camera);
    }

    destroy(): void {
        window.removeEventListener('resize', this.boundResize);
        this.renderer.domElement.removeEventListener('click', this.boundClick);
        this.renderer.domElement.removeEventListener('mousemove', this.boundMouseMove);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

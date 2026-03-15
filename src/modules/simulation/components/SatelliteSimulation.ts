import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import gsap from 'gsap';
import { EarthScene } from './EarthScene';
import { SatelliteInstancedMesh } from './SatelliteInstancedMesh';
import { GroundStationLayer } from './GroundStationMesh';
import type { SimulatedSatellite } from '../modules/types';
import { simulationStore } from '../stores/simulationStore';
import { getSunPosition } from '../utils/sunUtils';
import { getSatelliteColor } from '../utils/satelliteUtils';
import { latLonToVector3 } from '../utils/coordUtils';

export class SatelliteSimulation {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private earth: EarthScene;
    private instancedMesh: SatelliteInstancedMesh | null = null;
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();
    private container: HTMLElement;
    private focusedModel: THREE.Group | null = null;
    private activeModelSatId: string | null = null;
    private orbitPathLines: Map<string, THREE.Line> = new Map();
    private isZoomed: boolean = false;
    private lastSelectedSatId: string | null = null;
    private lastSelectedGsId: string | null = null;
    private defaultCameraDistance = 45000;
    private groundStationLayer: GroundStationLayer | null = null;
    private sunLight: THREE.DirectionalLight;
    private boundResize: () => void;
    private boundClick: (e: MouseEvent) => void;
    private boundMouseMove: (e: MouseEvent) => void;
    private lastFollowSatPos: THREE.Vector3 | null = null;

    private visibilityCones: Map<string, THREE.Mesh> = new Map();
    private gsCoverageMeshes: Map<string, THREE.Mesh> = new Map();

    constructor(container: HTMLElement) {
        this.container = container;
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 10, 2000000);
        this.camera.position.set(12000, 12000, 24000);

        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true,
            logarithmicDepthBuffer: true // Anti-flicker for space scale
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
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

        this.earth = new EarthScene(this.scene);
        const earthGroup = this.earth.getGroup();
        earthGroup.name = 'earth';
        this.scene.add(earthGroup);

        this.boundResize = this.onResize.bind(this);
        this.boundClick = this.onClick.bind(this);
        this.boundMouseMove = this.onMouseMove.bind(this);

        window.addEventListener('resize', this.boundResize);
        this.renderer.domElement.addEventListener('click', this.boundClick);
        this.renderer.domElement.addEventListener('mousemove', this.boundMouseMove);

        this.groundStationLayer = new GroundStationLayer(
            this.scene, this.camera, this.controls, this.renderer
        );
        const gs = simulationStore.getState().groundStations;
        this.groundStationLayer.updateStations(gs);
    }

    initSatellites(satellites: SimulatedSatellite[]): void {
        if (this.instancedMesh) {
            this.instancedMesh.destroy();
        }
        this.instancedMesh = new SatelliteInstancedMesh(this.scene, satellites.length);
    }

    updateSatellites(satellites: SimulatedSatellite[]): void {
        const state = simulationStore.getState();
        const hoveredId = state.hoveredSatelliteId;
        const selectedId = state.selectedSatelliteId;

        if (!this.instancedMesh) {
            if (satellites.length > 0) {
                this.initSatellites(satellites);
            }
            return;
        }

        if (this.instancedMesh && satellites.length > 0) {
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
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const camDist = this.camera.position.length();
        // Tightened threshold for more precise hovering (approx 8 pixels)
        this.raycaster.params.Points = { threshold: Math.max(15, camDist / 160) };
    }

    private onClick(event: MouseEvent) {
        this.updateRaycaster(event);
        
        const satHit = this.getIntersectedSatelliteHit();
        const gsId = this.groundStationLayer?.getIntersectedGsId(this.raycaster);
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
            this.lastFollowSatPos = null;
            this.isZoomed = false;
            this.lastSelectedSatId = null;
            this.removeFocusedModel();
        } else if (earthIntersect.length > 0) {
            // Clicked on Earth -> Do nothing, don't reset camera
        } else {
            // Clicked on empty space -> Reset only if something was selected
            const state = simulationStore.getState();
            if (state.selectedSatelliteId || state.selectedGroundStationId) {
                simulationStore.selectSatellite(null);
                simulationStore.selectGroundStation(null);
                this.resetCameraZoom();
            }
            this.lastFollowSatPos = null;
        }
    }

    private onMouseMove(event: MouseEvent) {
        this.updateRaycaster(event);
        
        const satHit = this.getIntersectedSatelliteHit();
        const gsId = this.groundStationLayer?.getIntersectedGsId(this.raycaster);

        if (satHit) {
            simulationStore.hoverSatellite(satHit.id);
            simulationStore.hoverGroundStation(null);
            simulationStore.setTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setGsTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else if (gsId) {
            simulationStore.hoverGroundStation(gsId);
            simulationStore.hoverSatellite(null);
            simulationStore.setGsTooltipPos({ x: event.clientX, y: event.clientY });
            simulationStore.setTooltipPos(null);
            this.renderer.domElement.style.cursor = 'pointer';
        } else {
            simulationStore.hoverSatellite(null);
            simulationStore.hoverGroundStation(null);
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
            const state = simulationStore.getState();
            const satellites = Array.from(state.satellites.values()) as SimulatedSatellite[];
            const catSats = satellites.filter(s => s.category.toLowerCase() === mesh.category);
            const id = catSats[index]?.id;
            if (id) return { id, distance: firstSat.distance };
        }
        return null;
    }

    private onResize(): void {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    private lastViewMode: string = '3d';
    private satCartesianPositions: Map<string, THREE.Vector3> = new Map();
    private cameraTween: gsap.core.Tween | null = null;
    private targetTween: gsap.core.Tween | null = null;

    public tick(): void {
        const state = simulationStore.getState();

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
        const sunPos = getSunPosition(state.simulationTime);
        this.sunLight.position.copy(sunPos).multiplyScalar(100000);

        this.earth.update(this.camera.position, state.visibleLayers, state.selectedMap, state.showDayNightLayer, sunPos);
        
        if (this.instancedMesh) {
            this.instancedMesh.updatePositions(state.satellites, this.satCartesianPositions);
        }

        this.updateSimulationLayers(state, this.satCartesianPositions);
        this.groundStationLayer?.tick(null, this.satCartesianPositions);

        this.renderer.render(this.scene, this.camera);
    }

    private static readonly UP_VEC = new THREE.Vector3(0, 1, 0);

    private updateSimulationLayers(state: any, satPositions: Map<string, THREE.Vector3>) {
        const groundStations = state.groundStations;

        if (state.showVisibilityCones) {
            state.satellites.forEach((sat: SimulatedSatellite) => {
                const id = sat.id;
                let cone = this.visibilityCones.get(id);
                const pos = satPositions.get(id);
                if (!pos) return;

                if (!cone) {
                    const geometry = new THREE.ConeGeometry(1, 1, 32, 1, true);
                    const material = new THREE.MeshBasicMaterial({
                        color: getSatelliteColor(sat.category, id),
                        transparent: true,
                        opacity: 0.15,
                        side: THREE.DoubleSide,
                        depthWrite: false
                    });
                    cone = new THREE.Mesh(geometry, material);
                    this.visibilityCones.set(id, cone);
                    this.scene.add(cone);
                }
                cone.visible = true;
                const height = pos.length() - 6371;
                const dir = pos.clone().normalize();
                const centerPos = dir.clone().multiplyScalar(6371 + height / 2);
                cone.position.copy(centerPos);
                const halfAngle = 45 * Math.PI / 180;
                const baseRadius = height * Math.tan(halfAngle);
                cone.scale.set(baseRadius, height, baseRadius);
                cone.quaternion.setFromUnitVectors(SatelliteSimulation.UP_VEC, dir);
            });
        } else {
            this.visibilityCones.forEach(c => c.visible = false);
        }

        if (state.showGSNCoverage) {
            groundStations.forEach((gs: any) => {
                let disc = this.gsCoverageMeshes.get(gs.id);
                if (!disc) {
                    const geometry = new THREE.CircleGeometry(1000, 64);
                    const material = new THREE.MeshBasicMaterial({
                        color: 0x00ff00,
                        transparent: true,
                        opacity: 0.2,
                        side: THREE.DoubleSide,
                        depthWrite: false
                    });
                    disc = new THREE.Mesh(geometry, material);
                    this.gsCoverageMeshes.set(gs.id, disc);
                    this.scene.add(disc);
                }
                disc.visible = true;
                const gsPos = latLonToVector3(gs.lat, gs.lon, 10);
                disc.position.copy(gsPos);
                disc.lookAt(gsPos.clone().multiplyScalar(1.1));
            });
        } else {
            this.gsCoverageMeshes.forEach(m => m.visible = false);
        }
    }

    destroy(): void {
        window.removeEventListener('resize', this.boundResize);
        this.renderer.domElement.removeEventListener('click', this.boundClick);
        this.renderer.domElement.removeEventListener('mousemove', this.boundMouseMove);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

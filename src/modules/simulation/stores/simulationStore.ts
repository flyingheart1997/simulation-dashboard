import * as THREE from 'three';
import { TleLoader } from '../services/TleLoader';
import { OrbitPropagator } from '../services/OrbitPropagator';
import { KeplerPropagator } from '../services/KeplerPropagator';
import {
    SimulationState, TleData, GroundStation, DEFAULT_GROUND_STATIONS, SimulatedSatellite,
    KeplerParams, PredictedPass, DashboardType
} from '../modules/types';
import { latLonToVector3, calculateElevation } from '../utils/coordUtils';

class SimulationStore {
    private state: SimulationState = {
        satellites: new Map(),
        simulationTime: new Date(),
        speed: 1.0,
        isPlaying: true,
        selectedSatelliteId: null,
        hoveredSatelliteId: null,
        visibilityFilters: {
            starlink: true,
            gps: true,
            weather: true,
            comm: true
        },
        isLoading: false,
        loadingProgress: 0,
        loadingContext: 'init',
        tooltipPos: null,
        groundStations: DEFAULT_GROUND_STATIONS.map(gs => ({ ...gs, history: [], isSelected: false, isHovered: false })),
        selectedGroundStationId: null,
        hoveredGroundStationId: null,
        gsTooltipPos: null,
        visibleLayers: [],
        selectedMap: 'night',
        showDayNightLayer: true,
        showVisibilityCones: true,
        showGSNCoverage: true,
        showCommLinks: true,
        viewMode: '3d',
        dashboardType: 'simulation'
    };

    private propagators: Map<string, OrbitPropagator | KeplerPropagator> = new Map();
    private isManualMode: boolean = false;
    private listeners: Set<(state: SimulationState) => void> = new Set();
    private lastExternalTimeUpdate: number = 0;
    private lastNotifyTime: number = 0;
    private notifyThrottleMs: number = 32; // ~30fps for UI re-renders, WebGL stays at 60fps

    getState() { return this.state; }
    getPropagators() { return this.propagators; }

    subscribe(listener: (state: SimulationState) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(force: boolean = false) {
        const now = Date.now();
        if (!force && now - this.lastNotifyTime < this.notifyThrottleMs) return;
        this.lastNotifyTime = now;
        this.listeners.forEach(l => l({ ...this.state }));
    }

    async init(force: boolean = false) {
        if (this.isManualMode) return;
        if (this.state.satellites.size > 0 && !force) {
            this.state.isLoading = false;
            this.state.loadingProgress = 0;
            this.notify();
            return;
        }

        try {
            this.state.isLoading = true;
            this.state.loadingProgress = 5;
            this.notify();

            console.log(`[SimulationStore] Fetching global TLE data...`);
            let tles: TleData[] = await TleLoader.fetchAll();

            if (tles.length === 0) {
                console.warn('[SimulationStore] API failed, using mock data');
                tles = this.generateMockTles();
            }

            this.state.loadingProgress = 20;
            this.notify();

            const total = tles.length;
            tles.forEach((tle, index) => {
                const noradId = tle.line1.substring(2, 7).trim();
                const id = `${tle.category}-${noradId || index}`;

                const propagator = new OrbitPropagator(tle.line1, tle.line2);
                const initialPos = propagator.propagate(this.state.simulationTime);

                if (initialPos) {
                    this.propagators.set(id, propagator);
                    this.state.satellites.set(id, {
                        id,
                        noradId: noradId || 'N/A',
                        name: tle.name,
                        category: tle.category,
                        line1: tle.line1,
                        line2: tle.line2,
                        position: initialPos,
                        history: [initialPos],
                        orbitStartTime: this.state.simulationTime.getTime(),
                        isSelected: false,
                        isHovered: false
                    } as SimulatedSatellite);
                }

                if (index % 20 === 0) {
                    this.state.loadingProgress = 20 + Math.floor((index / total) * 75);
                    this.notify();
                }
            });

            this.state.loadingProgress = 100;
            this.notify();

        } catch (err) {
            console.error('[SimulationStore] Initialization failed:', err);
        } finally {
            setTimeout(() => {
                this.state.isLoading = false;
                this.notify();
            }, 800);
        }
    }

    public seedManualData(satellites: KeplerParams[], groundStations: any[]) {
        console.log('[SimulationStore] Seeding manual data', { satCount: satellites.length, gsCount: groundStations.length });

        this.isManualMode = true;
        this.state.satellites.clear();
        this.propagators.clear();

        const mappedGs: GroundStation[] = groundStations.map(gs => ({
            id: gs.id || `gs-${Math.random().toString(36).substr(2, 9)}`,
            name: gs.name || 'Unnamed GS',
            lat: gs.lat ?? gs.latitude ?? 0,
            lon: gs.lon ?? gs.longitude ?? 0,
            country: gs.country || '',
            countryCode: gs.countryCode || '',
            agency: gs.agency || '',
            type: gs.type || 'civilian',
            status: gs.status || 'active',
            established: gs.established,
            elevation: gs.elevation,
            minElevation: gs.minElevation ?? 10,
            antennas: gs.antennas,
            isSelected: false,
            isHovered: false,
            history: [],
            predictedPasses: []
        }));

        this.state.groundStations = mappedGs;

        satellites.forEach((sat, index) => {
            const id = (sat as any).id || `sat-${index}`;
            const propagator = new KeplerPropagator(sat);
            const initialPos = propagator.propagate(this.state.simulationTime);
            if (initialPos) {
                this.propagators.set(id, propagator);
                this.state.satellites.set(id, {
                    id,
                    noradId: (sat as any).noradId || '00000',
                    name: sat.name,
                    category: (sat as any).category || 'operational',
                    line1: '',
                    line2: '',
                    position: initialPos,
                    history: [initialPos],
                    orbitStartTime: sat.startTime,
                    orbitEndTime: sat.endTime,
                    isSelected: false,
                    isHovered: false
                } as SimulatedSatellite);
            }
        });

        this.notify();
    }

    private calculateNextTime(dtMs: number): Date {
        const dtSeconds = (dtMs / 1000) * this.state.speed;
        const nextTimeMs = this.state.simulationTime.getTime() + dtSeconds * 1000;

        // Find global simulation boundaries
        let minStart = Infinity;
        let maxEnd = -Infinity;

        this.state.satellites.forEach(sat => {
            if (sat.orbitStartTime) minStart = Math.min(minStart, sat.orbitStartTime);
            if (sat.orbitEndTime) maxEnd = Math.max(maxEnd, sat.orbitEndTime);
        });

        // Clamp and auto-pause at boundaries
        if (this.state.speed > 0) {
            if (this.state.dashboardType === 'simulation' && nextTimeMs >= maxEnd) {
                this.state.isPlaying = false;
                this.state.speed = 0;
                return new Date(maxEnd);
            }
        } else if (this.state.speed < 0) {
            if (nextTimeMs <= minStart) {
                this.state.isPlaying = false;
                this.state.speed = 0;
                return new Date(minStart);
            }
        }
        return new Date(nextTimeMs);
    }

    update(dtMs: number) {
        // Skip internal advancement if time was recently set externally (within 100ms)
        const isExternallyDriven = (Date.now() - this.lastExternalTimeUpdate < 100);

        if (this.state.isPlaying && !isExternallyDriven) {
            this.state.simulationTime = this.calculateNextTime(dtMs);
        }

        this.updateSatellitePositions();
        this.notify();
    }

    setSimulationTime(time: Date | number) {
        this.state.simulationTime = typeof time === 'number' ? new Date(time) : time;
        this.lastExternalTimeUpdate = Date.now();
        this.notify();
    }

    setDashboardType(type: DashboardType) {
        this.state.dashboardType = type;
        this.notify();
    }

    private updateSatellitePositions() {
        this.state.satellites.forEach((sat, id) => {
            const propagator = this.propagators.get(id);
            if (propagator) {
                let effectiveTime = this.state.simulationTime;

                if (sat.orbitStartTime && this.state.simulationTime.getTime() < sat.orbitStartTime) {
                    effectiveTime = new Date(sat.orbitStartTime);
                } else if (this.state.dashboardType === 'simulation' && sat.orbitEndTime) {
                    const endTime = new Date(sat.orbitEndTime);
                    if (this.state.simulationTime > endTime) {
                        effectiveTime = endTime;
                    }
                } else if (this.state.dashboardType === 'summary' && sat.orbitEndTime) {
                    const duration = sat.orbitEndTime - sat.orbitStartTime;
                    if (duration > 0) {
                        const elapsed = this.state.simulationTime.getTime() - sat.orbitStartTime;
                        const loopedElapsed = elapsed % duration;
                        effectiveTime = new Date(sat.orbitStartTime + (loopedElapsed < 0 ? loopedElapsed + duration : loopedElapsed));
                    }
                }

                const newPos = propagator.propagate(effectiveTime);
                if (newPos) {
                    sat.position = newPos;
                }

                if (sat.isSelected || sat.isHovered) {
                    const isInit = !!(sat.orbitPath && sat.orbitPath.length > 0);
                    sat.orbitPath = propagator.getOrbitPath(
                        effectiveTime,
                        sat.orbitStartTime,
                        sat.orbitEndTime,
                        isInit,
                        this.state.dashboardType
                    );
                }
            }
        });
    }

    setSpeed(speed: number) {
        this.state.speed = speed;
        this.notify();
    }

    togglePlay() {
        this.state.isPlaying = !this.state.isPlaying;
        this.notify();
    }

    resetTime() {
        this.state.simulationTime = new Date();
        this.notify();
    }


    selectSatellite(id: string | null) {
        if (this.state.selectedSatelliteId === id) return;

        if (this.state.selectedSatelliteId) {
            const prev = this.state.satellites.get(this.state.selectedSatelliteId);
            if (prev) prev.isSelected = false;
        }

        this.state.selectedSatelliteId = id;
        if (id) {
            const sat = this.state.satellites.get(id);
            if (sat) {
                sat.isSelected = true;
                const propagator = this.propagators.get(id);
                if (propagator) {
                    const isInit = !!(sat.orbitPath && sat.orbitPath.length > 0);
                    sat.orbitPath = propagator.getOrbitPath(this.state.simulationTime, sat.orbitStartTime, sat.orbitEndTime, isInit);
                }
            }
        }
        this.notify();
    }

    hoverSatellite(id: string | null) {
        if (this.state.hoveredSatelliteId === id) return;

        if (this.state.hoveredSatelliteId) {
            const prev = this.state.satellites.get(this.state.hoveredSatelliteId);
            if (prev) prev.isHovered = false;
        }
        this.state.hoveredSatelliteId = id;
        if (id) {
            const sat = this.state.satellites.get(id);
            if (sat) {
                sat.isHovered = true;
                if (!sat.orbitPath) {
                    const propagator = this.propagators.get(id);
                    if (propagator) {
                        sat.orbitPath = propagator.getOrbitPath(this.state.simulationTime, sat.orbitStartTime, sat.orbitEndTime, false);
                    }
                }
            }
        }
        this.notify();
    }

    setTooltipPos(pos: { x: number, y: number } | null) {
        this.state.tooltipPos = pos;
        this.notify();
    }

    selectGroundStation(id: string | null) {
        if (this.state.selectedGroundStationId === id) return;
        if (this.state.selectedGroundStationId) {
            const prev = this.state.groundStations.find(g => g.id === this.state.selectedGroundStationId);
            if (prev) prev.isSelected = false;
        }
        this.state.selectedGroundStationId = id;
        if (id) {
            const gs = this.state.groundStations.find(g => g.id === id);
            if (gs) {
                gs.isSelected = true;
                if (gs.history.length === 0) {
                    const events = [
                        { event: 'CONTACT', detail: 'Satellite ISS uplink acquired' },
                        { event: 'CONTACT', detail: 'Landsat-9 downlink completed' },
                        { event: 'MAINTENANCE', detail: 'Schedule calibration – antenna #2' },
                        { event: 'CONTACT', detail: 'Sentinel-6 telemetry received' },
                        { event: 'ALERT', detail: 'Interference detected – Band Ku' },
                        { event: 'CONTACT', detail: 'GPS IIF-12 tracking pass' },
                    ];
                    const now = new Date();
                    gs.history = events.map((e, i) => ({
                        timestamp: new Date(now.getTime() - (i * 3600 * 1000)),
                        event: e.event,
                        detail: e.detail
                    }));
                }
                this.updatePredictedPasses(id);
            }
        }
        this.notify();
    }

    private updatePredictedPasses(gsId: string) {
        const gs = this.state.groundStations.find(g => g.id === gsId);
        if (!gs) return;

        const passes: PredictedPass[] = [];
        const satellites = Array.from(this.state.satellites.values());

        const startTime = new Date(this.state.simulationTime);
        const durationHours = 4;
        const stepMinutes = 2;
        const totalSteps = (durationHours * 60) / stepMinutes;

        satellites.slice(0, 50).forEach(sat => {
            const propagator = this.propagators.get(sat.id);
            if (!propagator) return;

            let currentPass: PredictedPass | null = null;
            for (let i = 0; i < totalSteps; i++) {
                const checkTime = new Date(startTime.getTime() + i * stepMinutes * 60000);
                const pos = propagator.propagate(checkTime);
                if (!pos) continue;

                const elev = calculateElevation(pos, gs);
                const threshold = gs.minElevation ?? 5;
                if (elev > threshold) {
                    if (!currentPass) {
                        currentPass = {
                            satelliteId: sat.id,
                            satelliteName: sat.name,
                            startTime: checkTime,
                            endTime: checkTime,
                            maxElevation: elev
                        };
                    } else {
                        currentPass.endTime = checkTime;
                        if (elev > currentPass.maxElevation) {
                            currentPass.maxElevation = elev;
                        }
                    }
                } else if (currentPass) {
                    passes.push(currentPass);
                    currentPass = null;
                }
            }
            if (currentPass) passes.push(currentPass);
        });

        gs.predictedPasses = passes.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()).slice(0, 10);
        this.notify();
    }

    hoverGroundStation(id: string | null, pos?: { x: number; y: number }) {
        if (this.state.hoveredGroundStationId === id && this.state.gsTooltipPos === (pos || null)) return;

        if (this.state.hoveredGroundStationId) {
            const prev = this.state.groundStations.find(g => g.id === this.state.hoveredGroundStationId);
            if (prev) prev.isHovered = false;
        }
        this.state.hoveredGroundStationId = id;
        this.state.gsTooltipPos = pos || null;
        if (id) {
            const gs = this.state.groundStations.find(g => g.id === id);
            if (gs) gs.isHovered = true;
        }
        this.notify();
    }

    setGsTooltipPos(pos: { x: number, y: number } | null) {
        this.state.gsTooltipPos = pos;
        this.notify();
    }

    toggleLayer(layerId: string) {
        const currentLayers = this.state.visibleLayers || [];
        const isVisible = currentLayers.includes(layerId);

        if (isVisible) {
            this.state.visibleLayers = currentLayers.filter(l => l !== layerId);
        } else {
            this.state.visibleLayers = [...currentLayers, layerId];
        }
        this.notify();
    }

    setMap(mapType: 'night' | 'dark' | 'white') {
        this.state.selectedMap = mapType;
        this.notify();
    }

    toggleDayNightLayer() {
        this.state.showDayNightLayer = !this.state.showDayNightLayer;
        this.notify();
    }

    toggleVisibilityCones() {
        this.state.showVisibilityCones = !this.state.showVisibilityCones;
        this.notify();
    }

    toggleGSNCoverage() {
        this.state.showGSNCoverage = !this.state.showGSNCoverage;
        this.notify();
    }

    toggleCommLinks() {
        this.state.showCommLinks = !this.state.showCommLinks;
        this.notify();
    }

    setViewMode(mode: '2d' | '3d') {
        this.state.viewMode = mode;
        this.notify();
    }


    private generateMockTles(): TleData[] {
        const mocks: TleData[] = [];
        const categories = ['starlink', 'gps', 'weather', 'communication', 'operational'];
        for (let i = 0; i < 500; i++) {
            const cat = categories[i % categories.length] || 'communication';
            const mmValue = (10 + Math.random() * 6);
            const mm = mmValue.toFixed(8).padStart(11, ' ');
            const inc = (Math.random() * 98).toFixed(4).padStart(8, ' ');
            const raan = (Math.random() * 360).toFixed(4).padStart(8, ' ');
            const ma = (Math.random() * 360).toFixed(4).padStart(8, ' ');
            const noradId = (25544 + i).toString().padStart(5, '0');

            mocks.push({
                name: `${cat.toUpperCase()} SATCH-${i.toString().padStart(3, '0')}`,
                line1: `1 ${noradId}U 98067A   24065.52643519  .00016717  00000-0  30000-3 0  999${i % 10}`,
                line2: `2 ${noradId} ${inc} ${raan} 0005371  95.0000 ${ma} ${mm}12345`,
                category: cat
            });
        }
        return mocks;
    }
}

export const simulationStore = new SimulationStore();

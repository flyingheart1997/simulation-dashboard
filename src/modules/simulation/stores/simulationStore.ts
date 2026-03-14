import { TleLoader } from '../services/TleLoader';
import { OrbitPropagator } from '../services/OrbitPropagator';
import {
    SimulationState, TleData, GroundStation, DEFAULT_GROUND_STATIONS
} from '../modules/types';

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
        selectedCountry: 'GLOBAL',
        groundStations: DEFAULT_GROUND_STATIONS.map(gs => ({ ...gs, history: [], isSelected: false, isHovered: false })),
        selectedGroundStationId: null,
        hoveredGroundStationId: null,
        gsTooltipPos: null,
        visibleLayers: ['temperature', 'co2', 'ice'], // Default visible layers matching the design
        selectedMap: 'night',
        showDayNightLayer: true,
        viewMode: '3d'
    };

    private propagators: Map<string, OrbitPropagator> = new Map();
    private listeners: Set<(state: SimulationState) => void> = new Set();

    getState() { return this.state; }

    subscribe(listener: (state: SimulationState) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l({ ...this.state }));
    }

    async init(force: boolean = false) {
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

            console.log(`[SimulationStore] Fetching TLE data for ${this.state.selectedCountry}...`);
            let tles: TleData[] = await TleLoader.fetchAll(this.state.selectedCountry);

            // Fallback to mock data if fetch fails
            if (tles.length === 0) {
                console.warn('[SimulationStore] API failed, using mock data');
                tles = this.generateMockTles();
            }

            this.state.loadingProgress = 20;
            this.notify();

            console.log(`[SimulationStore] Fetched ${tles.length} TLEs`);

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
                        isSelected: false,
                        isHovered: false
                    });
                }

                // Update progress every 20 satellites for smoother feedback
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
            // Reduced delay for snappier transition while ensuring things finish mounting
            setTimeout(() => {
                this.state.isLoading = false;
                this.notify();
            }, 800);
        }
    }

    update(dtMs: number) {
        if (!this.state.isPlaying) return;

        const dtSeconds = (dtMs / 1000) * this.state.speed;
        this.state.simulationTime = new Date(this.state.simulationTime.getTime() + dtSeconds * 1000);

        this.state.satellites.forEach((sat, id) => {
            const propagator = this.propagators.get(id);
            if (propagator) {
                const newPos = propagator.propagate(this.state.simulationTime);
                if (newPos) {
                    sat.position = newPos;
                }
            }
        });

        this.notify();
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

    async setCountry(countryCode: string) {
        if (this.state.selectedCountry === countryCode) return;
        this.state.selectedCountry = countryCode;
        this.state.selectedSatelliteId = null;
        this.state.hoveredSatelliteId = null;
        this.state.tooltipPos = null;

        // Show loader immediately before wiping data
        this.state.isLoading = true;
        this.state.loadingProgress = 0;
        this.state.loadingContext = 'country-change';
        this.notify();

        // Wipe old data
        this.state.satellites.clear();
        this.propagators.clear();
        this.notify();

        // Brief pause to give browser a chance to render the loading UI
        await new Promise(resolve => setTimeout(resolve, 80));

        // Refetch immediately
        await this.init(true);
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
                    sat.orbitPath = propagator.getOrbitPath(this.state.simulationTime);
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
                // Compute orbit path on hover so the path can be rendered
                if (!sat.orbitPath) {
                    const propagator = this.propagators.get(id);
                    if (propagator) {
                        sat.orbitPath = propagator.getOrbitPath(this.state.simulationTime);
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
        // Deselect previous
        if (this.state.selectedGroundStationId) {
            const prev = this.state.groundStations.find(g => g.id === this.state.selectedGroundStationId);
            if (prev) prev.isSelected = false;
        }
        this.state.selectedGroundStationId = id;
        if (id) {
            const gs = this.state.groundStations.find(g => g.id === id);
            if (gs) {
                gs.isSelected = true;
                // Seed history if empty
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
            }
        }
        this.notify();
    }

    hoverGroundStation(id: string | null, pos?: { x: number; y: number }) {
        if (this.state.hoveredGroundStationId === id && this.state.gsTooltipPos === pos) return;

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

    setViewMode(mode: '2d' | '3d') {
        this.state.viewMode = mode;
        this.notify();
    }

    getFilteredGroundStations(): GroundStation[] {
        const country = this.state.selectedCountry;
        if (country === 'GLOBAL') return this.state.groundStations;
        // Filter to the country code which is a rough match on countryCode
        const countryMap: Record<string, string[]> = {
            'US': ['US'], 'PRC': ['PRC'], 'CIS': ['CIS'],
            'IND': ['IND'], 'ESA': ['DEU', 'ESP', 'GUF', 'SWE', 'NOR'], 'JPN': ['JPN']
        };
        const codes = countryMap[country] || [country];
        return this.state.groundStations.filter(gs => codes.includes(gs.countryCode));
    }

    private generateMockTles(): TleData[] {
        const mocks: TleData[] = [];
        const categories = ['starlink', 'gps', 'weather', 'communication'];
        for (let i = 0; i < 500; i++) {
            const cat = categories[i % categories.length] || 'communication';
            // Randomize parameters so satellites don't stack on exact same coordinate
            const raan = (Math.random() * 360).toFixed(4).padStart(8, ' ');
            const ma = (Math.random() * 360).toFixed(4).padStart(8, ' ');
            const inc = (Math.random() * 180).toFixed(4).padStart(8, ' ');
            const mm = (10 + Math.random() * 6).toFixed(8).padStart(11, ' ');

            mocks.push({
                name: `${cat.toUpperCase()} MOCK-${i}`,
                line1: `1 ${25544 + i}U 98067A   24065.52643519  .00016717  00000-0  30000-3 0  999${i % 10}`,
                line2: `2 ${25544 + i} ${inc} ${raan} 0005371  95.0000 ${ma} ${mm}${1234 + i}`,
                category: cat
            });
        }
        return mocks;
    }
}

export const simulationStore = new SimulationStore();

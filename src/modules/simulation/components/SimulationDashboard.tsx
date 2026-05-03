import { h, Component } from 'preact';
import { simulationStore } from '../stores/simulationStore';
import type { EditablePolygon, MapType, WorkspaceInteractionMode } from '../modules/types';
import '../styles/sim-dashboard-modern.css';

export class SimulationDashboard extends Component<any, { dragSpeed: number | null, collapsedPanels: Record<string, boolean>, isSettingsOpen: boolean }> {
    state = {
        dragSpeed: null,
        collapsedPanels: { right: false } as Record<string, boolean>,
        isSettingsOpen: false
    };

    private togglePanel = (panel: string) => {
        this.setState((prev) => ({
            collapsedPanels: { ...prev.collapsedPanels, [panel]: !prev.collapsedPanels[panel] }
        }));
    };

    private toggleSettings = () => {
        this.setState({ isSettingsOpen: !this.state.isSettingsOpen });
    };

    private unsub: (() => void) | null = null;
    private searchInput: string = '';

    componentDidMount() {
        this.unsub = simulationStore.subscribe(() => this.forceUpdate());
    }

    componentWillUnmount() {
        this.unsub?.();
    }

    private handleSearch = (e: Event) => {
        this.searchInput = (e.target as HTMLInputElement).value.toLowerCase();
        this.forceUpdate();
    };

    render() {
        const state = simulationStore.getState();
        const selectedSat = state.selectedSatelliteId ? state.satellites.get(state.selectedSatelliteId) : null;
        const selectedGs = state.selectedGroundStationId ? state.groundStations?.find(g => g.id === state.selectedGroundStationId) : null;

        if (state.isLoading) {
            const progress = state.loadingProgress || 0;
            const loadingTitle = 'Initializing Orbital Tracking';
            const loadingSub = `${progress}% Synchronizing telemetry streams...`;

            return h('div', { class: 'loading-overlay' },
                h('div', { class: 'loader-content' },
                    h('div', { class: 'corner top-left' }),
                    h('div', { class: 'corner top-right' }),
                    h('div', { class: 'corner bottom-left' }),
                    h('div', { class: 'corner bottom-right' }),
                    h('div', { class: 'cy-scanning' }),
                    h('div', { class: 'loader-brand' },
                        h('h1', null, 'ANTARIS'),
                        h('p', null, loadingTitle)
                    ),
                    h('div', { class: 'heartbeat-container' },
                        h('svg', { class: 'heartbeat-svg', viewBox: "0 0 400 100", preserveAspectRatio: "none" },
                            h('path', {
                                class: 'heartbeat-bg',
                                d: "M 0 50 L 80 50 L 90 30 L 100 70 L 110 50 L 140 50 L 150 10 L 160 90 L 170 50 L 200 50 L 210 30 L 220 70 L 230 50 L 260 50 L 270 10 L 280 90 L 290 50 L 320 50 L 330 30 L 340 70 L 350 50 L 400 50"
                            }),
                            h('path', {
                                id: 'heartbeat-progress-path',
                                class: 'heartbeat-progress',
                                d: "M 0 50 L 80 50 L 90 30 L 100 70 L 110 50 L 140 50 L 150 10 L 160 90 L 170 50 L 200 50 L 210 30 L 220 70 L 230 50 L 260 50 L 270 10 L 280 90 L 290 50 L 320 50 L 330 30 L 340 70 L 350 50 L 400 50",
                                style: {
                                    strokeDasharray: '1000',
                                    strokeDashoffset: (1000 - (1000 * (progress / 100))).toString()
                                }
                            })
                        )
                    ),
                    h('div', { class: 'loader-status' },
                        h('span', { class: 'loader-message' }, loadingSub.includes('%') ? loadingSub.split('%')[1]?.trim() : loadingSub),
                        h('span', { class: 'loader-percentage' }, `${progress}%`)
                    )
                )
            );
        }

        const activeCount = state.satellites.size;
        const debrisCount = Math.floor(activeCount * 0.7);
        const trackedCount = activeCount + debrisCount + 1245;

        let centerLat = 0, centerLon = 0, centerAlt = 0;
        if (state.hoveredSatelliteId) {
            const hSat = state.satellites.get(state.hoveredSatelliteId);
            if (hSat) {
                centerLat = hSat.position.lat; centerLon = hSat.position.lon; centerAlt = hSat.position.alt;
            }
        } else if (selectedSat) {
            centerLat = selectedSat.position.lat; centerLon = selectedSat.position.lon; centerAlt = selectedSat.position.alt;
        }

        return h('div', { class: 'sim-ui-modern' },
            // HEADER BAR
            h('div', { class: 'sim-top-bar' },
                h('div', { class: 'sim-brand', style: { flex: 1 } },
                    h('div', { class: 'sim-brand-icon' },
                        h('svg', {
                            viewBox: "0 0 24 24",
                            width: "100%",
                            height: "100%",
                            stroke: "var(--sim-accent-cyan)",
                            strokeWidth: "1.5",
                            fill: "none",
                            class: 'sim-logo-spin',
                            style: { filter: 'drop-shadow(0 0 5px var(--sim-accent-cyan))', position: 'absolute', zIndex: 2 }
                        },
                            h('path', { d: "M12 2a10 10 0 0 0-10 10c0 5.523 4.477 10 10 10s10-4.477 10-10A10 10 0 0 0 12 2Z" }),
                            h('path', { d: "M2 12h20" }),
                            h('path', { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" })
                        )
                    ),
                    h('div', { class: 'sim-brand-text' },
                        h('h1', null, 'ANTARIS'),
                        h('p', null, `ORBITAL SIMULATION DASHBOARD`)
                    )
                ),
                h('div', { class: 'sim-controls-right', style: { flex: 1, display: 'flex', justifyContent: 'flex-end' } },
                    h('div', {
                        class: 'sim-modern-btn-wrap settings-btn',
                        onClick: this.toggleSettings
                    },
                        h('div', { class: 'sim-modern-content' },
                            h('button', { class: 'sim-modern-btn' }, 'SETTINGS')
                        )
                    )
                )
            ),

            // MAIN AREA
            h('div', { class: 'sim-main-area' },
                h('div', { style: { flex: 1, pointerEvents: 'none' } })
            ),

            // SETTINGS MODAL
            this.state.isSettingsOpen && this.renderSettingsModal(state),

            // BOTTOM BAR
            h('div', { class: 'sim-bottom-bar' },
                (() => {
                    const displaySpeed = this.state.dragSpeed !== null ? this.state.dragSpeed : state.speed;
                    const speedToSlider = (s: number) => {
                        if (s > 60) return 60 + (s - 60) / 60;
                        if (s < -60) return -60 + (s + 60) / 60;
                        return s;
                    };
                    const sliderToSpeed = (v: number) => {
                        if (v > 60) return 60 + (v - 60) * 60;
                        if (v < -60) return -60 + (v + 60) * 60;
                        return v;
                    };
                    const sliderVal = speedToSlider(displaySpeed);
                    const t = (sliderVal + 69) / 138;
                    const cx = 3 * Math.pow(1 - t, 2) * t * 56 + 3 * (1 - t) * Math.pow(t, 2) * 504 + Math.pow(t, 3) * 560;
                    const cy = 3 * Math.pow(1 - t, 2) * t * 50 + 3 * (1 - t) * Math.pow(t, 2) * 50;

                    return h('div', { class: 'sim-speed-controller' },
                        h('div', { class: 'sim-speed-mid-row' },
                            h('span', { class: 'sim-speed-date' },
                                new Date(state.simulationTime).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()
                            ),
                            h('button', {
                                class: 'sim-live-button',
                                onClick: () => {
                                    simulationStore.setSpeed(1);
                                    if (!state.isPlaying) simulationStore.togglePlay();
                                },
                                title: 'Return to LIVE'
                            },
                                displaySpeed === 1 && state.isPlaying ? h('span', { class: 'sim-blink-dot' }) : null,
                                h('span', {
                                    style: { color: !state.isPlaying || displaySpeed === 0 ? 'var(--sim-accent-red)' : (displaySpeed === 1 ? 'var(--sim-accent-green)' : 'var(--sim-accent-cyan)') }
                                },
                                    (() => {
                                        if (!state.isPlaying || displaySpeed === 0) return 'PAUSED';
                                        if (displaySpeed === 1) return 'LIVE';
                                        const abs = Math.abs(displaySpeed);
                                        const m = Math.floor(abs / 60);
                                        const s = abs % 60;
                                        let str = '';
                                        if (m > 0) str += `${m} MIN`;
                                        if (s > 0) str += (str ? ` ${s} SEC` : `${s} SEC`);
                                        return displaySpeed > 0 ? `${str} FASTER` : `${str} SLOWER`;
                                    })()
                                )
                            ),
                            h('span', { class: 'sim-speed-time' },
                                new Date(state.simulationTime).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
                            )
                        ),
                        h('div', { class: 'sim-speed-track-container', style: { position: 'relative', width: '560px', height: '50px' } },
                            h('svg', {
                                viewBox: '0 0 560 50',
                                style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }
                            },
                                h('path', { d: 'M0,0 C56,50 504,50 560,0', fill: 'none', stroke: 'rgba(255,255,255,0.3)', strokeWidth: '2', strokeOpacity: '0.5', strokeLinecap: 'round' }),
                                h('circle', {
                                    cx: cx, cy: cy, r: 20,
                                    fill: 'rgba(37,37,39,0.85)', stroke: 'rgba(255, 255, 255, 0.1)', strokeWidth: '1',
                                    style: { transition: this.state.dragSpeed !== null ? 'none' : 'cx 0.1s linear, cy 0.1s linear' }
                                }),
                                h('circle', {
                                    cx: cx, cy: cy, r: 10,
                                    fill: displaySpeed === 0 ? 'var(--sim-accent-red)' : 'var(--sim-accent-green)',
                                    style: {
                                        filter: `drop-shadow(0 0 10px ${displaySpeed === 0 ? 'var(--sim-accent-red)' : 'var(--sim-accent-green)'})`,
                                        transition: this.state.dragSpeed !== null ? 'none' : 'cx 0.1s linear, cy 0.1s linear, fill 0.2s'
                                    }
                                })
                            ),
                            h('input', {
                                type: 'range', min: -69, max: 69, step: 1, value: sliderVal,
                                style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', margin: 0, padding: 0, opacity: 0, cursor: 'pointer', zIndex: 10 },
                                onInput: (e: any) => { const val = parseInt(e.target.value); this.setState({ dragSpeed: sliderToSpeed(val) }); },
                                onChange: (e: any) => {
                                    const val = parseInt(e.target.value);
                                    const finalSpeed = sliderToSpeed(val);
                                    simulationStore.setSpeed(finalSpeed);
                                    if (finalSpeed === 0 && state.isPlaying) simulationStore.togglePlay();
                                    else if (finalSpeed !== 0 && !state.isPlaying) simulationStore.togglePlay();
                                    this.setState({ dragSpeed: null });
                                }
                            })
                        )
                    );
                })()
            ),
            this.renderTooltips(state)
        );
    }

    private renderSettingsModal(state: any) {
        return h('div', { class: 'sim-modal-overlay', onClick: this.toggleSettings },
            h('div', { class: 'sim-settings-modal', onClick: (e: Event) => e.stopPropagation() },
                h('div', { class: 'sim-modal-header' },
                    h('h2', null, 'SYSTEM SETTINGS'),
                    h('button', { class: 'sim-modal-close', onClick: this.toggleSettings }, '✕')
                ),
                h('div', { class: 'sim-modal-content' },
                    // Map Selection
                    h('div', { class: 'sim-setting-group' },
                        h('h3', null, 'MAP SELECTION'),
                        h('div', { class: 'sim-map-grid' },
                            this.renderMapOption('dark', 'DARK MAP', state.selectedMap === 'dark'),
                            this.renderMapOption('satellite', 'SATELLITE MAP', state.selectedMap === 'satellite')
                        )
                    ),

                    // Visuals
                    h('div', { class: 'sim-setting-group' },
                        h('h3', null, 'VISUALS'),
                        h('div', { class: 'sim-toggle-list' },
                            this.renderToggleRow('🌑', 'Day / Night Layer', !!state.showDayNightLayer, () => simulationStore.toggleDayNightLayer()),
                            h('div', { class: 'sim-view-toggle-row' },
                                h('div', { class: 'sim-toggle-label' }, h('span', { class: 'sim-toggle-icon' }, '🌐'), h('span', null, 'View Mode')),
                                h('div', { class: 'sim-view-btn-group' },
                                    h('button', {
                                        class: `sim-view-btn ${state.viewMode === '2d' ? 'active' : ''}`,
                                        onClick: () => simulationStore.setViewMode('2d')
                                    }, '2D'),
                                    h('button', {
                                        class: `sim-view-btn ${state.viewMode === '3d' ? 'active' : ''}`,
                                        onClick: () => simulationStore.setViewMode('3d')
                                    }, '3D')
                                )
                            )
                        )
                    ),

                    h('div', { class: 'sim-setting-group' },
                        h('h3', null, 'WORKSPACE MODE'),
                        h('div', { class: 'sim-workspace-grid' },
                            this.renderWorkspaceMode('inspect', 'INSPECT', state.workspaceMode === 'inspect'),
                            this.renderWorkspaceMode('create-ground-station', 'CREATE GS', state.workspaceMode === 'create-ground-station'),
                            this.renderWorkspaceMode('create-ground-target', 'CREATE GT', state.workspaceMode === 'create-ground-target'),
                            this.renderWorkspaceMode('draw-polygon', state.workspaceMode === 'edit-polygon' ? 'EDIT AOI' : 'DRAW AOI', state.workspaceMode === 'draw-polygon' || state.workspaceMode === 'edit-polygon')
                        )
                    ),

                    // Data Layers
                    h('div', { class: 'sim-setting-group' },
                        h('h3', null, 'DATA LAYERS'),
                        h('div', { class: 'sim-data-grid' },
                            this.renderDataToggle('🌡️', 'Temperature', state.visibleLayers?.includes('temperature') ?? false, 'temperature'),
                            this.renderDataToggle('☁️', 'CO2 Levels', state.visibleLayers?.includes('co2') ?? false, 'co2'),
                            this.renderDataToggle('🌊', 'Ocean Heat', state.visibleLayers?.includes('ocean') ?? false, 'ocean'),
                            this.renderDataToggle('📊', 'Sea Level', state.visibleLayers?.includes('sealevel') ?? false, 'sealevel'),
                            this.renderDataToggle('❄️', 'Ice Coverage', state.visibleLayers?.includes('ice') ?? false, 'ice'),
                            this.renderDataToggle('🧲', 'Gravity Field', state.visibleLayers?.includes('gravity') ?? false, 'gravity')
                        )
                    ),

                    // Simulation Layers
                    h('div', { class: 'sim-setting-group' },
                        h('h3', null, 'SIMULATION LAYERS'),
                        h('div', { class: 'sim-toggle-list' },
                            this.renderToggleRow('👁️', 'Satellite Visibility Cone', !!state.showVisibilityCones, () => simulationStore.toggleVisibilityCones()),
                            this.renderToggleRow('📡', 'Ground Station Coverage', !!state.showGSNCoverage, () => simulationStore.toggleGSNCoverage()),
                            this.renderToggleRow('🔗', 'Communication Links', !!state.showCommLinks, () => simulationStore.toggleCommLinks())
                        )
                    )
                )
            )
        );
    }

    private renderMapOption(id: MapType, label: string, active: boolean) {
        return h('div', {
            class: `sim-map-option ${active ? 'active' : ''}`,
            onClick: () => simulationStore.setMap(id)
        },
            h('div', { class: `map-preview ${id}`, style: { overflow: 'hidden' } },
                h('div', { class: 'map-preview-overlay' })
            ),
            h('span', null, label)
        );
    }

    private renderWorkspaceMode(id: WorkspaceInteractionMode, label: string, active: boolean) {
        return h('button', {
            class: `sim-view-btn ${active ? 'active' : ''}`,
            onClick: () => {
                simulationStore.setViewMode('2d');
                simulationStore.setWorkspaceMode(id);
            }
        }, label);
    }

    private renderToggleRow(icon: string, label: string, checked: boolean, onChange: () => void) {
        return h('div', { class: 'sim-toggle-row' },
            h('div', { class: 'sim-toggle-label' }, h('span', { class: 'sim-toggle-icon' }, icon), h('span', null, label)),
            h('label', { class: 'sim-switch' }, h('input', { type: 'checkbox', checked, onChange }), h('span', { class: 'sim-slider' }))
        );
    }

    private renderDataToggle(icon: string, label: string, checked: boolean, layerId: string) {
        return h('div', { class: 'sim-toggle-row' },
            h('div', { class: 'sim-toggle-label' }, h('span', { class: 'sim-toggle-icon' }, icon), h('span', null, label)),
            h('label', { class: 'sim-switch' }, h('input', { type: 'checkbox', checked, onChange: () => simulationStore.toggleLayer(layerId) }), h('span', { class: 'sim-slider' }))
        );
    }

    private getClampedTooltipStyle(pos: { x: number; y: number }, width = 260, height = 190) {
        const margin = 16;
        const offset = 14;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
        const flipX = pos.x + width + offset > viewportWidth - margin;
        const flipY = pos.y + height + offset > viewportHeight - margin;
        const left = Math.max(margin, Math.min(pos.x, viewportWidth - margin));
        const top = Math.max(margin, Math.min(pos.y, viewportHeight - margin));

        return {
            left: `${left}px`,
            top: `${top}px`,
            position: 'fixed',
            width: `min(${width}px, calc(100vw - ${margin * 2}px))`,
            maxWidth: `calc(100vw - ${margin * 2}px)`,
            transform: flipX
                ? (flipY ? `translate(calc(-100% - ${offset}px), calc(-100% - ${offset}px))` : `translate(calc(-100% - ${offset}px), ${offset}px)`)
                : (flipY ? `translate(${offset}px, calc(-100% - ${offset}px))` : `translate(${offset}px, ${offset}px)`)
        };
    }

    private getPolygonCenter(poly: EditablePolygon): { lat: number; lon: number } {
        const lat = poly.points.reduce((sum, point) => sum + point.lat, 0) / Math.max(1, poly.points.length);
        const lonVector = poly.points.reduce((sum, point) => {
            const lonRad = point.lon * Math.PI / 180;
            sum.x += Math.cos(lonRad);
            sum.y += Math.sin(lonRad);
            return sum;
        }, { x: 0, y: 0 });
        return {
            lat,
            lon: Math.atan2(lonVector.y, lonVector.x) * 180 / Math.PI
        };
    }

    private renderTooltips(state: any) {
        if (state.hoveredSatelliteId && state.tooltipPos) {
            const sat = state.satellites.get(state.hoveredSatelliteId);
            if (sat) {
                return h('div', {
                    class: 'intel-tooltip-modern',
                    style: this.getClampedTooltipStyle(state.tooltipPos, 285, 210)
                },
                    h('div', { class: 'tt-header' },
                        h('div', { class: 'tt-icon' }, '🛰️'),
                        h('div', null,
                            h('div', { class: 'tt-name' }, sat.name),
                            h('div', { class: 'tt-category' }, sat.category.toUpperCase())
                        )
                    ),
                    h('div', { class: 'tt-body' },
                        h('div', { class: 'tt-row' }, h('span', null, 'CURRENT'), h('span', null, new Date(state.simulationTime).toLocaleTimeString([], { hour12: false }))),
                        h('div', { class: 'tt-row' }, h('span', null, 'START'), h('span', null, new Date(sat.orbitStartTime).toLocaleTimeString([], { hour12: false }))),
                        (state.dashboardType !== 'operate' && sat.orbitEndTime !== undefined && sat.orbitEndTime !== null) && h('div', { class: 'tt-row' }, h('span', null, 'END'), h('span', null, new Date(sat.orbitEndTime).toLocaleTimeString([], { hour12: false }))),
                        h('div', { class: 'tt-row' }, h('span', null, 'LAT/LON'), h('span', null, `${sat.position.lat.toFixed(2)}°, ${sat.position.lon.toFixed(2)}°`)),
                        h('div', { class: 'tt-row' }, h('span', null, 'ALTITUDE'), h('span', null, sat.position.alt.toFixed(0) + ' km'))
                    )
                );
            }
        }

        if (state.hoveredGroundStationId && state.gsTooltipPos) {
            const gs = state.groundStations?.find((g: any) => g.id === state.hoveredGroundStationId);
            if (gs) {
                return h('div', {
                    class: 'intel-tooltip-modern',
                    style: this.getClampedTooltipStyle(state.gsTooltipPos, 275, 180)
                },
                    h('div', { class: 'tt-header' },
                        h('div', { class: 'tt-icon' }, '📡'),
                        h('div', null,
                            h('div', { class: 'tt-name' }, gs.name),
                            h('div', { class: 'tt-category' }, `${gs.country} · ${gs.agency}`)
                        )
                    ),
                    h('div', { class: 'tt-body' },
                        h('div', { class: 'tt-row' }, h('span', null, 'STATUS'), h('span', { style: { color: 'var(--sim-accent-green)' } }, gs.status?.toUpperCase() || 'ACTIVE')),
                        h('div', { class: 'tt-row' }, h('span', null, 'COORDS'), h('span', null, `${gs.lat.toFixed(2)}°, ${gs.lon.toFixed(2)}°`)),
                        h('div', { class: 'tt-row' }, h('span', null, 'HORIZON'), h('span', null, (gs.minElevation || 10) + '° ELEV'))
                    )
                );
            }
        }

        if (state.hoveredPolygonId && state.tooltipPos) {
            const polygon = state.polygons?.find((poly: EditablePolygon) => poly.id === state.hoveredPolygonId);
            if (polygon) {
                const center = this.getPolygonCenter(polygon);
                return h('div', {
                    class: 'intel-tooltip-modern',
                    style: this.getClampedTooltipStyle(state.tooltipPos, 295, 200)
                },
                    h('div', { class: 'tt-header' },
                        h('div', { class: 'tt-icon' }, '▰'),
                        h('div', null,
                            h('div', { class: 'tt-name' }, polygon.name),
                            h('div', { class: 'tt-category' }, polygon.classification || 'AREA OF INTEREST')
                        )
                    ),
                    h('div', { class: 'tt-body' },
                        h('div', { class: 'tt-row' }, h('span', null, 'REGION'), h('span', null, polygon.region || 'User defined')),
                        h('div', { class: 'tt-row' }, h('span', null, 'CENTER'), h('span', null, `${center.lat.toFixed(2)}°, ${center.lon.toFixed(2)}°`)),
                        h('div', { class: 'tt-row' }, h('span', null, 'VERTICES'), h('span', null, `${polygon.points.length}`)),
                        h('div', { class: 'tt-row' }, h('span', null, 'STATUS'), h('span', { style: { color: 'var(--sim-accent-green)' } }, polygon.isClosed ? 'CLOSED' : 'DRAFT'))
                    )
                );
            }
        }
        return null;
    }
}

import { h, Component } from 'preact';
import { simulationStore } from '../stores/simulationStore';
import { TleLoader } from '../services/TleLoader';
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
        const selectedGs = state.selectedGroundStationId ? (state as any).groundStations?.find((g: any) => g.id === state.selectedGroundStationId) : null;

        if (state.isLoading) {
            const progress = state.loadingProgress || 0;
            const isCountryChange = (state as any).loadingContext === 'country-change';
            const countryLabels: Record<string, string> = {
                'GLOBAL': 'GLOBAL', 'US': 'UNITED STATES', 'PRC': 'CHINA',
                'CIS': 'RUSSIA', 'IND': 'INDIA', 'ESA': 'EUROPE', 'JPN': 'JAPAN'
            };
            const countryLabel = countryLabels[(state as any).selectedCountry] || (state as any).selectedCountry;
            const loadingTitle = isCountryChange
                ? `Switching to ${countryLabel}`
                : 'Initializing Orbital Tracking';
            const loadingSub = isCountryChange
                ? `${progress}% Target data acquisition...`
                : `${progress}% Synchronizing telemetry streams...`;

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
                        h('span', { class: 'loader-message' }, (loadingSub as any).split('%')[1]?.trim() || loadingSub),
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
                h('div', { class: 'sim-top-mid', style: { display: 'flex', justifyContent: 'center', flex: 1 } },
                    h('div', { class: 'sim-global-stats' },
                        h('div', { class: 'sim-stat-item' }, h('span', { class: 'sim-stat-val', style: { color: 'var(--sim-accent-cyan)' } }, trackedCount.toLocaleString()), h('span', { class: 'sim-stat-lbl' }, 'TRACKED')),
                        h('div', { class: 'sim-stat-item' }, h('span', { class: 'sim-stat-val', style: { color: 'var(--sim-accent-orange)' } }, debrisCount.toLocaleString()), h('span', { class: 'sim-stat-lbl' }, 'DEBRIS')),
                        h('div', { class: 'sim-stat-item' }, h('span', { class: 'sim-stat-val', style: { color: 'var(--sim-accent-green)' } }, activeCount.toLocaleString()), h('span', { class: 'sim-stat-lbl' }, 'ACTIVE'))
                    )
                ),
                h('div', { class: 'sim-controls-right', style: { flex: 1, display: 'flex', justifyContent: 'flex-end' } },
                    h('div', { class: 'sim-modern-btn-wrap' },
                        h('div', { class: 'sim-modern-content', style: { padding: '0px' } },
                            h('select', {
                                class: 'sim-modern-select',
                                value: state.selectedCountry,
                                onChange: (e: any) => simulationStore.setCountry(e.target.value)
                            },
                                Object.entries(TleLoader.COUNTRY_LABELS).map(([code, label]) =>
                                    h('option', { value: code }, label + (code === 'GLOBAL' ? ' (500)' : ''))
                                )
                            )
                        )
                    ),
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
                // Left panel removed as requested
                h('div', { style: { flex: 1, pointerEvents: 'none' } }),

                // Right panel
                h('div', { class: `sim-side-panel right-panel ${this.state.collapsedPanels.right ? 'collapsed' : ''}` },
                    (selectedSat || selectedGs) ? this.renderIntelPanel(selectedSat, selectedGs, state) : this.renderGlobalRightPanel(state)
                )
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
                })(),
                h('div', { class: 'sim-coordinates', style: { pointerEvents: 'auto' } },
                    h('span', null, h('span', { class: 'sim-coord-lbl' }, 'LAT:'), h('span', { class: 'sim-coord-val' }, centerLat.toFixed(3) + '°')),
                    h('span', null, h('span', { class: 'sim-coord-lbl' }, 'LON:'), h('span', { class: 'sim-coord-val' }, centerLon.toFixed(3) + '°')),
                    h('span', null, h('span', { class: 'sim-coord-lbl' }, 'ALT:'), h('span', { class: 'sim-coord-val' }, centerAlt.toFixed(0) + ' km'))
                )
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
                            this.renderMapOption('night', 'NIGHT MAP', state.selectedMap === 'night'),
                            this.renderMapOption('dark', 'DARK MAP', state.selectedMap === 'dark'),
                            this.renderMapOption('white', 'WHITE MAP', state.selectedMap === 'white')
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
                    )
                )
            )
        );
    }

    private renderMapOption(id: string, label: string, active: boolean) {
        return h('div', {
            class: `sim-map-option ${active ? 'active' : ''}`,
            onClick: () => simulationStore.setMap(id as any)
        },
            h('div', { class: `map-preview ${id}` }),
            h('span', null, label)
        );
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

    private renderGlobalRightPanel(state: any) {
        const timeOffset = state.simulationTime.getTime() / 1000;
        const surfaceTemp = 14.8 + Math.sin(timeOffset / 100) * 0.3;
        const co2Conc = 421.4 + Math.cos(timeOffset / 120) * 1.5;
        const oceanTemp = 0.93 + Math.sin(timeOffset / 200) * 0.05;
        const seaIce = Math.max(0, 4.92 + Math.cos(timeOffset / 300) * 0.08);
        const gravity = -20 + Math.sin(timeOffset / 50) * 2;
        const ozone = Math.round(287 + Math.cos(timeOffset / 80) * 5);

        return h('div', { class: 'sim-right-global-container', style: { display: 'flex', flexDirection: 'column', height: '100%' } },
            h('div', { class: 'sim-panel-header', onClick: () => this.togglePanel('right'), style: { cursor: 'pointer' } },
                h('div', { class: 'sim-panel-title', style: { flex: 1 } }, 'TELEMETRY'),
                h('div', { class: 'sim-collapse-arrow', style: { transform: this.state.collapsedPanels.right ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.3s' } }, '▼')
            ),
            !this.state.collapsedPanels.right && h('div', { class: 'sim-telemetry-list', style: { display: 'flex', flexDirection: 'column', gap: '15px' } },
                this.renderTelemetryBar('SURFACE TEMP', `+ ${surfaceTemp.toFixed(2)}°C`, 65, 'orange'),
                this.renderTelemetryBar('CO2 CONC.', `${co2Conc.toFixed(1)} PPM`, 85, 'red'),
                this.renderTelemetryBar('OCEAN TEMP', `+ ${oceanTemp.toFixed(2)}°C`, 45, 'cyan'),
                this.renderTelemetryBar('SEA ICE', `${seaIce.toFixed(2)}M KM²`, 30, 'cyan'),
                this.renderTelemetryBar('GRAVITY', `${gravity.toFixed(0)} MGAL`, 50, 'cyan'),
                this.renderTelemetryBar('OZONE', `${ozone} DU`, 75, 'green')
            )
        );
    }

    private renderIntelPanel(sat: any, gs: any, state: any) {
        if (sat) {
            return h('div', { class: 'sim-intel-panel' },
                h('div', { class: 'intel-panel-header' }, h('h2', null, sat.name), h('div', { class: 'intel-sub-title' }, `${sat.category.toUpperCase()} · TRACKED OBJECT`)),
                h('div', { class: 'stat-group' },
                    this.renderStatRow('NORAD ID', sat.noradId || 'UNKNOWN'),
                    this.renderStatRow('LATITUDE', `${sat.position.lat.toFixed(3)}°`),
                    this.renderStatRow('LONGITUDE', `${sat.position.lon.toFixed(3)}°`),
                    this.renderStatRow('ALTITUDE', `${sat.position.alt.toFixed(0)} km`)
                )
            );
        } else if (gs) {
            return h('div', { class: 'sim-intel-panel' },
                h('div', { class: 'intel-panel-header' }, h('h2', null, gs.name), h('div', { class: 'intel-sub-title' }, `${gs.agency} · ${gs.country} `)),
                h('div', { class: 'stat-group' },
                    this.renderStatRow('COORD', `${gs.lat?.toFixed(2)}°, ${gs.lon?.toFixed(2)}°`),
                    this.renderStatRow('ELEVATION', `${gs.elevation ?? '—'} m`)
                )
            );
        }
        return null;
    }

    private renderStatRow(lbl: string, val: string) {
        return h('div', { class: 'stat-row' }, h('span', { class: 'stat-lbl' }, lbl), h('span', { class: 'stat-val' }, val));
    }

    private renderTelemetryBar(label: string, valueStr: string, percentage: number, colorClass: string) {
        return h('div', { class: 'sim-telemetry-row' },
            h('div', { class: 'sim-tel-header' }, h('span', null, label), h('span', { class: `sim-tel-val ${colorClass}` }, valueStr)),
            h('div', { class: 'sim-tel-bar' }, h('div', { class: `sim-tel-fill ${colorClass}`, style: { width: `${percentage}%` } }))
        );
    }

    private renderTooltips(state: any) {
        if (state.hoveredSatelliteId && state.tooltipPos) {
            const sat = state.satellites.get(state.hoveredSatelliteId);
            if (sat) return h('div', { class: 'sat-intel-tooltip-modern', style: { left: `${state.tooltipPos.x + 15}px`, top: `${state.tooltipPos.y + 15}px` } }, h('div', { class: 'tt-title' }, sat.name));
        }
        return null;
    }
}

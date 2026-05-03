import { h, render } from 'preact';
import { SimulationDashboard } from './SimulationDashboard';
import { SatelliteSimulation } from './SatelliteSimulation';
import { simulationStore } from '../stores/simulationStore';
import type { MapType } from '../modules/types';

interface SimulationShowOptions {
    onlineMap?: boolean;
    editMode?: boolean;
    mapType?: MapType;
    viewMode?: '2d' | '3d';
}

export class SimulationManager {
    private container: HTMLElement | null = null;
    private dashboardRoot: HTMLElement | null = null;
    private simulation: SatelliteSimulation | null = null;
    private isActive: boolean = false;
    private onExitCallback: (() => void) | null = null;
    private updateInterval: any;

    constructor() {
        // Global access for the exit button inside SimulationDashboard
        if (typeof window !== 'undefined') {
            (window as any).exitSimulation = () => this.hide();
        }
    }

    public async show(parent: HTMLElement, onExit?: () => void, options: SimulationShowOptions = {}): Promise<void> {
        if (this.isActive) return;

        this.onExitCallback = onExit || null;
        this.isActive = true;
        const editMode = options.editMode ?? false;

        if (editMode) {
            simulationStore.setWorkspaceMode('create-ground-station');
        } else {
            simulationStore.setWorkspaceMode('inspect');
            if (options.mapType) simulationStore.setMap(options.mapType);
        }
        simulationStore.setViewMode(editMode ? '2d' : options.viewMode ?? '3d');

        // Create main container
        this.container = document.createElement('div');
        this.container.className = 'simulation-view-container';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.position = 'relative';
        this.container.style.backgroundColor = '#000';
        parent.appendChild(this.container);

        // Create 3D Scene Container
        const sceneContainer = document.createElement('div');
        sceneContainer.className = 'sim-scene-container';
        sceneContainer.style.width = '100%';
        sceneContainer.style.height = '100%';
        this.container.appendChild(sceneContainer);

        // Create Dashboard UI Root
        this.dashboardRoot = document.createElement('div');
        this.dashboardRoot.className = 'sim-ui-root';
        this.container.appendChild(this.dashboardRoot);

        // Initialize 3D Simulation
        this.simulation = new SatelliteSimulation(sceneContainer, options.onlineMap ?? false, editMode);

        // Initialize Store and Fetch Data
        render(h(SimulationDashboard, {}), this.dashboardRoot);

        // Start data fetching
        await simulationStore.init();
        
        // Start simulation loop
        this.startUpdateLoop();
    }

    private startUpdateLoop() {
        let lastTime = performance.now();
        const loop = (now: number) => {
            const dt = now - lastTime;
            lastTime = now;

            simulationStore.update(dt);
            if (this.simulation) {
                this.simulation.updateSatellites(simulationStore.getState().satellites);
                this.simulation.tick();
            }

            this.updateInterval = requestAnimationFrame(loop);
        };
        this.updateInterval = requestAnimationFrame(loop);
    }

    private stopUpdateLoop() {
        if (this.updateInterval) cancelAnimationFrame(this.updateInterval);
    }

    public hide(): void {
        if (!this.isActive) return;

        this.stopUpdateLoop();

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        if (this.simulation) {
            this.simulation.destroy();
            this.simulation = null;
        }

        if (this.dashboardRoot) {
            render(null, this.dashboardRoot);
            this.dashboardRoot = null;
        }

        this.isActive = false;
        if (this.onExitCallback) {
            this.onExitCallback();
        }
    }

    public isVisible(): boolean {
        return this.isActive;
    }
}

// Export singleton instance
export const simulationView = new SimulationManager();

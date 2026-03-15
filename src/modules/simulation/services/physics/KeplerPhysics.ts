import { MU, EARTH_RADIUS, getECICoordinates, eciToLLA, LLA } from './satellitePosition';
import { solveKepler } from './keplerSolver';

export interface OrbitState {
    name: string;
    altitude: number;
    inclination: number; // degrees
    eccentricity: number;
    RAAN: number; // degrees
    AP: number; // degrees
    TA: number; // degrees (True Anomaly at startTime)
    startTime: number;
    endTime?: number;
}

export class KeplerPhysicsPropagator {
    private state: OrbitState;
    private a: number; // Semi-major axis
    private n: number; // Mean motion
    private raan: number; // radians
    private ap: number; // radians
    private inc: number; // radians
    private initialM: number; // Initial mean anomaly

    constructor(state: OrbitState) {
        this.state = state;
        this.a = EARTH_RADIUS + state.altitude;
        this.n = Math.sqrt(MU / Math.pow(this.a, 3));
        
        this.raan = (state.RAAN * Math.PI) / 180;
        this.ap = (state.AP * Math.PI) / 180;
        this.inc = (state.inclination * Math.PI) / 180;

        // Calculate initial mean anomaly from true anomaly
        const nu0 = (state.TA * Math.PI) / 180;
        const E0 = 2 * Math.atan(Math.sqrt((1 - state.eccentricity) / (1 + state.eccentricity)) * Math.tan(nu0 / 2));
        this.initialM = E0 - state.eccentricity * Math.sin(E0);
    }

    public propagate(time: number): LLA {
        const dt = (time - this.state.startTime) / 1000; // time delta in seconds
        const M = this.initialM + this.n * dt;

        const E = solveKepler(M, this.state.eccentricity);
        const nu = 2 * Math.atan(Math.sqrt((1 + this.state.eccentricity) / (1 - this.state.eccentricity)) * Math.tan(E / 2));

        const eci = getECICoordinates(this.a, this.state.eccentricity, this.inc, this.raan, this.ap, nu);
        return eciToLLA(eci, time);
    }

    public getOrbitalPeriod(): number {
        return 2 * Math.PI * Math.sqrt(Math.pow(this.a, 3) / MU);
    }
}

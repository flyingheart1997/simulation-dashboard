import * as satellite from 'satellite.js';
import { SatellitePosition } from '../modules/types';

export class OrbitPropagator {
    private satrec: satellite.SatRec;

    constructor(line1: string, line2: string) {
        this.satrec = satellite.twoline2satrec(line1, line2);
    }

    propagate(date: Date = new Date()): SatellitePosition | null {
        const positionAndVelocity = satellite.propagate(this.satrec, date);
        if (!positionAndVelocity || !positionAndVelocity.position || !positionAndVelocity.velocity) return null;

        const positionEci = positionAndVelocity.position as satellite.EciVec3<number>;
        const gmst = satellite.gstime(date);
        const positionGd = satellite.eciToGeodetic(positionEci, gmst);

        return {
            lat: satellite.degreesLat(positionGd.latitude),
            lon: satellite.degreesLong(positionGd.longitude),
            alt: positionGd.height,
            velocity: Math.sqrt(
                Math.pow((positionAndVelocity.velocity as any).x, 2) +
                Math.pow((positionAndVelocity.velocity as any).y, 2) +
                Math.pow((positionAndVelocity.velocity as any).z, 2)
            )
        };
    }

    getOrbitPath(startTime: Date, steps: number = 60, intervalMin: number = 1): SatellitePosition[] {
        const path: SatellitePosition[] = [];
        for (let i = 0; i < steps; i++) {
            const time = new Date(startTime.getTime() + i * intervalMin * 60000);
            const pos = this.propagate(time);
            if (pos) path.push(pos);
        }
        return path;
    }
}

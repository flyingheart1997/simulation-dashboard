import { KeplerPhysicsPropagator as PhysicsPropagator } from './physics/KeplerPhysics';
import { SatellitePosition } from '../modules/types';

export class KeplerPropagator {
    private propagator: PhysicsPropagator;
    private pathPoints: { time: number; pos: SatellitePosition }[] = [];
    private lastPathUpdate: number = 0;
    private lastCurrentTime: number = 0;

    constructor(params: {
        name: string;
        altitude: number;
        inclination: number;
        eccentricity: number;
        RAAN: number;
        AP: number;
        TA: number;
        startTime: number;
    }) {
        this.propagator = new PhysicsPropagator(params);
    }

    propagate(date: Date = new Date()): SatellitePosition | null {
        try {
            const lla = this.propagator.propagate(date.getTime());
            const r = 6371 + lla.alt;
            return {
                lat: lla.lat,
                lon: lla.lon,
                alt: lla.alt,
                velocity: Math.sqrt(398600.4418 / r)
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Implementation of sliding window orbit path:
     * 1. If total duration <= 90m: Show the full orbit from start to end.
     * 2. If duration > 90m & elapsed < 60m: Pin window to [startTime, startTime + 90m].
     * 3. If duration > 90m & elapsed >= 60m: Sliding window [currentTime - 45m, currentTime + 45m].
     * 4. Optimization: Uses "Shift & Push" caching to update only necessary points every 60s.
     */
    getOrbitPath(
        currentTime: Date,
        orbitStartTimeMs: number,
        orbitEndTimeMs?: number,
        isInitialized: boolean = true,
        dashboardType: 'simulation' | 'summary' | 'operate' = 'operate'
    ): SatellitePosition[] {
        const nowMs = currentTime.getTime();
        const totalDuration = orbitEndTimeMs ? (orbitEndTimeMs - orbitStartTimeMs) : Infinity;

        // 1. RULE: If total duration <= 90m, always show full orbit
        if (totalDuration <= 90 * 60000) {
            if (this.pathPoints.length === 0) {
                const steps = 90;
                const stepSize = totalDuration / steps;
                for (let i = 0; i <= steps; i++) {
                    const t = orbitStartTimeMs + i * stepSize;
                    const pos = this.propagate(new Date(t));
                    if (pos) this.pathPoints.push({ time: t, pos });
                }
            }
            return this.pathPoints.map(p => p.pos);
        }

        // 2. SLIDING WINDOW LOGIC (for duration > 90m)
        const elapsed = nowMs - orbitStartTimeMs;
        const step = 60000; // 1 minute resolution
        let windowStart: number;
        let windowEnd: number;

        if (elapsed < 60 * 60000) {
            // Before 60m: Pin window to start
            windowStart = orbitStartTimeMs;
            windowEnd = orbitStartTimeMs + 90 * 60000;
        } else {
            // After 60m: Sliding window (45m past, 45m future)
            windowStart = nowMs - 45 * 60000;
            const potentialEnd = nowMs + 45 * 60000;
            windowEnd = (orbitEndTimeMs && potentialEnd > orbitEndTimeMs) ? orbitEndTimeMs : potentialEnd;
        }

        // Clamp windowStart to start boundary (safety)
        if (windowStart < orbitStartTimeMs) windowStart = orbitStartTimeMs;

        // 3. Update throttle: Only update if time moved significantly or first time
        const timeJump = Math.abs(nowMs - this.lastCurrentTime);
        this.lastCurrentTime = nowMs;

        if (timeJump > 10 * 60000) {
            // Large jump detected (e.g. scrubbing): Reset cache
            this.pathPoints = [];
        }

        if (Math.abs(nowMs - this.lastPathUpdate) < 60000 && this.pathPoints.length > 0) {
            // Check if we just crossed the 60m threshold (force update if so)
            const wasBeforeThreshold = (this.lastPathUpdate - orbitStartTimeMs) < 60 * 60000;
            const isNowAfterThreshold = (nowMs - orbitStartTimeMs) >= 60 * 60000;
            if (wasBeforeThreshold === isNowAfterThreshold) {
                return this.pathPoints.map(p => p.pos);
            }
        }

        // Initialize or Update points
        if (this.pathPoints.length === 0) {
            for (let t = windowStart; t <= windowEnd; t += step) {
                const pos = this.propagate(new Date(t));
                if (pos) this.pathPoints.push({ time: t, pos });
            }
        } else {
            // Shift old points
            while (this.pathPoints.length > 0 && this.pathPoints[0].time < windowStart) {
                this.pathPoints.shift();
            }

            // Push future points
            let lastT = this.pathPoints.length > 0 ? this.pathPoints[this.pathPoints.length - 1].time : windowStart;
            while (lastT < windowEnd) {
                lastT += step;
                const pos = this.propagate(new Date(lastT));
                if (pos) this.pathPoints.push({ time: lastT, pos });
            }

            // Unshift past points (for rewind or initialization jumps)
            let firstT = this.pathPoints.length > 0 ? this.pathPoints[0].time : windowEnd;
            while (firstT > windowStart) {
                firstT -= step;
                if (firstT < orbitStartTimeMs) break;
                const pos = this.propagate(new Date(firstT));
                if (pos) this.pathPoints.unshift({ time: firstT, pos });
            }
        }

        this.lastPathUpdate = nowMs;
        return this.pathPoints.map(p => p.pos);
    }
}

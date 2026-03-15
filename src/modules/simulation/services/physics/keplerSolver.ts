/**
 * Solves Kepler's equation M = E - e * sin(E) for E (Eccentric Anomaly).
 * Uses Newton-Raphson iteration.
 */
export function solveKepler(M: number, eccentricity: number): number {
    const TOLERANCE = 1e-8;
    const MAX_ITERATIONS = 100;

    let E = M; // initial guess
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const deltaE = (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E));
        E -= deltaE;
        if (Math.abs(deltaE) < TOLERANCE) break;
    }
    return E;
}

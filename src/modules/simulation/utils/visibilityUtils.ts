import { GroundStation, SatellitePosition, SimulatedSatellite } from '../types';

export interface LatLonPoint {
    lat: number;
    lon: number;
}

export interface VisibleSatelliteLink {
    satellite: SimulatedSatellite;
    elevationDeg: number;
    coverageCentralAngleRad: number;
}

const EARTH_RADIUS_KM = 6371;

export function calculateElevationDeg(satPos: SatellitePosition, gs: GroundStation): number {
    const gsVec = geodeticToCartesian(gs.lat, gs.lon, 0);
    const satVec = geodeticToCartesian(satPos.lat, satPos.lon, satPos.alt);
    const rangeX = satVec.x - gsVec.x;
    const rangeY = satVec.y - gsVec.y;
    const rangeZ = satVec.z - gsVec.z;
    const range = Math.sqrt(rangeX * rangeX + rangeY * rangeY + rangeZ * rangeZ);
    if (range <= 0.001) return -90;

    const upX = gsVec.x / EARTH_RADIUS_KM;
    const upY = gsVec.y / EARTH_RADIUS_KM;
    const upZ = gsVec.z / EARTH_RADIUS_KM;
    const dot = (rangeX / range) * upX + (rangeY / range) * upY + (rangeZ / range) * upZ;
    return Math.asin(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

export function isSatelliteVisibleFromGroundStation(satPos: SatellitePosition, gs: GroundStation): boolean {
    return calculateElevationDeg(satPos, gs) >= (gs.minElevation ?? 10);
}

export function findBestVisibleSatellite(
    gs: GroundStation,
    satellites: Iterable<SimulatedSatellite>
): VisibleSatelliteLink | null {
    let best: VisibleSatelliteLink | null = null;
    const minElevationDeg = gs.minElevation ?? 10;

    for (const satellite of satellites) {
        const elevationDeg = calculateElevationDeg(satellite.position, gs);
        if (elevationDeg < minElevationDeg) continue;

        if (!best || elevationDeg > best.elevationDeg) {
            best = {
                satellite,
                elevationDeg,
                coverageCentralAngleRad: calculateCoverageCentralAngleRad(
                    satellite.position.alt,
                    minElevationDeg
                )
            };
        }
    }

    return best;
}

export function calculateCoverageCentralAngleRad(altitudeKm: number, minElevationDeg: number): number {
    const orbitalRadius = EARTH_RADIUS_KM + Math.max(0, altitudeKm);
    const elevationRad = minElevationDeg * Math.PI / 180;
    const earthRatio = EARTH_RADIUS_KM / orbitalRadius;
    const cosElevation = Math.cos(elevationRad);
    const sinElevation = Math.sin(elevationRad);
    const rootTerm = Math.max(0, 1 - earthRatio * earthRatio * cosElevation * cosElevation);
    const cosCentralAngle = earthRatio * cosElevation * cosElevation + sinElevation * Math.sqrt(rootTerm);
    return Math.acos(Math.max(-1, Math.min(1, cosCentralAngle)));
}

export function buildCoverageFootprint(
    gs: LatLonPoint,
    centralAngleRad: number,
    samples: number = 128
): LatLonPoint[] {
    const points: LatLonPoint[] = [];
    const lat1 = gs.lat * Math.PI / 180;
    const lon1 = gs.lon * Math.PI / 180;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinAngular = Math.sin(centralAngleRad);
    const cosAngular = Math.cos(centralAngleRad);

    for (let i = 0; i <= samples; i++) {
        const bearing = (i / samples) * Math.PI * 2;
        const lat2 = Math.asin(
            sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearing)
        );
        const lon2 = lon1 + Math.atan2(
            Math.sin(bearing) * sinAngular * cosLat1,
            cosAngular - sinLat1 * Math.sin(lat2)
        );

        points.push({
            lat: lat2 * 180 / Math.PI,
            lon: normalizeLongitude(lon2 * 180 / Math.PI)
        });
    }

    return points;
}

export function getEarthRadiusKm(): number {
    return EARTH_RADIUS_KM;
}

function geodeticToCartesian(latDeg: number, lonDeg: number, altKm: number) {
    const lat = latDeg * Math.PI / 180;
    const lon = lonDeg * Math.PI / 180;
    const radius = EARTH_RADIUS_KM + altKm;
    return {
        x: radius * Math.cos(lat) * Math.cos(lon),
        y: radius * Math.sin(lat),
        z: radius * Math.cos(lat) * Math.sin(lon)
    };
}

function normalizeLongitude(lon: number): number {
    let normalized = lon;
    while (normalized <= -180) normalized += 360;
    while (normalized > 180) normalized -= 360;
    return normalized;
}


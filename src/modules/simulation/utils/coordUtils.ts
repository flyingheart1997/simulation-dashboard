import * as THREE from 'three';
import { SatellitePosition, GroundStation } from '../types';

/**
 * Converts Geodetic coordinates (Lat, Lon, Alt) to Cartesian ECEF (X, Y, Z).
 * Earth radius is 6371 km.
 */
export function latLonToVector3(lat: number, lon: number, altInKm: number): THREE.Vector3 {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const r = 6371 + altInKm;
    return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
    );
}

/**
 * Calculates the elevation of a satellite relative to a ground station observer.
 * Returns elevation in degrees.
 */
export function calculateElevation(satPos: SatellitePosition, gs: GroundStation): number {
    const satVec = latLonToVector3(satPos.lat, satPos.lon, satPos.alt);
    const gsVec = latLonToVector3(gs.lat, gs.lon, 0); // GS is at surface (alt=0 relative to sea level for this math)

    const rangeVec = satVec.clone().sub(gsVec);
    const upVec = gsVec.clone().normalize();

    // Elevation = asin(range . up / |range|)
    const dot = rangeVec.dot(upVec);
    const elev = Math.asin(dot / rangeVec.length()) * (180 / Math.PI);
    return elev;
}

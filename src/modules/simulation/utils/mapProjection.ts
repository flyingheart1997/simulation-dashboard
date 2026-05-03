import * as THREE from 'three';

export interface FlatMapBounds {
    width: number;
    height: number;
}

export interface LatLon {
    lat: number;
    lon: number;
}

export const DEFAULT_FLAT_MAP_BOUNDS: FlatMapBounds = {
    width: 36000,
    height: 18000
};

export function clampLatitude(lat: number): number {
    return Math.max(-90, Math.min(90, lat));
}

export function normalizeLongitude(lon: number): number {
    let normalized = lon;
    while (normalized <= -180) normalized += 360;
    while (normalized > 180) normalized -= 360;
    return normalized;
}

export function latLonToFlatVector3(
    lat: number,
    lon: number,
    z: number = 0,
    bounds: FlatMapBounds = DEFAULT_FLAT_MAP_BOUNDS
): THREE.Vector3 {
    const x = (normalizeLongitude(lon) / 180) * (bounds.width / 2);
    const y = (clampLatitude(lat) / 90) * (bounds.height / 2);
    return new THREE.Vector3(x, y, z);
}

export function flatVectorToLatLon(
    point: THREE.Vector3,
    bounds: FlatMapBounds = DEFAULT_FLAT_MAP_BOUNDS
): LatLon {
    return {
        lat: clampLatitude((point.y / (bounds.height / 2)) * 90),
        lon: normalizeLongitude((point.x / (bounds.width / 2)) * 180)
    };
}

export function calculateCoveringFlatBounds(containerWidth: number, containerHeight: number): FlatMapBounds {
    const aspect = containerWidth > 0 && containerHeight > 0
        ? containerWidth / containerHeight
        : DEFAULT_FLAT_MAP_BOUNDS.width / DEFAULT_FLAT_MAP_BOUNDS.height;

    return {
        width: DEFAULT_FLAT_MAP_BOUNDS.height * aspect,
        height: DEFAULT_FLAT_MAP_BOUNDS.height
    };
}


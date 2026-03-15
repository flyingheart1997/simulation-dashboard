import * as THREE from 'three';

/**
 * Calculates the Sun's position relative to Earth at a given date.
 * Returns a normalized vector pointing towards the Sun in ECI coordinates.
 * This is a simplified astronomical calculation.
 */
export function getSunPosition(date: Date): THREE.Vector3 {
    // Julian date calculation
    const jd = (date.getTime() / 86400000) - (date.getTimezoneOffset() / 1440) + 2440587.5;
    const n = jd - 2451545.0;
    
    // Mean longitude of the Sun
    let L = 280.460 + 0.9856474 * n;
    // Mean anomaly of the Sun
    let g = 357.528 + 0.9856003 * n;
    
    L = L % 360;
    g = g % 360;
    
    const lambda = L + 1.915 * Math.sin(g * Math.PI / 180) + 0.020 * Math.sin(2 * g * Math.PI / 180);
    const epsilon = 23.439 - 0.0000004 * n;
    
    const x = Math.cos(lambda * Math.PI / 180);
    const y = Math.cos(epsilon * Math.PI / 180) * Math.sin(lambda * Math.PI / 180);
    const z = Math.sin(epsilon * Math.PI / 180) * Math.sin(lambda * Math.PI / 180);
    
    // Convert to Three.js coordinates (Y is up, Z is depth)
    // In our sim, Z is towards the viewer, Y is North Pole.
    return new THREE.Vector3(x, z, -y).normalize();
}

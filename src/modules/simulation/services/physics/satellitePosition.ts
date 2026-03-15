import * as THREE from 'three';

export const MU = 398600.4418; // Earth's gravitational parameter (km^3/s^2)
export const EARTH_RADIUS = 6371; // Earth's radius in km

export interface LLA {
    lat: number;
    lon: number;
    alt: number;
}

/**
 * Converts orbital plane coordinates to ECI (Earth-Centered Inertial) coordinates.
 */
export function getECICoordinates(
    a: number,
    e: number,
    i: number,
    raan: number,
    ap: number,
    nu: number
): THREE.Vector3 {
    // 1. Distance from focal point
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));

    // 2. Position in the orbital plane (perifocal coordinate system)
    const x_orb = r * Math.cos(nu);
    const y_orb = r * Math.sin(nu);

    // 3. Coordinate transformation to ECI frame
    const cos_raan = Math.cos(raan);
    const sin_raan = Math.sin(raan);
    const cos_i = Math.cos(i);
    const sin_i = Math.sin(i);
    const cos_ap = Math.cos(ap);
    const sin_ap = Math.sin(ap);

    const x = x_orb * (cos_raan * cos_ap - sin_raan * sin_ap * cos_i) - 
              y_orb * (cos_raan * sin_ap + sin_raan * cos_ap * cos_i);
    
    const y = x_orb * (sin_raan * cos_ap + cos_raan * sin_ap * cos_i) + 
              y_orb * (cos_raan * cos_ap * cos_i - sin_raan * sin_ap);
    
    const z = x_orb * (sin_ap * sin_i) + y_orb * (cos_ap * sin_i);

    return new THREE.Vector3(x, y, z);
}

/**
 * Converts ECI coordinates to LLA (Latitude, Longitude, Altitude).
 * Note: Simplified spherical earth model for visualization.
 */
export function eciToLLA(position: THREE.Vector3, time: number): LLA {
    const x = position.x;
    const y = position.y;
    const z = position.z;

    const r = Math.sqrt(x * x + y * y + z * z);
    const alt = r - EARTH_RADIUS;

    // Calculate Latitude
    const lat = Math.asin(z / r) * (180 / Math.PI);

    // Calculate Longitude (taking into account Earth's rotation)
    // Earth rotates ~360 degrees in ~23h 56m 4s (86164.1 seconds)
    const earthRotationSeconds = 86164.1;
    const rotationVelocity = (2 * Math.PI) / earthRotationSeconds;
    const gst = rotationVelocity * (time / 1000); // Greenwhich Sidereal Time approximation

    let lon = (Math.atan2(y, x) - gst) * (180 / Math.PI);
    
    // Normalize longitude to [-180, 180]
    while (lon <= -180) lon += 360;
    while (lon > 180) lon -= 360;

    return { lat, lon, alt };
}

import * as THREE from 'three';

const CATEGORY_COLORS: Record<string, number> = {
    starlink: 0x00ffff, // Cyan
    gps: 0xffd700,      // Yellow/Gold
    weather: 0x00ff88,  // Green
    communication: 0xff00ff, // Magenta
    operational: 0x00ffcc, // Teal
    default: 0x00ffff
};

/**
 * Returns a consistent color for a satellite based on its category,
 * with subtle variations based on ID to keep individual satellites distinct.
 */
export function getSatelliteColor(category: string, id: string): THREE.Color {
    const baseColor = new THREE.Color(CATEGORY_COLORS[category.toLowerCase()] || CATEGORY_COLORS.default);
    
    // Hash the ID to get a deterministic variation
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Generate subtle variations in Hue and Lightness
    const hsl: { h: number, s: number, l: number } = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(hsl);
    
    // Adjust hue by +/- 5% and lightness by +/- 10%
    const hVar = ((hash % 100) / 1000) - 0.05;
    const lVar = (((hash >> 8) % 100) / 500) - 0.1;
    
    const color = new THREE.Color();
    color.setHSL(
        Math.max(0, Math.min(1, hsl.h + hVar)),
        hsl.s,
        Math.max(0.3, Math.min(0.8, hsl.l + lVar))
    );
    
    return color;
}

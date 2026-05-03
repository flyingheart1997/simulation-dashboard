import type { MapType } from '../types/types';

export interface SimulationDataLayerStyle {
    id: string;
    color: number;
    opacity2d: number;
    opacity3d: number;
    additive: boolean;
}

export interface SimulationMapStyle {
    id: MapType;
    label: string;
    background: number;
    fallbackTexture: string;
}

export const SIMULATION_NIGHT_TEXTURE = '/textures/earth-night.jpg';
export const SIMULATION_SKY_TEXTURE = '/textures/night-sky.png';

export const SIMULATION_MAP_STYLES: Record<MapType, SimulationMapStyle> = {
    dark: {
        id: 'dark',
        label: 'Dark',
        background: 0x030b12,
        fallbackTexture: '/textures/earth-dark.png'
    },
    satellite: {
        id: 'satellite',
        label: 'Satellite',
        background: 0x061018,
        fallbackTexture: '/textures/earth-light.jpg'
    }
};

export const SIMULATION_DATA_LAYER_STYLES: SimulationDataLayerStyle[] = [
    { id: 'temperature', color: 0xff3b1f, opacity2d: 0.3, opacity3d: 0.18, additive: true },
    { id: 'co2', color: 0x29ffb2, opacity2d: 0.24, opacity3d: 0.11, additive: true },
    { id: 'ocean', color: 0x1b73ff, opacity2d: 0.28, opacity3d: 0.28, additive: true },
    { id: 'sealevel', color: 0x00e5ff, opacity2d: 0.25, opacity3d: 0.18, additive: true },
    { id: 'ice', color: 0xffffff, opacity2d: 0.24, opacity3d: 0.36, additive: false },
    { id: 'gravity', color: 0xb14cff, opacity2d: 0.2, opacity3d: 0.13, additive: true }
];

export function getSimulationMapStyle(id: MapType | string): SimulationMapStyle {
    return SIMULATION_MAP_STYLES[(id as MapType) in SIMULATION_MAP_STYLES ? id as MapType : 'dark'];
}

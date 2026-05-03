import type { MapType } from '../types/types';

export const MAPBOX_STYLE_IDS: Record<MapType, string> = {
    dark: 'dark-v11',
    satellite: 'satellite-v9'
};

export function getPublicMapboxToken(): string {
    return (
        process.env.NEXT_PUBLIC_MAPBOX_TOKEN
        || process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN
        || ''
    ).trim();
}

export function getConfiguredMapLibreStyleUrl(mapType: MapType): string {
    const darkStyle = process.env.NEXT_PUBLIC_MAPLIBRE_DARK_STYLE_URL || '';
    const satelliteStyle = process.env.NEXT_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL || '';
    return (mapType === 'dark' ? darkStyle : satelliteStyle).trim();
}

export function getMapboxRasterTileTemplate(
    mapType: MapType,
    token: string,
    highDpi = true
): string {
    const styleId = MAPBOX_STYLE_IDS[mapType];
    const scale = highDpi ? '@2x' : '';
    return `https://api.mapbox.com/styles/v1/mapbox/${styleId}/tiles/512/{z}/{x}/{y}${scale}?access_token=${token}`;
}

export function resolveRasterTileUrl(
    template: string,
    mapType: MapType,
    zoom: number,
    x: number,
    y: number,
    token: string
): string {
    return template
        .replace('{z}', String(zoom))
        .replace('{x}', String(x))
        .replace('{y}', String(y))
        .replace('{token}', token)
        .replace('{accessToken}', token)
        .replace('{mapboxAccessToken}', token)
        .replace('{mapType}', mapType);
}

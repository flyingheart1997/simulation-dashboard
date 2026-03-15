export interface TleData {
    name: string;
    line1: string;
    line2: string;
    category: string;
}

export interface KeplerParams {
    name: string;
    altitude: number;
    inclination: number;
    eccentricity: number;
    RAAN: number;
    AP: number;
    TA: number;
    startTime: number;
    endTime?: number;
}

export interface SatellitePosition {
    lat: number;
    lon: number;
    alt: number;
    velocity: number;
}

export interface SatelliteInfo {
    id: string;
    name: string;
    category: string;
    noradId?: string;
}

export interface SimulatedSatellite extends SatelliteInfo {
    position: SatellitePosition;
    line1: string;
    line2: string;
    history: SatellitePosition[];
    orbitPath?: SatellitePosition[];
    orbitStartTime: number;
    orbitEndTime?: number;
    isSelected: boolean;
    isHovered: boolean;
}

export interface GroundStationHistory {
    timestamp: Date;
    event: string;
    detail: string;
}

export interface GroundStation {
    id: string;
    name: string;
    lat: number;
    lon: number;
    country: string;
    countryCode: string;
    agency: string;
    type: 'military' | 'civilian' | 'commercial' | 'research';
    status: 'active' | 'inactive' | 'maintenance';
    established?: number; // year
    elevation?: number;   // meters
    minElevation?: number; // connection threshold in degrees
    antennas?: number;
    isSelected: boolean;
    isHovered: boolean;
    history: GroundStationHistory[];
    predictedPasses?: PredictedPass[];
}

export interface ManualGroundStation {
    id: string;
    name: string;
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
    country?: string;
    countryCode?: string;
    agency?: string;
    type?: 'military' | 'civilian' | 'commercial' | 'research';
    status?: 'active' | 'inactive' | 'maintenance';
    minElevation?: number;
}

export interface PredictedPass {
    satelliteId: string;
    satelliteName: string;
    startTime: Date;
    endTime: Date;
    maxElevation: number;
}

export const DEFAULT_GROUND_STATIONS: GroundStation[] = [
    { id: 'GS-01', name: 'Svalbard', lat: 78.23, lon: 15.40, country: 'Norway', countryCode: 'NOR', agency: 'KSAT', type: 'commercial', status: 'active', established: 1997, elevation: 458, minElevation: 5, antennas: 31, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-02', name: 'Troll Satellite Station', lat: -72.01, lon: 2.53, country: 'Norway', countryCode: 'NOR', agency: 'KSAT', type: 'research', status: 'active', established: 2010, elevation: 1270, minElevation: 10, antennas: 4, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-03', name: 'Kiruna', lat: 67.85, lon: 20.96, country: 'Sweden', countryCode: 'SWE', agency: 'SSC', type: 'commercial', status: 'active', established: 1978, elevation: 395, minElevation: 5, antennas: 14, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-04', name: 'Inuvik', lat: 68.32, lon: -133.53, country: 'Canada', countryCode: 'CAN', agency: 'SSC/CSA', type: 'commercial', status: 'active', established: 2010, elevation: 68, minElevation: 10, antennas: 6, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-05', name: 'Maspalomas', lat: 27.76, lon: -15.63, country: 'Spain', countryCode: 'ESP', agency: 'INTA/ESA', type: 'research', status: 'active', established: 1960, elevation: 205, minElevation: 5, antennas: 8, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-06', name: 'Perth', lat: -31.80, lon: 115.89, country: 'Australia', countryCode: 'AUS', agency: 'SSC', type: 'commercial', status: 'active', established: 1990, elevation: 60, minElevation: 10, antennas: 10, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-07', name: 'Kourou', lat: 5.23, lon: -52.76, country: 'French Guiana', countryCode: 'GUF', agency: 'ESA/CNES', type: 'civilian', status: 'active', established: 1968, elevation: 8, minElevation: 5, antennas: 12, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-08', name: 'Sioux Falls', lat: 43.54, lon: -96.73, country: 'United States', countryCode: 'US', agency: 'USGS/NASA', type: 'civilian', status: 'active', established: 1986, elevation: 489, minElevation: 10, antennas: 5, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-09', name: 'Alice Springs', lat: -23.70, lon: 133.88, country: 'Australia', countryCode: 'AUS', agency: 'NASA/DSN', type: 'research', status: 'active', established: 1975, elevation: 616, minElevation: 5, antennas: 3, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-10', name: 'Mauritius', lat: -20.34, lon: 57.55, country: 'Mauritius', countryCode: 'MUS', agency: 'EUMETSAT', type: 'civilian', status: 'active', established: 1992, elevation: 570, minElevation: 15, antennas: 2, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-11', name: 'Goldstone', lat: 35.43, lon: -116.89, country: 'United States', countryCode: 'US', agency: 'NASA/JPL', type: 'research', status: 'active', established: 1958, elevation: 1036, minElevation: 5, antennas: 8, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-12', name: 'Madrid Deep Space', lat: 40.43, lon: -4.25, country: 'Spain', countryCode: 'ESP', agency: 'NASA/ESA', type: 'research', status: 'active', established: 1960, elevation: 830, minElevation: 5, antennas: 5, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-13', name: 'Canberra DSN', lat: -35.40, lon: 148.98, country: 'Australia', countryCode: 'AUS', agency: 'NASA/DSN', type: 'research', status: 'active', established: 1965, elevation: 680, minElevation: 5, antennas: 4, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-14', name: 'Baikonur', lat: 45.92, lon: 63.34, country: 'Kazakhstan', countryCode: 'KAZ', agency: 'Roscosmos', type: 'military', status: 'active', established: 1957, elevation: 90, minElevation: 10, antennas: 20, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-15', name: 'Jiuquan', lat: 40.96, lon: 100.29, country: 'China', countryCode: 'PRC', agency: 'CNSA', type: 'military', status: 'active', established: 1958, elevation: 1000, minElevation: 5, antennas: 15, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-16', name: 'Esrange', lat: 67.89, lon: 21.07, country: 'Sweden', countryCode: 'SWE', agency: 'SSC', type: 'research', status: 'active', established: 1966, elevation: 316, minElevation: 5, antennas: 9, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-17', name: 'ISRO Bangalore', lat: 13.06, lon: 77.57, country: 'India', countryCode: 'IND', agency: 'ISRO', type: 'civilian', status: 'active', established: 1972, elevation: 921, minElevation: 5, antennas: 11, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-18', name: 'McMurdo', lat: -77.85, lon: 166.67, country: 'Antarctica', countryCode: 'ATA', agency: 'NASA', type: 'research', status: 'active', established: 2001, elevation: 10, minElevation: 20, antennas: 3, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-19', name: 'Santiago', lat: -33.15, lon: -70.67, country: 'Chile', countryCode: 'CHL', agency: 'ESA', type: 'research', status: 'active', established: 1990, elevation: 713, minElevation: 5, antennas: 4, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-20', name: 'Hartebeesthoek', lat: -25.89, lon: 27.71, country: 'South Africa', countryCode: 'ZAF', agency: 'SANSA/NASA', type: 'research', status: 'active', established: 1961, elevation: 1415, minElevation: 10, antennas: 6, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-21', name: 'Tanegashima', lat: 30.40, lon: 130.97, country: 'Japan', countryCode: 'JPN', agency: 'JAXA', type: 'civilian', status: 'active', established: 1969, elevation: 60, minElevation: 10, antennas: 8, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-22', name: 'Cape Canaveral', lat: 28.39, lon: -80.60, country: 'United States', countryCode: 'US', agency: 'NASA/Space Force', type: 'military', status: 'active', established: 1950, elevation: 3, minElevation: 5, antennas: 30, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-23', name: 'ESA ESOC Darmstadt', lat: 49.87, lon: 8.65, country: 'Germany', countryCode: 'DEU', agency: 'ESA', type: 'civilian', status: 'active', established: 1967, elevation: 140, minElevation: 5, antennas: 10, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-24', name: 'Oberpfaffenhofen', lat: 48.08, lon: 11.28, country: 'Germany', countryCode: 'DEU', agency: 'DLR', type: 'research', status: 'active', established: 1980, elevation: 600, minElevation: 5, antennas: 7, isSelected: false, isHovered: false, history: [] },
    { id: 'GS-25', name: 'Plesetsk', lat: 62.93, lon: 40.57, country: 'Russia', countryCode: 'CIS', agency: 'Roscosmos', type: 'military', status: 'active', established: 1957, elevation: 140, minElevation: 10, antennas: 18, isSelected: false, isHovered: false, history: [] },
];

export interface SimulationState {
    satellites: Map<string, SimulatedSatellite>;
    groundStations: GroundStation[];
    selectedGroundStationId: string | null;
    hoveredGroundStationId: string | null;
    gsTooltipPos: { x: number, y: number } | null;
    simulationTime: Date;
    speed: number;
    isPlaying: boolean;
    selectedSatelliteId: string | null;
    hoveredSatelliteId: string | null;
    visibilityFilters: {
        starlink: boolean;
        gps: boolean;
        weather: boolean;
        comm: boolean;
    };
    isLoading: boolean;
    loadingProgress: number;
    loadingContext: 'init';
    tooltipPos: { x: number, y: number } | null;
    visibleLayers: string[];
    selectedMap: 'night' | 'dark' | 'white';
    showDayNightLayer: boolean;
    showVisibilityCones: boolean;
    showGSNCoverage: boolean;
    showCommLinks: boolean;
    viewMode: '2d' | '3d';
    dashboardType: DashboardType;
}

export type DashboardType = 'simulation' | 'summary' | 'operate';
export type MapType = 'night' | 'dark' | 'white';

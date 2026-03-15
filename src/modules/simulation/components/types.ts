export interface SatelliteProp {
    name: string;
    AP: number;
    RAAN: number;
    TA: number;
    altitude: number;
    eccentricity: number;
    inclination: number;
    startTime: number;
    currentTime?: number; // Optional as loop manages it usually
    endTime?: number;
}

export interface GroundStationProp {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    altitude?: number;
}

export interface OriginalSimulationProps {
    satellites?: SatelliteProp[];
    groundStations?: GroundStationProp[];
}

import { OriginalSimulation } from "@/modules/simulation/components/OriginalSimulation";
import { ManualGroundStation } from "@/modules/simulation/modules/types";

const DEMO_START_TIME = Date.now();
const SATELLITE_CATEGORIES = ['operational', 'communication', 'weather', 'gps'];

const MOCK_SATELLITES = Array.from({ length: 10 }).map((_, i) => {
    const planeIdx = Math.floor(i / 2);
    const satIdxInPlane = i % 2;
    const openEndedOrbit = i < 2;
    
    return {
        id: `SAT-${i + 1}`,
        name: `ANTARIS-S${i + 1}`,
        altitude: 400 + (planeIdx * 150), 
        inclination: 25 + (planeIdx * 18), 
        eccentricity: 0.001,
        RAAN: planeIdx * 48, 
        AP: 0,
        TA: satIdxInPlane * 180, 
        startTime: DEMO_START_TIME,
        category: SATELLITE_CATEGORIES[i % SATELLITE_CATEGORIES.length],
        ...(openEndedOrbit ? {} : { endTime: DEMO_START_TIME + 130 * 60 * 1000 })
    };
});

const MOCK_GROUND_STATIONS: ManualGroundStation[] = [
    { id: 'GS-M1', name: 'Mondal Base Alpha', latitude: 22.57, longitude: 88.36, country: 'India', countryCode: 'IND', agency: 'MONDAL-AERO', type: 'research', status: 'active' },
    { id: 'GS-M2', name: 'Antaris Polar', latitude: -77.85, longitude: 166.67, country: 'Antarctica', countryCode: 'ATA', agency: 'MONDAL-AERO', type: 'military', status: 'active' },
    { id: 'GS-M3', name: 'High Sky Base', latitude: 40.71, longitude: -74.01, country: 'USA', countryCode: 'US', agency: 'MONDAL-AERO', type: 'civilian', status: 'active' }
];

export default function Home() {
    return (
        <main className="w-screen h-screen">
            <OriginalSimulation
                satellites={MOCK_SATELLITES}
                groundStations={MOCK_GROUND_STATIONS}
                dashboardType='simulation'
            />
        </main>
    );
}

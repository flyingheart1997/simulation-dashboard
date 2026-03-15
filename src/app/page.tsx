import { OriginalSimulation } from "@/modules/simulation/components/OriginalSimulation";
import { ManualGroundStation } from "@/modules/simulation/modules/types";

const MOCK_SATELLITES = Array.from({ length: 10 }).map((_, i) => ({
    id: `SAT-${i + 1}`,
    name: `ANTARIS-S${i + 1}`,
    altitude: 550 + (i * 20),
    inclination: 53 + (i * 2),
    eccentricity: 0.001,
    RAAN: i * 36,
    AP: 0,
    TA: i * 36,
    startTime: Date.now(),
    endTime: Date.now() + 130 * 60 * 1000
}));

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

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { KeplerParams, ManualGroundStation, DashboardType } from '../modules/types';
import { simulationView } from './SimulationManager';
import { simulationStore } from '../stores/simulationStore';

interface OriginalSimulationProps {
    satellites?: KeplerParams[];
    groundStations?: ManualGroundStation[];
    dashboardType?: DashboardType;
    currentTime?: number;
}

export const OriginalSimulation: React.FC<OriginalSimulationProps> = ({
    satellites = [],
    groundStations = [],
    dashboardType = 'simulation',
    currentTime
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (containerRef.current && isMounted) {
            // Seed FIRST to prevent init() from fetching API data
            if (satellites.length > 0 || groundStations.length > 0) {
                console.log('[OriginalSimulation] Seeding data');
                simulationStore.seedManualData(satellites, groundStations);
            }
            simulationStore.setDashboardType(dashboardType);
            simulationView.show(containerRef.current);
        }

        return () => {
            simulationView.hide();
        };
    }, [isMounted, satellites, groundStations, dashboardType]);

    useEffect(() => {
        if (currentTime !== undefined) {
            simulationStore.setSimulationTime(currentTime);
        }
    }, [currentTime]);

    if (!isMounted) return null;

    return (
        <div
            ref={containerRef}
            className="w-full h-full overflow-hidden bg-black relative"
            style={{ isolation: 'isolate' }}
        />
    );
};

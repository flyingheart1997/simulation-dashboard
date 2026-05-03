'use client';

import React, { useEffect, useRef, useState } from 'react';
import { KeplerParams, ManualGroundStation, DashboardType } from '../types/types';
import { simulationView } from './SimulationManager';
import { simulationStore } from '../stores/simulationStore';

export type SimulationMapPreset = 'dark' | 'light';
export type SimulationViewPreset = '2D' | '3D';

interface OriginalSimulationProps {
    satellites?: KeplerParams[];
    groundStations?: ManualGroundStation[];
    dashboardType?: DashboardType;
    currentTime?: number;
    onlineMap?: boolean;
    editMode?: boolean;
    mapType?: SimulationMapPreset;
    viewType?: SimulationViewPreset;
}

export const OriginalSimulation: React.FC<OriginalSimulationProps> = ({
    satellites = [],
    groundStations = [],
    dashboardType = 'simulation',
    currentTime,
    onlineMap = false,
    editMode = false,
    mapType,
    viewType
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (containerRef.current && isMounted) {
            // Seed FIRST to prevent init() from fetching API data.
            // Edit workspaces may intentionally start without satellites/GS.
            if (editMode || satellites.length > 0 || groundStations.length > 0) {
                console.log('[OriginalSimulation] Seeding data');
                simulationStore.seedManualData(satellites, groundStations);
            }
            simulationStore.setDashboardType(dashboardType);
            simulationView.show(containerRef.current, undefined, {
                onlineMap,
                editMode,
                mapType: mapType === 'light' ? 'satellite' : mapType,
                viewMode: viewType === '2D' ? '2d' : viewType === '3D' ? '3d' : undefined
            });
        }

        return () => {
            simulationView.hide();
        };
    }, [isMounted, satellites, groundStations, dashboardType, onlineMap, editMode, mapType, viewType]);

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

'use client';

import React, { useEffect, useRef } from 'react';
import { simulationView } from './index';

export const OriginalSimulation = () => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            simulationView.show(containerRef.current);
        }

        return () => {
            simulationView.hide();
        };
    }, []);

    return (
        <div 
            ref={containerRef} 
            className="w-screen h-screen overflow-hidden bg-black"
            style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999 }}
        />
    );
};

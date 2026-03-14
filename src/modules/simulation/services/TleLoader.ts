import { TleData } from '../modules/types';

// In-memory cache: { countryCode -> { tles, timestamp } }
const tleCache = new Map<string, { tles: TleData[]; fetchedAt: number }>();
// Cache for pending promises to prevent concurrent duplicate fetches
const pendingRequests = new Map<string, Promise<TleData[]>>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — stale after 10 min

export class TleLoader {

    // Efficient country names for display
    static readonly COUNTRY_LABELS: Record<string, string> = {
        'GLOBAL': 'GLOBAL',
        'US': 'UNITED STATES',
        'PRC': 'CHINA',
        'CIS': 'RUSSIA',
        'IND': 'INDIA',
        'ESA': 'EUROPEAN UNION',
        'JPN': 'JAPAN',
        'UK': 'UNITED KINGDOM',
        'CAN': 'CANADA',
        'BRA': 'BRAZIL',
        'KOR': 'SOUTH KOREA',
        'FRA': 'FRANCE',
        'GER': 'GERMANY',
    };

    static async fetchAll(countryCode: string = 'GLOBAL'): Promise<TleData[]> {
        // 1. Check result cache
        const cached = tleCache.get(countryCode);
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
            console.log(`[TleLoader] Cache HIT for ${countryCode} (${cached.tles.length} sats)`);
            return cached.tles;
        }

        // 2. Check pending requests
        const pending = pendingRequests.get(countryCode);
        if (pending) {
            console.log(`[TleLoader] Joining pending request for ${countryCode}`);
            return pending;
        }

        console.log(`[TleLoader] Cache MISS for ${countryCode}, fetching...`);
        const fetchPromise = (async () => {
            try {
                const tles = countryCode === 'GLOBAL'
                    ? await this.fetchGlobal()
                    : await this.fetchByCountry(countryCode);

                // Store in result cache
                tleCache.set(countryCode, { tles, fetchedAt: Date.now() });
                return tles;
            } finally {
                // Clear pending request once done
                pendingRequests.delete(countryCode);
            }
        })();

        pendingRequests.set(countryCode, fetchPromise);
        return fetchPromise;
    }

    private static async fetchGlobal(): Promise<TleData[]> {
        // Fetch only "active" group which covers all active satellites in one request
        const tles = await this.fetchGroup('active');
        if (tles.length > 0) {
            // Shuffle and cap at 500 for performance
            return tles.sort(() => 0.5 - Math.random()).slice(0, 500);
        }
        return tles;
    }

    private static async fetchByCountry(country: string): Promise<TleData[]> {
        try {
            const start = Date.now();
            const response = await fetch(
                `https://celestrak.org/NORAD/elements/gp.php?COUNTRY=${country}&FORMAT=tle`,
                { signal: AbortSignal.timeout(30000) } 
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            console.log(`[TleLoader] Fetched ${country} TLEs in ${Date.now() - start}ms`);
            return this.parseTle(text, 'country-specific');
        } catch (error: any) {
            if (error.name === 'TimeoutError') {
                console.error(`[TleLoader] Timeout fetching satellites for country ${country} (30s)`);
            } else if (error.name === 'AbortError') {
                console.warn(`[TleLoader] Fetch aborted for country ${country}: ${error.message}`);
            } else {
                console.error(`[TleLoader] Error loading satellites for country ${country}:`, error);
            }
            return [];
        }
    }

    private static async fetchGroup(group: string): Promise<TleData[]> {
        try {
            const start = Date.now();
            const response = await fetch(
                `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
                { signal: AbortSignal.timeout(30000) }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            console.log(`[TleLoader] Fetched ${group} TLEs in ${Date.now() - start}ms`);
            return this.parseTle(text, group);
        } catch (error: any) {
            if (error.name === 'TimeoutError') {
                console.error(`[TleLoader] Timeout fetching ${group} group (30s)`);
            } else if (error.name === 'AbortError') {
                console.warn(`[TleLoader] Fetch aborted for group ${group}: ${error.message}`);
            } else {
                console.error(`[TleLoader] Error loading satellites for ${group}:`, error);
            }
            return [];
        }
    }

    private static parseTle(text: string, category: string): TleData[] {
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        const results: TleData[] = [];

        for (let i = 0; i < lines.length - 2; i += 3) {
            const name = lines[i]?.trim();
            const line1 = lines[i + 1]?.trim();
            const line2 = lines[i + 2]?.trim();

            if (name && line1 && line2 && line1.startsWith('1 ') && line2.startsWith('2 ')) {
                results.push({
                    name,
                    line1,
                    line2,
                    category: this.mapCategory(category)
                });
            }
        }

        return results;
    }

    private static mapCategory(group: string): string {
        if (group.includes('starlink')) return 'starlink';
        if (group.includes('gps')) return 'gps';
        if (group.includes('weather')) return 'weather';
        return 'communication';
    }
}

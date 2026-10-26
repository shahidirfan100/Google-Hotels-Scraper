import { Actor, log } from 'apify';

import {
    DEFAULT_MAX_PAGES,
    DEFAULT_RESULTS,
    DEFAULT_SEARCH_URL,
    GOOGLE_ORIGIN,
    MAX_PAGES,
    MAX_RESULTS,
} from './constants.js';
import { GoogleHotelsClient } from './google.js';
import { cleanString, hotelKey, mergeHotel, sanitizeRecord } from './parse.js';

const clampInteger = (value, fallback, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
};

const isGoogleHost = (hostname) => /(^|\.)google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2,3})$/i.test(hostname);

const normalizeSearchUrl = (rawValue) => {
    let value = rawValue.trim();
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

    const url = new URL(value);
    if (!isGoogleHost(url.hostname)) {
        throw new Error(
            'startUrl must point to a Google domain, for example https://www.google.com/travel/search?q=hotels+in+London',
        );
    }

    if (!url.searchParams.has('hl')) url.searchParams.set('hl', 'en');
    if (!url.searchParams.has('gl')) url.searchParams.set('gl', 'us');
    return url.toString();
};

const buildKeywordUrl = (keyword) => {
    const url = new URL(`${GOOGLE_ORIGIN}/travel/search`);
    url.searchParams.set('q', keyword);
    url.searchParams.set('hl', 'en');
    url.searchParams.set('gl', 'us');
    return url.toString();
};

const normalizeInput = (input) => {
    const keyword = cleanString(input.keyword);
    const startUrl = cleanString(input.startUrl);

    let mode = 'default';
    let searchUrl = normalizeSearchUrl(DEFAULT_SEARCH_URL);

    if (keyword) {
        mode = 'keyword';
        searchUrl = buildKeywordUrl(keyword);
    } else if (startUrl) {
        mode = 'url';
        searchUrl = normalizeSearchUrl(startUrl);
    }

    return {
        mode,
        keyword,
        searchUrl,
        resultsWanted: clampInteger(input.results_wanted, DEFAULT_RESULTS, 1, MAX_RESULTS),
        maxPages: clampInteger(input.max_pages, DEFAULT_MAX_PAGES, 1, MAX_PAGES),
    };
};

class HotelStore {
    constructor(limit) {
        this.limit = limit;
        this.hotels = new Map();
    }

    addMany(hotels) {
        const fresh = [];

        for (const hotel of hotels) {
            if (!hotel || this.hotels.size >= this.limit) break;

            const key = hotelKey(hotel);
            if (!key) continue;

            const existing = this.hotels.get(key);
            if (existing) {
                this.hotels.set(key, mergeHotel(existing, hotel));
                continue;
            }

            this.hotels.set(key, hotel);
            fresh.push(hotel);
        }

        return fresh;
    }

    get size() {
        return this.hotels.size;
    }
}

const run = async () => {
    const input = (await Actor.getInput()) || {};
    const settings = normalizeInput(input);

    log.info(`Start run | mode=${settings.mode} | results=${settings.resultsWanted} | maxPages=${settings.maxPages}`);

    const proxyInput = input.proxyConfiguration;
    const hasApifyProxy = Boolean(proxyInput?.useApifyProxy && Actor.isAtHome());
    const hasCustomProxy = Boolean(Array.isArray(proxyInput?.proxyUrls) && proxyInput.proxyUrls.length > 0);
    const proxyConfiguration =
        hasApifyProxy || hasCustomProxy ? await Actor.createProxyConfiguration(proxyInput) : undefined;
    const client = new GoogleHotelsClient({ proxyConfiguration });
    const page = await client.open(settings.searchUrl);
    const store = new HotelStore(settings.resultsWanted);

    let saved = 0;

    const emit = async (hotels, source) => {
        if (hotels.length === 0) return saved;

        const records = hotels.map(sanitizeRecord).filter(Boolean);
        if (records.length === 0) return saved;

        await Actor.pushData(records);
        saved += records.length;
        log.info(`Saved ${records.length} hotels from ${source}. Total: ${saved}/${settings.resultsWanted}`);
        return saved;
    };

    saved = await emit(store.addMany(page.hotels), 'search page');

    let pagination = { pages: 0, stopReason: 'not-needed' };
    if (saved < settings.resultsWanted && settings.maxPages > 1) {
        pagination = await client.paginate({
            maxPages: settings.maxPages,
            resultsWanted: settings.resultsWanted,
            totalSaved: saved,
            onBatch: async (hotels, pageNumber) => emit(store.addMany(hotels), `page ${pageNumber}`),
        });
        saved = pagination.totalSaved ?? saved;
    }

    if (saved === 0) {
        log.warning(
            'No hotels were found. Check the start URL or keyword. If the page loaded but the data was empty, read API_DISCOVERY.md and verify the current response shape.',
        );
    }

    log.info(
        `Done | saved=${saved} | pages=${pagination.pages} | stop_reason=${pagination.stopReason} | profile=${client.profile}`,
    );
};

await Actor.init();

let failed = false;
try {
    await run();
} catch (error) {
    failed = true;
    const reason = (error?.message || String(error)).split('\n')[0].slice(0, 300);
    log.error(`Run failed: ${reason}`);
    log.error(
        'Diagnose with API_DISCOVERY.md: confirm the search page, batchexecute request shape, and active impit profile.',
    );
}

await Actor.exit({ exitCode: failed ? 1 : 0 });

import { log } from 'apify';
import { Impit } from 'impit';

import {
    CONSENT_COOKIE,
    GOOGLE_ORIGIN,
    MAX_EMPTY_PAGES,
    PROFILE_ATTEMPTS,
    PROFILE_SEQUENCE,
    REQUEST_TIMEOUT_MS,
    RPC_ATTEMPTS,
} from './constants.js';
import { collectHotelNodes, parseHotelNode, parseRpcPayloads, parseSearchPage } from './parse.js';

const sleep = (milliseconds) =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });

const shortError = (error) => (error?.message || String(error)).split('\n')[0].slice(0, 200);

const backoffDelay = (attempt) => Math.min(700 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 400);

const isTemporaryStatus = (status) => [408, 425, 429, 500, 502, 503, 504].includes(status);

const retryAfterDelay = (response) => {
    const header = response.headers?.get?.('retry-after');
    if (!header) return null;

    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0), 30) * 1000;

    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp)) return Math.min(Math.max(timestamp - Date.now(), 0), 30000);
    return null;
};

const buildCookieHeader = (response) => {
    const cookieParts = [];
    const setCookies = typeof response.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

    for (const cookie of setCookies) {
        const pair = cookie.split(';')[0]?.trim();
        if (pair) cookieParts.push(pair);
    }

    if (!cookieParts.some((pair) => /^(CONSENT|SOCS)=/i.test(pair))) {
        cookieParts.push(...CONSENT_COOKIE.split('; '));
    }

    return cookieParts.join('; ');
};

const requestFailureHint =
    'Read API_DISCOVERY.md first, then compare the live search and batchexecute requests with the actor.';

const unexpectedPage = (page) => {
    if (page.hotels.length > 0) return false;
    if (page.rawHotels.length > 0) return false;
    return !/google hotel/i.test(page.title);
};

export class GoogleHotelsClient {
    constructor({ proxyConfiguration } = {}) {
        this.proxyConfiguration = proxyConfiguration;
        this.client = null;
        this.profile = null;
        this.page = null;
        this.searchUrl = null;
        this.cookieHeader = '';
        this.sessionCounter = 0;
    }

    async nextProxyUrl() {
        if (!this.proxyConfiguration) return undefined;
        this.sessionCounter += 1;
        const sessionId = `gh-${Date.now()}-${this.sessionCounter}`;
        try {
            return await this.proxyConfiguration.newUrl(sessionId);
        } catch {
            return this.proxyConfiguration.newUrl();
        }
    }

    async createClient(profile) {
        const proxyUrl = await this.nextProxyUrl();
        return new Impit({
            browser: profile,
            timeout: REQUEST_TIMEOUT_MS,
            ...(proxyUrl ? { proxyUrl } : {}),
        });
    }

    async open(searchUrl) {
        this.searchUrl = searchUrl;
        let lastReason = 'unknown';

        for (const profile of PROFILE_SEQUENCE) {
            for (let attempt = 1; attempt <= PROFILE_ATTEMPTS; attempt++) {
                const client = await this.createClient(profile);

                try {
                    const response = await client.fetch(searchUrl, {
                        headers: { cookie: CONSENT_COOKIE },
                    });
                    const html = await response.text();
                    const page = parseSearchPage(html, response.url);

                    if (isTemporaryStatus(response.status)) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    if (page.blocked) {
                        throw new Error(`blocked page: ${page.blocked}`);
                    }

                    if (unexpectedPage(page)) {
                        throw new Error(`unexpected page without hotel payload (HTTP ${response.status})`);
                    }

                    if (page.rawHotels.length > 0 && page.hotels.length === 0) {
                        log.warning(
                            'Hotel payload was present but no records parsed. Re-check the field paths in API_DISCOVERY.md.',
                        );
                    }

                    this.client = client;
                    this.profile = profile;
                    this.page = page;
                    this.cookieHeader = buildCookieHeader(response);

                    log.info(
                        `Search page loaded | profile=${profile} | hotels=${page.hotels.length} | title=${page.title}`,
                    );
                    return page;
                } catch (error) {
                    lastReason = shortError(error);
                    log.warning(
                        `Search attempt failed | profile=${profile} | attempt=${attempt}/${PROFILE_ATTEMPTS} | ${lastReason}`,
                    );

                    if (attempt < PROFILE_ATTEMPTS) {
                        await sleep(backoffDelay(attempt));
                    }
                }
            }
        }

        throw new Error(`Could not load Google Hotels (${lastReason}). ${requestFailureHint}`);
    }

    buildRpcUrl() {
        const { page } = this;
        const sourcePath = new URL(this.searchUrl).pathname;
        const params = new URLSearchParams({
            rpcids: page.rpcId,
            'source-path': sourcePath,
            hl: page.hl,
            gl: page.gl,
            'soc-app': '162',
            'soc-platform': '1',
            'soc-device': '1',
            _reqid: String(100000 + Math.floor(Math.random() * 900000)),
            rt: 'c',
        });

        if (page.fSid) params.set('f.sid', page.fSid);
        if (page.bl) params.set('bl', page.bl);

        return `${GOOGLE_ORIGIN}${page.servicePath}/data/batchexecute?${params.toString()}`;
    }

    async rpc(innerRequest) {
        if (!this.client || !this.page) {
            throw new Error(`RPC called before a search page was loaded. ${requestFailureHint}`);
        }

        const buildBody = () =>
            `f.req=${encodeURIComponent(JSON.stringify([[[this.page.rpcId, JSON.stringify(innerRequest), null, '1']]]))}&`;
        let url = this.buildRpcUrl();
        let body = buildBody();
        let lastReason = 'unknown';
        let refreshed = false;
        let attempt = 0;

        while (attempt < RPC_ATTEMPTS) {
            attempt += 1;

            try {
                const response = await this.client.fetch(url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'x-same-domain': '1',
                        origin: GOOGLE_ORIGIN,
                        referer: this.searchUrl,
                        ...(this.cookieHeader ? { cookie: this.cookieHeader } : {}),
                    },
                    body,
                });

                if (isTemporaryStatus(response.status)) {
                    const wait = retryAfterDelay(response) ?? backoffDelay(attempt);
                    log.warning(`Pagination request retry | HTTP ${response.status} | in ${Math.round(wait)}ms`);
                    await sleep(wait);
                    continue;
                }

                if (!response.ok && response.status >= 400 && response.status < 500) {
                    log.warning(`Pagination request stopped | HTTP ${response.status}`);
                    return [];
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const text = await response.text();
                const payloads = parseRpcPayloads(text);
                if (payloads.length === 0) {
                    log.warning(`Pagination response had no usable payload | bytes=${text.length}`);
                }
                return payloads;
            } catch (error) {
                lastReason = shortError(error);

                if (attempt < RPC_ATTEMPTS) {
                    log.warning(`Pagination request retry | attempt=${attempt}/${RPC_ATTEMPTS} | ${lastReason}`);
                    await sleep(backoffDelay(attempt));
                    continue;
                }

                if (refreshed) break;

                refreshed = true;
                attempt = 0;
                log.warning('Refreshing the search session before retrying pagination.');

                try {
                    await this.open(this.searchUrl);
                    url = this.buildRpcUrl();
                    body = buildBody();
                } catch (refreshError) {
                    lastReason = shortError(refreshError);
                    break;
                }
            }
        }

        throw new Error(`Pagination failed (${lastReason}). ${requestFailureHint}`);
    }

    async paginate({ maxPages, resultsWanted, totalSaved = 0, onBatch }) {
        if (!this.page?.options || !this.page.query) {
            log.warning('Pagination context is incomplete. Continuing with the initial result page.');
            return { pages: 0, stopReason: 'missing-context', totalSaved };
        }

        const defaultToken = this.page.nextPageToken || 'CBI=';
        let lastEntityId = null;
        let emptyStreak = 0;
        let pagesProcessed = 0;
        let stopReason = 'page-limit';
        let savedTotal = totalSaved;

        for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
            const activePage = this.page;
            const token = activePage.nextPageToken || defaultToken;
            const innerRequest =
                pageNumber === 2
                    ? [activePage.query, activePage.options, [null, token, null, null, null, null, 13, null, 0]]
                    : [
                          activePage.query,
                          activePage.options,
                          [null, token, null, null, null, lastEntityId, 13, null, 0],
                          null,
                          1,
                      ];

            let payloads;
            try {
                payloads = await this.rpc(innerRequest);
            } catch (error) {
                log.warning(`Pagination stopped | page=${pageNumber} | ${shortError(error)}`);
                stopReason = 'request-failed';
                break;
            }

            const hotels = payloads
                .flatMap((payload) => collectHotelNodes(payload))
                .map((hotel) => parseHotelNode(hotel, { currency: activePage.currency }))
                .filter(Boolean);

            if (hotels.length === 0) {
                stopReason = 'no-results';
                break;
            }

            lastEntityId = hotels.at(-1)?.entityId || lastEntityId;
            const previousTotal = savedTotal;
            savedTotal = await onBatch(hotels, pageNumber);
            const added = savedTotal - previousTotal;
            pagesProcessed += 1;

            if (added === 0) emptyStreak += 1;
            else emptyStreak = 0;

            if (emptyStreak >= MAX_EMPTY_PAGES) {
                stopReason = 'no-new-results';
                break;
            }

            if (savedTotal >= resultsWanted) {
                stopReason = 'results-reached';
                break;
            }

            await sleep(250 + Math.floor(Math.random() * 350));
        }

        return { pages: pagesProcessed, stopReason, totalSaved: savedTotal };
    }
}

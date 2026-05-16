import { Actor, log } from 'apify';
import { Dataset, PlaywrightCrawler } from 'crawlee';
import { firefox } from 'playwright';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    startUrl,
    results_wanted = 20,
    max_pages = 1,
    proxyConfiguration: proxyConfig,
} = input;

if (!startUrl) {
    throw new Error('Missing required input: startUrl. Please provide a Google Hotels search URL.');
}

const proxyConfiguration = proxyConfig ? await Actor.createProxyConfiguration(proxyConfig) : undefined;
const maxPages = Number.isInteger(max_pages) && max_pages > 0 ? max_pages : 1;
const maxIdlePaginationSteps = 4;
const hotelStore = new Map();

/**
 * @param {*} value
 * @returns {boolean}
 */
const isPresent = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
};

/**
 * Remove null/undefined/empty fields recursively.
 * @param {*} value
 * @returns {*}
 */
const sanitizeValue = (value) => {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    if (Array.isArray(value)) {
        const cleaned = value.map((item) => sanitizeValue(item)).filter((item) => item !== undefined);
        return cleaned.length > 0 ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const cleanedEntries = Object.entries(value)
            .map(([key, val]) => [key, sanitizeValue(val)])
            .filter(([, val]) => val !== undefined);
        return cleanedEntries.length > 0 ? Object.fromEntries(cleanedEntries) : undefined;
    }

    return value;
};

/**
 * Prefer non-empty values and richer strings/arrays/objects.
 * @param {*} currentValue
 * @param {*} incomingValue
 * @returns {*}
 */
const chooseBetterValue = (currentValue, incomingValue) => {
    if (!isPresent(incomingValue)) return currentValue;
    if (!isPresent(currentValue)) return incomingValue;

    if (typeof currentValue === 'string' && typeof incomingValue === 'string') {
        return incomingValue.length > currentValue.length ? incomingValue : currentValue;
    }

    if (Array.isArray(currentValue) && Array.isArray(incomingValue)) {
        return incomingValue.length > currentValue.length ? incomingValue : currentValue;
    }

    if (
        typeof currentValue === 'object'
        && !Array.isArray(currentValue)
        && typeof incomingValue === 'object'
        && !Array.isArray(incomingValue)
    ) {
        const merged = { ...currentValue };
        for (const [key, incomingNestedValue] of Object.entries(incomingValue)) {
            merged[key] = chooseBetterValue(merged[key], incomingNestedValue);
        }
        return merged;
    }

    return currentValue;
};

/**
 * @param {Object} hotel
 * @returns {string|null}
 */
const getHotelKey = (hotel) => {
    if (hotel.name) return `name:${hotel.name}`;
    if (hotel.hotelId) return `hotelId:${hotel.hotelId}`;
    if (hotel.entityId) return `entityId:${hotel.entityId}`;
    if (hotel.url && hotel.url.includes('/travel/hotels/entity/')) return `entityUrl:${hotel.url}`;
    if (hotel.listingToken) return `listingToken:${hotel.listingToken}`;
    return null;
};

/**
 * @param {Object} hotel
 * @returns {number}
 */
const getRichFieldScore = (hotel) => {
    let score = 0;
    if (hotel.hotelId || hotel.entityId) score++;
    if (hotel.imageUrl) score++;
    if (hotel.hotelDescription) score++;
    if (hotel.category) score++;
    if (hotel.location?.lat !== undefined && hotel.location?.lng !== undefined) score++;
    if (hotel.address) score++;
    return score;
};

/**
 * Insert or enrich hotel records without creating duplicate rows.
 * @param {Array<Object>} hotels
 * @param {string} source
 * @param {import('apify').Log} logger
 */
const upsertHotels = (hotels, source, logger) => {
    let inserted = 0;
    let enriched = 0;
    let skipped = 0;

    for (const rawHotel of hotels) {
        const cleaned = sanitizeValue(rawHotel);
        if (!cleaned || typeof cleaned !== 'object') {
            skipped++;
            continue;
        }

        const key = getHotelKey(cleaned);
        if (!key) {
            skipped++;
            continue;
        }

        const existing = hotelStore.get(key);
        if (!existing) {
            hotelStore.set(key, cleaned);
            inserted++;
            continue;
        }

        const merged = { ...existing };
        let changed = false;

        for (const [field, value] of Object.entries(cleaned)) {
            const betterValue = chooseBetterValue(merged[field], value);
            if (betterValue !== merged[field]) {
                merged[field] = betterValue;
                changed = true;
            }
        }

        if (changed) {
            hotelStore.set(key, merged);
            enriched++;
        }
    }

    if (inserted > 0 || enriched > 0 || skipped > 0) {
        logger.info(
            `[${source}] New: ${inserted}, enriched: ${enriched}, skipped: ${skipped}. Unique total: ${hotelStore.size}/${results_wanted}`,
        );
    }
};

/**
 * Parse a hotel object from Google nested array shape.
 * @param {Array} h
 * @returns {Object|null}
 */
const parseHotel = (h) => {
    if (!Array.isArray(h) || h.length < 10 || !h[1]) return null;

    try {
        const name = String(h[1]).trim();
        if (!name || name.startsWith('/aclk?') || /^https?:\/\//i.test(name)) return null;

        let rating = h[7]?.[0];
        let reviewsCount = h[7]?.[1];
        if (Array.isArray(rating)) {
            reviewsCount = rating[1];
            rating = rating[0];
        }

        let address = typeof h[18] === 'string' ? h[18] : null;
        if (!address && Array.isArray(h[18])) {
            address = h[18].find((x) => typeof x === 'string' && x.length > 5);
        }
        if (!address && typeof h[10] === 'string') address = h[10];

        return {
            name,
            hotelId: h[9] || h[25] || null,
            hotelDescription: h[11]?.[0] || null,
            rating: typeof rating === 'number' ? rating : null,
            reviewsCount: typeof reviewsCount === 'number' ? reviewsCount : null,
            category: h[3]?.[0] || null,
            imageUrl: h[5]?.[1]?.[0]?.[1]?.[0] || null,
            address,
            entityId: h[20] || null,
            url: h[20] ? `https://www.google.com/travel/hotels/entity/${h[20]}` : null,
            location: h[2]?.[0] ? { lat: h[2][0][0], lng: h[2][0][1] } : null,
            price: h[6]?.[31]?.[0] || h[6]?.[1]?.[0]?.[0] || null,
            currency: h[6]?.[1]?.[3] || null,
        };
    } catch (err) {
        log.debug(`Failed to parse hotel array: ${err.message}`);
        return null;
    }
};

/**
 * Recursively find hotel arrays in any object/array tree.
 * @param {*} obj
 * @returns {Array<Object>}
 */
const extractHotelsFromAny = (obj) => {
    const found = [];

    if (Array.isArray(obj)) {
        const looksLikeHotelArray = (
            obj.length > 20
            && typeof obj[1] === 'string'
            && (
                (Array.isArray(obj[2]) && obj[2].length > 0)
                || typeof obj[9] === 'string'
                || typeof obj[20] === 'string'
            )
        );

        if (looksLikeHotelArray) {
            const hotel = parseHotel(obj);
            if (hotel) found.push(hotel);
        }

        for (const item of obj) {
            if (item && typeof item === 'object') {
                found.push(...extractHotelsFromAny(item));
            }
        }
    } else if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            if (obj[key] && typeof obj[key] === 'object') {
                found.push(...extractHotelsFromAny(obj[key]));
            }
        }
    }

    return found;
};

/**
 * Parse AF_initDataCallback payloads from current page HTML.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<Object>>}
 */
const extractFromCurrentHtml = async (page) => {
    const scriptData = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script'))
            .filter((script) => script.textContent.includes('AF_initDataCallback'))
            .map((script) => {
                const match = script.textContent.match(/data:\s*(\[.*\])\s*,/s);
                if (!match) return null;

                try {
                    // eslint-disable-next-line no-eval
                    return eval(`(${match[1]})`);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    });

    const extracted = [];
    for (const data of scriptData) {
        extracted.push(...extractHotelsFromAny(data));
    }

    return extracted;
};

/**
 * Extract hotels from visible result cards as a pagination-safe fallback.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<Object>>}
 */
const extractFromResultCards = async (page) => {
    return page.evaluate(() => {
        const parseCompactNumber = (value) => {
            if (!value) return null;
            const normalized = value.replace(/,/g, '').trim().toUpperCase();
            let multiplier = 1;
            if (normalized.endsWith('K')) multiplier = 1000;
            else if (normalized.endsWith('M')) multiplier = 1000000;
            const base = normalized.replace(/[KM]$/, '');
            const num = Number(base);
            if (Number.isNaN(num)) return null;
            return Math.round(num * multiplier);
        };

        const cards = Array.from(document.querySelectorAll('a.PVOOXe[aria-label]'));
        return cards.map((card) => {
            const name = (card.getAttribute('aria-label') || '').trim();
            if (!name) return null;

            const href = card.getAttribute('href') || '';
            const absoluteUrl = new URL(href, location.origin).toString();
            const listingToken = new URL(absoluteUrl).searchParams.get('qs');

            const container = card.closest('div[jscontroller]') || card.parentElement;
            const text = (container?.textContent || '').replace(/\s+/g, ' ').trim();

            const ratingMatch = text.match(/([0-5](?:\.\d)?)\s*\(([\d.,]+[kKmM]?)\)/);
            const rating = ratingMatch ? Number(ratingMatch[1]) : null;
            const reviewsCount = ratingMatch ? parseCompactNumber(ratingMatch[2]) : null;

            const priceMatch = text.match(/(PKR|Rs|USD|EUR|GBP|\$|€|£)\s*([\d,]+)/i);
            const currency = priceMatch ? priceMatch[1] : null;
            const price = priceMatch ? Number(priceMatch[2].replace(/,/g, '')) : null;

            return {
                name,
                listingToken,
                url: absoluteUrl,
                rating: Number.isNaN(rating) ? null : rating,
                reviewsCount: Number.isNaN(reviewsCount) ? null : reviewsCount,
                price: Number.isNaN(price) ? null : price,
                currency,
                source: 'result-card',
            };
        }).filter(Boolean);
    });
};

/**
 * Parse batchexecute response body and extract hotel objects.
 * @param {string} text
 * @returns {Array<{ rpc: string, hotels: Array<Object> }>} 
 */
const parseBatchExecuteText = (text) => {
    const chunks = [];
    const cleanText = text.replace(/^\)\]\}'/, '');
    if (!cleanText.startsWith('[')) return chunks;

    let outerArray;
    try {
        outerArray = JSON.parse(cleanText);
    } catch {
        return chunks;
    }

    for (const item of outerArray) {
        if (!Array.isArray(item) || item[0] !== 'wrb.fr' || !item[2] || typeof item[2] !== 'string') continue;

        try {
            const payload = JSON.parse(item[2]);
            const hotels = extractHotelsFromAny(payload);
            chunks.push({ rpc: item[1] || 'unknown', hotels });
        } catch {
            // Ignore non-JSON payload segments.
        }
    }

    return chunks;
};

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    launchContext: {
        launcher: firefox,
        launchOptions: {
            headless: true,
        },
    },
    maxConcurrency: 1,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 300,

    requestHandler: async ({ page, request, log: handlerLog }) => {
        handlerLog.info(`Processing ${request.url}`);

        // Block heavy resources; hotel data is captured from internal payloads.
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });

        // Capture Google internal API responses while navigating and paginating.
        page.on('response', async (response) => {
            if (response.status() !== 200 || !response.url().includes('batchexecute')) return;

            try {
                const text = await response.text();
                const chunks = parseBatchExecuteText(text);
                for (const chunk of chunks) {
                    if (chunk.hotels.length > 0) {
                        upsertHotels(chunk.hotels, `batchexecute:${chunk.rpc}`, handlerLog);
                    }
                }
            } catch (err) {
                handlerLog.debug(`batchexecute parse failed: ${err.message}`);
            }
        });

        await page.goto(request.url, { waitUntil: 'networkidle' });
        upsertHotels(await extractFromCurrentHtml(page), 'initial-html', handlerLog);
        upsertHotels(await extractFromResultCards(page), 'initial-cards', handlerLog);

        let currentPage = 1;
        let idlePaginationSteps = 0;

        while (hotelStore.size < results_wanted && currentPage < maxPages) {
            handlerLog.info(`Navigating to more results (Page ${currentPage + 1})...`);
            const beforeCount = hotelStore.size;

            // Move to the bottom so the hotel list pagination controls are reachable.
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            await page.waitForTimeout(2000);
            upsertHotels(await extractFromCurrentHtml(page), 'post-scroll-html', handlerLog);
            upsertHotels(await extractFromResultCards(page), 'post-scroll-cards', handlerLog);

            if (hotelStore.size === beforeCount) {
                // Click the bottom-most visible "Next" button to avoid card carousel arrows.
                const clickedNext = await page.evaluate(() => {
                    const candidates = Array.from(document.querySelectorAll('button,[role="button"]'))
                        .filter((button) => {
                            const label = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`.trim();
                            if (!/next/i.test(label)) return false;
                            if (/weekend|work week/i.test(label)) return false;
                            const rect = button.getBoundingClientRect();
                            const visible = rect.width > 0 && rect.height > 0 && button.getClientRects().length > 0;
                            if (!visible) return false;
                            if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
                            return true;
                        })
                        .map((button) => {
                            const rect = button.getBoundingClientRect();
                            return { button, y: rect.top + window.scrollY };
                        })
                        .sort((a, b) => b.y - a.y);

                    if (candidates.length === 0) return false;
                    const target = candidates[0].button;
                    target.scrollIntoView({ block: 'center' });
                    target.click();
                    return true;
                });

                if (clickedNext) {
                    handlerLog.info('Clicking hotel pagination "Next" button...');
                    await page.waitForTimeout(3500);
                    upsertHotels(await extractFromCurrentHtml(page), 'post-next-html', handlerLog);
                    upsertHotels(await extractFromResultCards(page), 'post-next-cards', handlerLog);
                }
            }

            if (hotelStore.size === beforeCount) {
                idlePaginationSteps++;
                handlerLog.warning(`No new hotels found in this step (${idlePaginationSteps}/${maxIdlePaginationSteps}).`);
            } else {
                idlePaginationSteps = 0;
            }

            if (idlePaginationSteps >= maxIdlePaginationSteps) {
                handlerLog.warning('Stopping pagination after repeated no-growth steps.');
                break;
            }

            currentPage++;
        }

        // Enrich post-pagination records with detail URLs that carry richer hotel payloads.
        const visitedDetailUrls = new Set();
        const maxDetailVisits = Math.min(12, Math.max(4, Math.ceil(results_wanted / 10)));
        let detailVisits = 0;

        while (detailVisits < maxDetailVisits) {
            const pending = Array.from(hotelStore.values())
                .filter((hotel) => hotel.listingToken && hotel.url && getRichFieldScore(hotel) < 4)
                .filter((hotel) => !visitedDetailUrls.has(hotel.url));

            if (pending.length === 0) break;

            const target = pending[0];
            visitedDetailUrls.add(target.url);
            detailVisits++;

            handlerLog.info(`Enriching detail ${detailVisits}/${maxDetailVisits}: ${target.name}`);
            await page.goto(target.url, { waitUntil: 'networkidle' });
            await page.waitForTimeout(1500);
            upsertHotels(await extractFromCurrentHtml(page), 'detail-html', handlerLog);
            upsertHotels(await extractFromResultCards(page), 'detail-cards', handlerLog);
        }
    },
});

await crawler.run([{ url: startUrl }]);

const finalHotels = Array.from(hotelStore.values())
    .sort((a, b) => {
        const scoreDiff = getRichFieldScore(b) - getRichFieldScore(a);
        if (scoreDiff !== 0) return scoreDiff;

        const ratingDiff = (b.rating ?? -1) - (a.rating ?? -1);
        if (ratingDiff !== 0) return ratingDiff;

        return (b.reviewsCount ?? 0) - (a.reviewsCount ?? 0);
    })
    .slice(0, results_wanted);
if (finalHotels.length > 0) {
    await Dataset.pushData(finalHotels);
}

log.info(`Extraction complete. Total saved: ${finalHotels.length}`);
await Actor.exit();

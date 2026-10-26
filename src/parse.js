import {
    DEFAULT_COUNTRY,
    DEFAULT_CURRENCY,
    DEFAULT_LOCALE,
    DEFAULT_RPC_ID,
    DEFAULT_SERVICE_PATH,
    GOOGLE_ORIGIN,
} from './constants.js';

const HOTEL_NAME_MAX_LENGTH = 200;

export const cleanString = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const toNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/[^\d.-]/g, '');
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

export const decodeHtmlEntities = (value) => {
    if (typeof value !== 'string') return value;
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
};

export const sanitizeRecord = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return cleanString(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        const cleaned = value.map(sanitizeRecord).filter((item) => item !== null);
        return cleaned.length > 0 ? cleaned : null;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, item]) => [key, sanitizeRecord(item)])
            .filter(([, item]) => item !== null);
        return entries.length > 0 ? Object.fromEntries(entries) : null;
    }
    return null;
};

export const findBalanced = (text, start, open = '[', close = ']') => {
    if (start < 0) return null;
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let index = start; index < text.length; index++) {
        const char = text[index];

        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === open) depth += 1;
        else if (char === close) {
            depth -= 1;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }

    return null;
};

const parseDataLiteral = (raw) => {
    try {
        return JSON.parse(raw);
    } catch {
        const normalized = raw.replace(/\bundefined\b/g, 'null').replace(/,\s*([\]}])/g, '$1');
        try {
            return JSON.parse(normalized);
        } catch {
            return null;
        }
    }
};

export const extractInitDataBlocks = (html) => {
    const blocks = [];
    let cursor = 0;

    while (true) {
        const markerIndex = html.indexOf('AF_initDataCallback(', cursor);
        if (markerIndex === -1) break;

        const argument = findBalanced(html, html.indexOf('{', markerIndex), '{', '}');
        if (!argument) break;
        cursor = markerIndex + argument.length;

        const key = argument.match(/key:\s*'([^']+)'/)?.[1] || null;
        const dataIndex = argument.indexOf('data:');
        if (dataIndex === -1) continue;

        const rawData = findBalanced(argument, argument.indexOf('[', dataIndex));
        if (!rawData) continue;

        const data = parseDataLiteral(rawData);
        if (data !== null) blocks.push({ key, data });
    }

    return blocks;
};

export const isHotelNode = (node) => {
    if (!Array.isArray(node) || node.length < 10) return false;
    const name = node[1];
    if (typeof name !== 'string' || name.length === 0 || name.length > HOTEL_NAME_MAX_LENGTH) return false;
    if (/^(https?:\/\/|\/aclk\?)/i.test(name)) return false;
    return Boolean(node[6] && typeof node[6] === 'object');
};

export const collectHotelNodes = (data) => {
    const hotels = [];

    const walk = (node) => {
        if (Array.isArray(node)) {
            if (isHotelNode(node)) hotels.push(node);
            for (const child of node) {
                if (child && typeof child === 'object') walk(child);
            }
            return;
        }

        if (node && typeof node === 'object') {
            for (const child of Object.values(node)) {
                if (child && typeof child === 'object') walk(child);
            }
        }
    };

    walk(data);
    return hotels;
};

const firstImageUrl = (value) => {
    if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = firstImageUrl(item);
            if (found) return found;
        }
    }
    return null;
};

const collectImageUrls = (value) => {
    const urls = new Set();

    const walk = (node) => {
        if (typeof node === 'string') {
            if (/^https?:\/\//i.test(node) && /(googleusercontent|gstatic)\.com/i.test(node)) {
                urls.add(node);
            }
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
        } else if (node && typeof node === 'object') {
            for (const item of Object.values(node)) walk(item);
        }
    };

    walk(value);
    return [...urls].slice(0, 8);
};

const parsePropertyType = (value) => {
    if (!Array.isArray(value)) return null;

    for (const group of value) {
        if (!Array.isArray(group)) continue;
        const active = group.find((item) => Array.isArray(item) && item[1] && typeof item[0] === 'string');
        const chosen = active || group.find((item) => Array.isArray(item) && typeof item[0] === 'string');
        if (chosen) return chosen[0].replace(/^gcid:/, '').replace(/_/g, ' ');
    }

    return null;
};

const parseRatingBreakdown = (value) => {
    if (!Array.isArray(value)) return null;
    const breakdown = {};

    for (const item of value) {
        if (!Array.isArray(item)) continue;
        const star = toNumber(item[0]);
        const count = toNumber(item[1]);
        if (star && count !== null) breakdown[String(star)] = count;
    }

    return Object.keys(breakdown).length > 0 ? breakdown : null;
};

const parseReviewScores = (value) => {
    if (!Array.isArray(value)) return null;
    const scores = [];

    for (const item of value) {
        if (!Array.isArray(item)) continue;
        const category = cleanString(item[4]);
        const score = toNumber(item[1]);
        const mentions = toNumber(item[2]);
        if (!category || score === null) continue;
        scores.push({ category, score: Math.round(score * 1000) / 1000, mentions });
        if (scores.length >= 8) break;
    }

    return scores.length > 0 ? scores : null;
};

const parseDealText = (value) => {
    let found = null;

    const walk = (node) => {
        if (found) return;
        if (typeof node === 'string') {
            if (/(% less than usual|great price|good price|% off|save \d)/i.test(node)) {
                found = node.trim();
            }
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
        } else if (node && typeof node === 'object') {
            for (const item of Object.values(node)) walk(item);
        }
    };

    walk(value);
    return found;
};

const parseAmenities = (value) => {
    if (!Array.isArray(value)) return null;
    let amenityList = null;

    const walk = (node) => {
        if (amenityList) return;
        if (Array.isArray(node)) {
            if (node[0] === 'Amenities' && Array.isArray(node[1])) {
                amenityList = node[1];
                return;
            }
            for (const item of node) walk(item);
        }
    };

    walk(value);
    if (!amenityList) return null;

    const available = [];
    for (const item of amenityList) {
        if (!Array.isArray(item)) continue;
        const name = cleanString(item[0]);
        const isAvailable = item[1] === 1 || item[1] === true;
        if (name && isAvailable) available.push(name);
    }

    return available.length > 0 ? [...new Set(available)] : null;
};

const parseBookingProviders = (value) => {
    if (!Array.isArray(value)) return null;
    const providerList = value[8];
    if (!Array.isArray(providerList)) return null;

    const providers = [];
    for (const item of providerList) {
        if (!Array.isArray(item)) continue;
        const name = cleanString(item[0]);
        const url = item.find(
            (entry) => typeof entry === 'string' && /^https?:\/\//i.test(entry) && !/gstatic\.com/i.test(entry),
        );
        if (name && url) providers.push({ name, url });
        if (providers.length >= 10) break;
    }

    return providers.length > 0 ? providers : null;
};

const formatCompactTime = (value) => {
    if (typeof value !== 'string' || !/^\d{3,4}$/.test(value)) return null;
    const digits = value.padStart(4, '0');
    const hours = Number(digits.slice(0, 2));
    const minutes = digits.slice(2);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${minutes} ${suffix}`;
};

const parseProviderCheckTimes = (value) => {
    if (!Array.isArray(value)) return {};
    const lines = value[3]?.[0];
    if (!Array.isArray(lines)) return {};

    const text = lines.filter((line) => typeof line === 'string').join(' ');
    const checkIn = text.match(/Check-in time:\s*(\d{3,4})/i)?.[1];
    const checkOut = text.match(/Check-out time:\s*(\d{3,4})/i)?.[1];

    return {
        checkInTime: formatCompactTime(checkIn),
        checkOutTime: formatCompactTime(checkOut),
    };
};

const currencySymbols = {
    $: 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
    '₨': 'PKR',
    '₩': 'KRW',
    '₽': 'RUB',
};

const inferCurrency = (priceText) => {
    if (typeof priceText !== 'string') return null;
    const code = priceText.match(/\b([A-Z]{3})\b/)?.[1];
    if (code) return code;
    return currencySymbols[priceText.trim()[0]] || null;
};

const parseRating = (node) => {
    const block = node[7];
    if (Array.isArray(block?.[0])) {
        return { rating: toNumber(block[0][0]), reviewsCount: toNumber(block[0][1]) };
    }
    return { rating: toNumber(block?.[0]), reviewsCount: toNumber(block?.[1]) };
};

const parsePrice = (node, context = {}) => {
    const priceBlock = node[6]?.[2]?.[1];
    const priceText = cleanString(priceBlock?.[0]);
    const price = toNumber(priceBlock?.[4]) ?? toNumber(priceBlock?.[2]) ?? toNumber(priceText);
    const currency =
        cleanString(node[6]?.[2]?.[15]) ||
        cleanString(node[6]?.[1]?.[3]) ||
        inferCurrency(priceText) ||
        context.currency ||
        null;
    return { price, priceText, currency };
};

const hasEssentialInfo = (value) => {
    if (!Array.isArray(value)) return false;
    let found = false;
    const walk = (node) => {
        if (found) return;
        if (Array.isArray(node)) {
            if (node[0] === 'Essential info') {
                found = true;
                return;
            }
            for (const item of node) walk(item);
        }
    };
    walk(value);
    return found;
};

const parseEssentials = (node) => {
    const providerData = node[19]?.[1];
    let sleeps = toNumber(providerData?.[1]);
    let bedrooms = toNumber(providerData?.[2]);
    let bathrooms = toNumber(providerData?.[3]);

    if (sleeps === null || bedrooms === null || bathrooms === null) {
        const walk = (value) => {
            if (!Array.isArray(value)) return;
            if (value[0] === 'Essential info' && Array.isArray(value[1])) {
                for (const item of value[1]) {
                    if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
                    const label = item[0];
                    sleeps = sleeps ?? toNumber(label.match(/Sleeps\s+(\d+)/i)?.[1]);
                    bedrooms = bedrooms ?? toNumber(label.match(/(\d+)\s+bedroom/i)?.[1]);
                    bathrooms = bathrooms ?? toNumber(label.match(/(\d+)\s+bathroom/i)?.[1]);
                }
                return;
            }
            for (const item of value) walk(item);
        };
        walk(node[10]);
    }

    return { sleeps, bedrooms, bathrooms };
};

export const parseHotelNode = (node, context = {}) => {
    try {
        const name = cleanString(node[1]);
        if (!name) return null;

        const { rating, reviewsCount } = parseRating(node);
        const { price, priceText, currency } = parsePrice(node, context);
        const essentials = parseEssentials(node);
        const propertyType =
            parsePropertyType(node[2]?.[31]) || (hasEssentialInfo(node[10]) ? 'vacation rental' : null);
        const coordinates = Array.isArray(node[2]?.[0]) ? node[2][0] : null;
        const entityId = cleanString(node[20]);
        const hotelId = cleanString(node[9]);
        const website = /^https?:\/\//i.test(node[2]?.[29]?.[2] || '') ? node[2][29][2] : null;
        const checkTimes = Array.isArray(node[2]?.[17]) ? node[2][17] : [];
        const imageUrl = firstImageUrl(node[5]) || firstImageUrl(node[12]);
        const images = collectImageUrls(node[5]);
        const bookingPath = node[6]?.[2]?.[4]?.[0];
        const bookingUrl =
            typeof bookingPath === 'string' && bookingPath.startsWith('/travel/')
                ? `${GOOGLE_ORIGIN}${bookingPath}`
                : null;
        const providerTimes = parseProviderCheckTimes(node[19]);
        let imageList = images;
        if (imageList.length === 0 && imageUrl) imageList = [imageUrl];

        return sanitizeRecord({
            name,
            hotelId,
            entityId,
            url: entityId ? `${GOOGLE_ORIGIN}/travel/hotels/entity/${encodeURIComponent(entityId)}?hl=en&gl=us` : null,
            rating,
            reviewsCount,
            ratingBreakdown: parseRatingBreakdown(node[7]?.[1]?.[0]),
            reviewScores: parseReviewScores(node[7]?.[9]),
            stars: toNumber(node[3]?.[1]),
            category: cleanString(node[3]?.[0]),
            propertyType,
            sleeps: essentials.sleeps,
            bedrooms: essentials.bedrooms,
            bathrooms: essentials.bathrooms,
            price,
            priceText,
            currency,
            dealText: parseDealText(node[6]?.[2]?.[7]),
            bookingUrl,
            bookingProviders: parseBookingProviders(node[19]),
            amenities: parseAmenities(node[10]),
            location: coordinates ? { lat: toNumber(coordinates[0]), lng: toNumber(coordinates[1]) } : null,
            imageUrl,
            images: imageList.length > 0 ? imageList : null,
            website,
            countryCode: cleanString(node[2]?.[36]),
            checkInTime: cleanString(checkTimes[0]) || providerTimes.checkInTime,
            checkOutTime: cleanString(checkTimes[1]) || providerTimes.checkOutTime,
        });
    } catch {
        return null;
    }
};

export const extractTitle = (html) => {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    return decodeHtmlEntities(title.replace(/\s+/g, ' ').trim());
};

export const detectBlock = ({ html, finalUrl, title }) => {
    const lowerHtml = html.toLowerCase();
    const lowerUrl = finalUrl.toLowerCase();

    if (lowerUrl.includes('/sorry/') || lowerHtml.includes('our systems have detected unusual traffic')) {
        return 'sorry';
    }
    if (lowerUrl.includes('consent.google.com') || /before you continue/i.test(title)) {
        return 'consent';
    }
    if (/g-recaptcha|recaptcha\/api|automated queries/i.test(lowerHtml)) {
        return 'captcha';
    }
    return null;
};

const extractDataServiceRequests = (html) => {
    const requests = {};
    const marker = html.indexOf('AF_dataServiceRequests');
    if (marker === -1) return requests;

    const listStart = html.indexOf('{', marker);
    const listRaw = findBalanced(html, listStart, '{', '}');
    if (!listRaw) return requests;

    const idPattern = /'([^']+)'\s*:\s*\{\s*id\s*:\s*'([^']+)'/g;
    let match;
    while ((match = idPattern.exec(listRaw)) !== null) {
        const requestLabel = match[1];
        const id = match[2];
        const requestIndex = listRaw.indexOf('request:', match.index);
        if (requestIndex === -1) continue;

        const rawRequest = findBalanced(listRaw, listRaw.indexOf('[', requestIndex));
        if (!rawRequest) continue;

        const request = parseDataLiteral(rawRequest);
        requests[requestLabel] = { id, request };
    }

    return requests;
};

const extractQueryFromRequests = (requests) => {
    for (const { request } of Object.values(requests)) {
        if (Array.isArray(request) && typeof request[0] === 'string' && request[0].trim()) {
            return request[0].trim();
        }
    }
    return null;
};

const extractLocation = (html, query) => {
    const matches = [...html.matchAll(/\[null,"([^"]{2,80})","(0x[0-9a-f]+:0x[0-9a-f]+)"/g)];
    if (matches.length === 0) return null;

    const lowerQuery = (query || '').toLowerCase();
    const matching = matches.find((match) => lowerQuery.includes(decodeHtmlEntities(match[1]).toLowerCase()));
    const chosen = matching || matches[0];
    return [null, decodeHtmlEntities(chosen[1]), chosen[2]];
};

const normalizeDate = (value) => {
    if (!Array.isArray(value) || value.length < 3) return null;
    const [year, month, day] = value.map(toNumber);
    if (!year || !month || !day) return null;
    return [year, month, day];
};

const normalizeDateRange = (value) => {
    if (!Array.isArray(value) || value.length < 2) return null;
    const checkIn = normalizeDate(value[0]);
    const checkOut = normalizeDate(value[1]);
    if (!checkIn || !checkOut) return null;
    return [checkIn, checkOut, ...value.slice(2)];
};

const extractSearchContext = (rawHotels) => {
    for (const hotel of rawHotels) {
        const dates = normalizeDateRange(hotel[6]?.[2]?.[8]) || normalizeDateRange(hotel[6]?.[1]?.[4]);
        const currency = cleanString(hotel[6]?.[2]?.[15]) || cleanString(hotel[6]?.[1]?.[3]);
        if (dates) return { dates, currency: currency || DEFAULT_CURRENCY };
    }
    return { dates: null, currency: DEFAULT_CURRENCY };
};

const buildOptions = (location, context) => {
    if (!context.dates) return null;
    const place = location ? [null, [location]] : [null, null];
    return [
        1,
        [[[3], [3]], 0],
        [place, [null, context.dates, null, null, null, [null, 0]]],
        null,
        [[null, null, null, null, null, null, context.currency]],
    ];
};

export const parseSearchPage = (html, finalUrl) => {
    const title = extractTitle(html);
    const requests = extractDataServiceRequests(html);
    const blocks = extractInitDataBlocks(html);
    const rawHotels = blocks.flatMap((block) => collectHotelNodes(block.data));
    const context = extractSearchContext(rawHotels);
    const hotels = rawHotels.map((hotel) => parseHotelNode(hotel, context)).filter(Boolean);
    const url = new URL(finalUrl);
    const query =
        extractQueryFromRequests(requests) ||
        cleanString(url.searchParams.get('q')) ||
        cleanString(decodeURIComponent(url.pathname));
    const location = extractLocation(html, query);
    const requestEntries = Object.values(requests);
    const rpcEntry =
        requestEntries.find((entry) => Array.isArray(entry.request) && entry.request[0] === query) ||
        requestEntries.find((entry) => entry.id === DEFAULT_RPC_ID) ||
        requestEntries[0];
    const nextPageToken = decodeHtmlEntities(html.match(/data-next-page-token="([^"]+)"/)?.[1] || 'CBI=');

    return {
        title,
        hotels,
        rawHotels,
        query,
        location,
        dates: context.dates,
        currency: context.currency,
        options: buildOptions(location, context),
        rpcId: rpcEntry?.id || DEFAULT_RPC_ID,
        servicePath: html.match(/"Im6cmf":"([^"]+)"/)?.[1] || DEFAULT_SERVICE_PATH,
        fSid: html.match(/"FdrFJe":"(-?\d+)"/)?.[1] || null,
        bl: html.match(/"cfb2h":"([^"]+)"/)?.[1] || null,
        hl: html.match(/"GWsdKe":"([^"]+)"/)?.[1] || url.searchParams.get('hl') || DEFAULT_LOCALE,
        gl: url.searchParams.get('gl') || DEFAULT_COUNTRY,
        nextPageToken,
        blocked: detectBlock({ html, finalUrl, title }),
    };
};

export const parseRpcPayloads = (text) => {
    const payloads = [];
    const cleaned = text.replace(/^\)\]\}'\s*/, '');

    for (const line of cleaned.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('[')) continue;

        let outer;
        try {
            outer = JSON.parse(trimmed);
        } catch {
            continue;
        }

        if (!Array.isArray(outer)) continue;

        for (const item of outer) {
            if (!Array.isArray(item) || item[0] !== 'wrb.fr' || typeof item[2] !== 'string') continue;
            try {
                payloads.push(JSON.parse(item[2]));
            } catch {
                continue;
            }
        }
    }

    return payloads;
};

export const mergeHotel = (existing, incoming) => {
    const merged = { ...existing };

    for (const [key, value] of Object.entries(incoming)) {
        if (value === null || value === undefined || value === '') continue;

        const current = merged[key];
        if (current === null || current === undefined || current === '') {
            merged[key] = value;
            continue;
        }

        if (key === 'rating' && typeof value === 'number' && value > current) {
            merged[key] = value;
        }

        if (key === 'reviewsCount' && typeof value === 'number' && value > current) {
            merged[key] = value;
        }
    }

    return merged;
};

export const hotelKey = (hotel) => {
    if (hotel.entityId) return `entity:${hotel.entityId}`;
    if (hotel.hotelId) return `hotel:${hotel.hotelId}`;
    if (hotel.name) return `name:${hotel.name.toLowerCase()}`;
    return null;
};

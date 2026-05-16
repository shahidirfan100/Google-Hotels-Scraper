## Selected API
- Endpoint: https://www.google.com/travel/search (Initial HTML + batchexecute)
- Method: GET (Initial) / POST (batchexecute)
- Auth: None (but heavily bot-protected, blocks direct gotScraping requests)
- Pagination: infinite scrolling triggering POST to `/batchexecute`
- Fields available: name, id, rating, reviews, price, currency, address, imageUrl, description, entityId, url, coordinates
- Fields currently missing in actor: None, extracting all rich fields from nested arrays.
- Field count: 12+

**Findings on Nested Array Structure:**
Based on research into `AF_initDataCallback` (ds:0) and `batchexecute` payloads:
- Hotel list is typically in an array at `data[0][0][0][1]` (for initial HTML).
- Each hotel object contains:
    - Name: index 1
    - Coordinates: index 2[0]
    - Category: index 3
    - Image: index 5[1][0][1][0]
    - Price/Currency: index 6 (complex object)
    - Rating/Reviews: index 7
    - ID/CID: index 9
    - Description: index 11[0]
    - Entity ID: index 20

**Reasoning:**
While direct `gotScraping` is blocked, Playwright Firefox allows us to load the page and intercept these rich JSON payloads. This is significantly more stable than CSS selector-based scraping, as Google's DOM changes frequently, but the internal API structure remains relatively consistent.

## Alternative Endpoint Used For Post-20 Enrichment
- Endpoint pattern: `https://www.google.com/travel/search?...&qs=<listing-token>&ts=<context>&ap=MAE`
- Source of token: `qs` query param extracted from each listing card URL (`a.PVOOXe`)
- Method: GET
- Auth: None (browser session context required for consistent responses)
- Response type: Rich hotel detail page with `AF_initDataCallback` payloads
- Typical additional fields recovered: `hotelId`, `entityId`, `hotelDescription`, `category`, `imageUrl`, `location`
- Caveat: Some detail pages do not include live `price` / `currency` for every hotel, so those values are preserved from listing cards when available.

### Why this alternative is needed
For many queries, page 2+ listing payloads include shallow card-level data for new rows. The `qs` detail URL returns a richer payload for those same hotels, enabling merge-based enrichment across the full result set.

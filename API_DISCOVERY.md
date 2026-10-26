# Google Hotels API Discovery

Last verified: 2026-10-26.

## Selected flow

1. GET a Google Travel search page, for example `https://www.google.com/travel/search?q=hotels%20in%20London&hl=en&gl=us`.
2. Read hotel records from `AF_initDataCallback` blocks in the HTML. The main list is `ds:0`; `ds:1` holds currency and filter metadata.
3. For more results, POST to Google's batchexecute endpoint with RPC `AtySUc`.

Google's JS maps `AtySUc` to `/UniversalTravelSearchService.UniversalTravelSearch`. The actor discovers the RPC id, service path, `f.sid`, build label, location entity, dates, and currency from the page instead of trusting a single hardcoded value.

## Request details

Search page:

- Method: GET
- Auth: none
- Required context: a browser-like TLS and header profile. `impit` supplies this.
- Cookies: Google sets `NID`. The actor keeps it and also sends a consent cookie for EU exits.

Batchexecute:

- Endpoint: `https://www.google.com/_/TravelFrontendUi/data/batchexecute`
- Method: POST
- Query: `rpcids=AtySUc`, `source-path=/travel/search`, `f.sid`, `bl`, `hl`, `gl`, `soc-app=162`, `soc-platform=1`, `soc-device=1`, `_reqid`, `rt=c`
- Headers: `content-type: application/x-www-form-urlencoded;charset=UTF-8`, `x-same-domain: 1`, `origin`, `referer`
- Body shape:

```
f.req=[[["AtySUc","<JSON request payload>",null,"1"]]]&
```

Decoded page 1 payload observed in the browser:

```
[
  "hotels in London",
  [
    1,
    [[[3],[3]],0],
    [
      [null,[[null,null,null,null,null,"0x47d8a00baf21de75:0x52963a5addd52a99","London"]]],
      [null,[[2026,10,27],[2026,10,28],1,null,0],null,null,null,[null,0]]
    ],
    null,
    [[null,null,null,null,null,null,"PKR"]]
  ],
  [null,null,null,null,null,"<seed hotel entity id>",13],
  null,
  1
]
```

The initial HTML already contains the first page, so the actor does not need to replay page 1.

## Pagination

The page exposes `data-next-page-token="CBI="`. Pagination uses that token plus the entity id of the last hotel on the previous page.

Page 2:

```
["hotels in London", <options>, [null,"CBI=",null,null,null,null,13,null,0]]
```

Page 3 and later:

```
["hotels in London", <options>, [null,"CBI=",null,null,null,"<last hotel entity id>",13,null,0], null, 1]
```

Observed depth for a London query: 20 hotels in the HTML, then pages of 20, 16, 7, 7, 7, and about 60 unique hotels before Google repeats results. Cloud runs with `results_wanted: 200` returned 48 to 70 unique hotels across London, Paris, New York, Tokyo, and Dubai. The actor stops after three pages with no new records, at `max_pages` (default 15), or at `results_wanted`.

## Field paths

Hotel records are arrays. Indices verified against live London results:

| Field                        | Path                                                     |
| ---------------------------- | -------------------------------------------------------- |
| Name                         | `[1]`                                                    |
| Coordinates                  | `[2][0]`                                                 |
| Check-in and check-out times | `[2][17]`                                                |
| Website                      | `[2][29][2]`                                             |
| Property type                | `[2][31]`, fallback `vacation rental` from `[10]`        |
| Country code                 | `[2][36]`                                                |
| Category                     | `[3][0]`                                                 |
| Star class                   | `[3][1]`                                                 |
| Image and image list         | `[5]`, images under `[5][1]`                             |
| Price                        | `[6][2][1][4]` or `[6][2][1][2]`                         |
| Price text                   | `[6][2][1][0]`                                           |
| Booking link                 | `[6][2][4][0]`                                           |
| Deal label                   | `[6][2][7]`                                              |
| Currency                     | `[6][2][15]`, `[6][1][3]`, price symbol, or page context |
| Rating and reviews           | `[7][0][0]` and `[7][0][1]`                              |
| Rating breakdown             | `[7][1][0]`                                              |
| Review category scores       | `[7][9]`                                                 |
| Amenities                    | `[10]`                                                   |
| Sleeps, bedrooms, bathrooms  | `[19][1]`, fallback `[10]` Essential info                |
| Booking providers            | `[19][8]`                                                |
| Hotel id / CID               | `[9]`                                                    |
| Entity id                    | `[20]`                                                   |

`[6][1][0]` looks like a price but it is the search filter context. The real hotel price is under `[6][2]`. The previous version of this actor read the wrong path and reported the filter value as the price.

The listing payload carries property type, image lists, deal labels, booking links, rating breakdowns, and review category scores. The actor reads all of them from the listing response and makes no detail-page requests. Detail pages were removed because they added one request per hotel, failed on some hotels, and returned fields the listing already exposes.

Google mixes two listing shapes in one result set:

- Hotels carry star class, category, rating breakdown, review scores, and often a deal label.
- Vacation rentals often omit star class, category, rating breakdown, review scores, and deal labels. They carry `Essential info` instead, which maps to sleeps, bedrooms, and bathrooms, and sometimes an amenities list and booking providers.

The actor reads both shapes and omits fields Google does not send. It does not invent star ratings or review data for rentals.

## Browser profiles tested

| impit profile                                                             | Result                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `chrome`, `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110` | Full desktop search page, 20 hotels                                     |
| `chrome116`                                                               | One connection reset, the same transient failure seen on other profiles |
| `chrome124`, `chrome125`, `chrome131`, `chrome142`, `chrome151`           | Full desktop search page, 20 hotels                                     |
| `chrome136`                                                               | Full desktop search page, 18 hotels                                     |
| `firefox`, `firefox128`, `firefox133`, `firefox135`, `firefox144`         | Full desktop search page, 20 hotels                                     |
| `ios18`                                                                   | Redirects to `/travel/hotels`, mobile page, 12 hotels                   |
| `okhttp3`, `okhttp5`                                                      | Redirects to `/travel/unsupported`, no usable data                      |
| `okhttp`, `okhttp4`                                                       | Connection reset in testing                                             |

Profile order in the actor: `chrome`, `chrome142`, `firefox`, `chrome151`, `ios18`. Each profile is retried twice because Google sometimes resets the first TLS connection. The `okhttp` profiles stay out of the rotation.

## Failure matrix

| Symptom                           | Cause                        | Actor response                                                       |
| --------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Connection reset on first request | TLS or edge reset            | Retry same profile, then rotate profile                              |
| HTTP 429 or 5xx                   | Rate limit or edge error     | Bounded backoff, `Retry-After`, then profile rotation                |
| Consent page                      | EU exit                      | Consent cookie and profile rotation                                  |
| `/sorry/` or "unusual traffic"    | Google block                 | Profile and proxy session rotation                                   |
| 200 with no `AF_initDataCallback` | Request shape changed        | Log the title and byte size, rotate profile, stop with a clear error |
| RPC 200 with no `wrb.fr` payload  | Stale `f.sid` or changed RPC | Log the response size, stop pagination, keep saved hotels            |
| Empty `price`                     | Hotel has no live rate       | Keep the record, omit `price`                                        |

## Cloud defaults

- No proxy is the schema default. Apify cloud runs from the standard container egress succeeded for London, Paris, New York, Tokyo, and Dubai without a proxy.
- Apify Proxy also worked when supplied. The proxy configuration stays optional.
- `max_pages` defaults to 15 and `MAX_EMPTY_PAGES` is 3, so a broad search can use the full result depth Google offers.
- The actor makes no detail-page requests. All fields come from the listing payload.

## Sources reviewed

- `outspoken_strategy/google-hotels-scraper` on Apify: confirms Google Hotels can run without a browser.
- `searchapi/google-hotels-scraper` on Apify: Playwright approach, useful for field names but heavier than needed.
- `factden/google-hotels-scraper` on Apify: output shape reference for prices and booking links.
- `kennedn/google_batchexecute`, `pndurette/pybatchexecute`, and `wong2/batchexecute`: batchexecute envelope and response framing.
- `luminati-io/google-hotels-api`: free scraper notes, used only to compare request parameters.

## Alternatives rejected

- Playwright Firefox: worked, but added a 1 to 2 GB browser layer and long run times for data already present in the HTTP response.
- `&start=20` URL pagination: returned overlapping results with no stable cursor.
- `&checkin=` and `&checkout=` URL parameters: ignored by Google in testing.
- `okhttp5` app profile: explicitly redirected to `/travel/unsupported`.
- Third-party paid APIs: outside the actor's scope and add a dependency the user did not ask for.

## Debugging order

When a run fails, read this file first, then compare the live request with the shapes above:

1. Confirm the search page still returns `AF_initDataCallback` and a Google Hotels title.
2. Confirm `AF_dataServiceRequests` still exposes an `AtySUc` entry.
3. Confirm `data-next-page-token` still exists and equals `CBI=`.
4. Confirm the hotel array still has the price under `[6][2]`.
5. Confirm `[6][2][4][0]`, `[6][2][7]`, `[7][1][0]`, and `[7][9]` still hold the booking link, deal label, rating breakdown, and review scores.
6. Re-test `chrome`, `firefox`, and `ios18` before changing code.

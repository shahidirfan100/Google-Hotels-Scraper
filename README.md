# Google Hotels Scraper

Collect hotel listings from Google Hotels for a city, landmark, or saved search URL. The actor returns hotel names, prices, ratings, review data, images, deal labels, and booking links.

## What you get

- Hotel name, Google hotel id, and Google entity id.
- Price, price text, currency, deal label, and booking link.
- Rating, review count, rating breakdown, and category review scores.
- Star class, property type, property category, country code, and hotel website.\n- Sleeps, bedrooms, and bathrooms for vacation rental listings.
- Latitude, longitude, check-in time, and check-out time when Google lists them.
- Main image and up to eight image URLs from the listing.\n- Booking sites with external links and available amenities when Google lists them.

## Input parameters

| Parameter            | Type    | Required | Default                | Description                                                              |
| -------------------- | ------- | -------- | ---------------------- | ------------------------------------------------------------------------ |
| `startUrl`           | String  | No       | London hotels search   | Google Hotels search URL. Used when `keyword` is empty.                  |
| `keyword`            | String  | No       |                        | Search text such as `hotels in Paris`. Takes precedence over `startUrl`. |
| `results_wanted`     | Integer | No       | `20`                   | Maximum number of hotels to save.                                        |
| `max_pages`          | Integer | No       | `15`                   | Maximum result pages to request.                                         |
| `proxyConfiguration` | Object  | No       | `useApifyProxy: false` | Turn on Apify Proxy or add custom proxy URLs if Google blocks your runs. |

## Output fields

| Field             | Type    | Description                                                  |
| ----------------- | ------- | ------------------------------------------------------------ |
| `name`            | String  | Hotel name.                                                  |
| `hotelId`         | String  | Google hotel identifier.                                     |
| `entityId`        | String  | Google entity identifier used in hotel URLs.                 |
| `url`             | String  | Google Hotels page for the hotel.                            |
| `rating`          | Number  | Guest rating from 0 to 5.                                    |
| `reviewsCount`    | Integer | Number of guest reviews.                                     |
| `ratingBreakdown` | Object  | Review counts for each star rating.                          |
| `reviewScores`    | Array   | Sentiment score and mention count by review category.        |
| `stars`           | Number  | Star class when Google reports one.                          |
| `category`        | String  | Property category such as `4-star hotel`.                    |
| `propertyType`    | String  | Google property type such as `hotel`, `hostel`, or `resort`. |
| `price`           | Number  | Price for the search dates.                                  |
| `priceText`       | String  | Price text as Google displays it.                            |
| `currency`        | String  | Currency code such as `USD` or `EUR`.                        |
| `dealText`        | String  | Deal label such as `46% less than usual` or `GREAT PRICE`.   |
| `bookingUrl`      | String  | Google redirect link for the displayed price.                |
| `location`        | Object  | `lat` and `lng` coordinates.                                 |
| `imageUrl`        | String  | Main hotel image.                                            |
| `images`          | Array   | Up to eight image URLs from the listing.                     |
| `website`         | String  | Hotel website when Google lists one.                         |
| `countryCode`     | String  | Two-letter country code.                                     |
| `checkInTime`     | String  | Check-in time when listed.                                   |
| `checkOutTime`    | String  | Check-out time when listed.                                  |

## Example input

```json
{
    "keyword": "hotels in Paris",
    "results_wanted": 100,
    "max_pages": 15,
    "proxyConfiguration": {\n        "useApifyProxy": false\n    }
}
```

To scrape a saved search, pass the full Google URL and leave `keyword` empty:

```json
{
    "startUrl": "https://www.google.com/travel/search?q=hotels%20in%20Dubai&hl=en&gl=us",
    "results_wanted": 50
}
```

## Sample output

```json
{
    "name": "a&o London Docklands Riverside",
    "hotelId": "0x4876039fa9af9ee1:0x8b3dd5b3512ce904",
    "entityId": "ChoIhNKzibW29Z6LARoNL2cvMTF5cWJjNXE2MhAB",
    "url": "https://www.google.com/travel/hotels/entity/ChoIhNKzibW29Z6LARoNL2cvMTF5cWJjNXE2MhAB?hl=en&gl=us",
    "rating": 3.2,
    "reviewsCount": 435,
    "ratingBreakdown": {
        "5": 37,
        "4": 18,
        "3": 10,
        "2": 8,
        "1": 27
    },
    "reviewScores": [
        {
            "category": "Room amenities",
            "score": 0,
            "mentions": 7
        },
        {
            "category": "Service",
            "score": 0,
            "mentions": 8
        }
    ],
    "stars": 4,
    "category": "4-star hotel",
    "propertyType": "hostel",
    "price": 16007,
    "priceText": "PKR 16,007",
    "currency": "PKR",
    "dealText": "46% less than usual",
    "bookingUrl": "https://www.google.com/travel/clk/hi?qid=COLRrq_m15cDFbozBgAduj8erQ",
    "location": {
        "lat": 51.5041975,
        "lng": -0.0338612
    },
    "imageUrl": "https://lh3.googleusercontent.com/grass-cs/AABkmLcCHiHhg3Sok1rnw_RtRaP-KkUNVPn-OhcTmEa3poj2zKVnCJMOVfvO3qqmmzI_XEiChZU0rJtGn0-Ux6JYfrdrGI-DhtzSZx_Cr7tKQVGNsYr_3G8y71q4g_qmTN06xcDeT-8lwun54s2U=s287-w287-h192-n-k-no-v1",
    "images": [
        "https://lh3.googleusercontent.com/grass-cs/AABkmLcCHiHhg3Sok1rnw_RtRaP-KkUNVPn-OhcTmEa3poj2zKVnCJMOVfvO3qqmmzI_XEiChZU0rJtGn0-Ux6JYfrdrGI-DhtzSZx_Cr7tKQVGNsYr_3G8y71q4g_qmTN06xcDeT-8lwun54s2U=s287-w287-h192-n-k-no-v1",
        "https://lh3.googleusercontent.com/grass-proxy/AIM7gW2Hguhad6jToIOR-qXajrO62VAWsTXm5lVTgR70TtUh6qyjIfJn0nlS13LtgLVorM_LwJcTnHAKWuqaar2Fh9DWTGO6VN31mfojifmKIGOKwRM213Een-nywz1jzmoc1BPvPTuNwubh7rX0FSvqyWkvTo7gGj9QeYM9zHEBq7rPEfjLi8QT5hw=s287-w287-h192-n-k-no-v1"
    ],
    "website": "https://www.aohostels.com/house/london-docklands-riverside/",
    "countryCode": "GB",
    "checkInTime": "3:00 PM",
    "checkOutTime": "10:00 AM"
}
```

### Vacation rental example

Google returns vacation rentals in the same list. Those records use capacity fields instead of hotel star data:

```json
{
    "name": "Buckingham Lloyds - The Kensington Gardens Apartment",
    "entityId": "ChoQt_iuocjGs_PGARoNL2cvMTF5NTF2YnBucRAC",
    "url": "https://www.google.com/travel/hotels/entity/ChoQt_iuocjGs_PGARoNL2cvMTF5NTF2YnBucRAC?hl=en&gl=us",
    "rating": 5,
    "reviewsCount": 6,
    "propertyType": "vacation rental",
    "sleeps": 6,
    "bedrooms": 3,
    "bathrooms": 2,
    "price": 175040,
    "priceText": "PKR 175,040",
    "currency": "PKR",
    "amenities": [
        "Air conditioning",
        "Kid-friendly",
        "Crib",
        "Elevator",
        "Fitness center",
        "Heating",
        "Indoor pool",
        "Ironing board",
        "Kitchen",
        "Microwave",
        "Oven stove",
        "Patio",
        "Pet-friendly",
        "Smoke-free",
        "Cable TV",
        "Washer",
        "Wheelchair accessible",
        "Free parking",
        "Free Wi-Fi"
    ],
    "bookingProviders": [
        {
            "name": "Bluepillow.com",
            "url": "https://www.bluepillow.com/search/5aa9d6cb7c00cb318cd85fa0?dest=bkng&cat=Apartment&lat=51.50104&lng=-0.1816&language=en"
        }
    ],
    "location": {
        "lat": 51.501041412353516,
        "lng": -0.18160000443458557
    }
}
```

## How a run works

The actor loads the Google Hotels result page and reads every field that Google sends with the listing. It does not open individual hotel pages, so runs stay fast and do not depend on detail-page markup.

When you ask for more hotels than the first page contains, the actor requests the next result pages through the same search service the page uses. Google may repeat hotels after several pages. The actor stops when a page adds no new hotels, when it reaches `max_pages`, or when it reaches `results_wanted`.

If Google blocks a request, the actor retries with a different browser profile. Add a proxy if Google blocks your server or region.

## Tips

- Apify Proxy is off by default because cloud runs worked without it in testing. Turn it on or use residential proxies if Google blocks your runs.
- Keep `results_wanted` at 50 to 80 for one query. In testing, broad city searches returned 48 to 70 unique hotels.
- Use `keyword` for quick searches and `startUrl` when you need a specific Google search state.
- Use `max_pages` to cap runtime. Pages that add no new hotels stop the run early.

## Use cases

- Compare room prices for a city across a set of dates.
- Track a hotel's rating, review score, and price over time.
- Build a shortlist of hotels near a landmark with coordinates and booking links.
- Feed hotel data into a spreadsheet, database, or travel site.

## Integrations

- Google Sheets for shared price sheets.
- Airtable for searchable hotel lists.
- Zapier or Make for scheduled runs.
- Webhooks for sending each finished run to your own service.

## FAQ

### Why does the price differ from the price I see in my browser?

Google shows prices for the dates and currency tied to the search page and the request location. The actor keeps the search page dates. A different proxy country or a saved search URL can change the currency and price.

### Why did I get fewer hotels than requested?

Google stopped returning new hotels for the remaining pages. Broad city searches returned 48 to 70 unique hotels in testing. Narrow the search with a neighborhood, landmark, or price filter to collect a different set.

### Where do the extra fields come from?

All fields, including deal labels, image lists, review breakdowns, and booking links, come from the Google Hotels listing response. The actor does not open each hotel page.

### Why do some records have fewer fields?\n\nGoogle mixes hotels and vacation rentals in the same result list. Vacation rentals often omit star class, review breakdowns, deal labels, and some contact fields. The actor extracts what the listing contains and does not invent missing values. Rental records usually include `sleeps`, `bedrooms`, `bathrooms`, `amenities`, and booking providers instead.\n\n### Can I use a country-specific Google domain?

Yes. Pass a URL such as `https://www.google.co.uk/travel/search?q=hotels+in+London` as `startUrl`.

## Legal notice

The actor collects publicly visible hotel data. Users are responsible for following Google's terms, local law, and the rules of any site they send the data to. Use a reasonable request volume.

# Google Hotels Scraper

Extract comprehensive hotel data from Google Travel with ease. Collect hotel names, prices, ratings, reviews, and more from any location or search URL.

## Features

- **API-Based Extraction** — Fetches data directly from Google's internal APIs for maximum speed and accuracy.
- **Rich Data Fields** — Captures names, ratings, review counts, prices, currencies, addresses, and images.
- **Flexible Input** — Supports both direct Google Hotels URLs and simple keywords with locations.
- **Automatic Pagination** — Automatically scrolls and paginates to reach your desired number of results.
- **Proxy Support** — Built-in support for Apify Proxy to ensure high reliability and stealth.

## Use Cases

### Market Research
Analyze hotel pricing trends across different cities and regions to identify market opportunities and competitive positioning.

### Price Monitoring
Track room rates for specific hotels or areas over time to stay informed about market fluctuations and seasonal changes.

### Travel Planning & Booking
Build comprehensive datasets of hotel options for travel applications, providing users with up-to-date information on ratings and prices.

### Competitive Intelligence
Monitor competitors' ratings and review counts to understand their market standing and customer satisfaction levels.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Direct Google Hotels search URL to start scraping from. |
| `keyword` | String | No | — | Search keyword (e.g., "hotels in London") to find hotels. |
| `results_wanted` | Integer | No | `20` | Maximum number of hotel listings to collect. |
| `max_pages` | Integer | No | `1` | Maximum number of pages/scrolls to perform. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": true}` | Proxy settings for reliable extraction. |

---

## Output Data

Each hotel listing in the dataset contains the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Name of the hotel property. |
| `hotelId` | String | Unique Google entity ID for the hotel. |
| `description` | String | Brief description or tagline of the hotel. |
| `rating` | Number | Numerical star rating (out of 5). |
| `reviewsCount` | Number | Total count of user reviews. |
| `category` | String | Hotel category (e.g., "4-star hotel"). |
| `price` | Number | Current nightly price (numerical). |
| `currency` | String | Currency code (e.g., USD, EUR). |
| `address` | String | Full physical address of the hotel. |
| `location` | Object | Latitude and Longitude coordinates. |
| `imageUrl` | String | URL of the primary hotel image. |
| `url` | String | Direct link to the hotel details on Google Travel. |

---

## Usage Examples

### Search by Keyword

Find hotels in a specific city:

```json
{
    "startUrl": "https://www.google.com/travel/search?q=hotels+in+London",
    "results_wanted": 50
}
```

### Direct URL Scraping

Scrape from a specific search URL with filters applied:

```json
{
    "startUrl": "https://www.google.com/travel/search?q=hotels+in+Paris&ts=CAE...",
    "results_wanted": 100,
    "max_pages": 5
}
```

---

## Sample Output

```json
{
  "name": "The Waldorf Hilton, London",
  "hotelId": "0x487604caf5885343:0x4b72118b03a17fdf",
  "description": "Refined rooms in a landmark 1908 hotel, plus a grand restaurant & 2 elegant bars.",
  "rating": 4.4,
  "reviewsCount": 4417,
  "category": "4-star hotel",
  "imageUrl": "https://lh3.googleusercontent.com/...",
  "entityId": "ChUI3_-FnbCxhLlLGgkvbS8wNmNna3EQAQ",
  "url": "https://www.google.com/travel/hotels/entity/ChUI3_-FnbCxhLlLGgkvbS8wNmNna3EQAQ",
  "location": {
    "lat": 51.5125403,
    "lng": -0.1189807
  },
  "price": 225,
  "currency": "USD"
}
```

---

## Tips for Best Results

### Use Specific Keywords
Include city names or landmarks in your keywords (e.g., "hotels near Eiffel Tower") for more targeted results.

### Adjust Results Wanted
Start with a small number (e.g., 20) for testing before scaling up to larger collections.

### Enable Proxies
Always use Apify Proxy (Residential recommended) for production runs to prevent rate limiting and blocks.

---

## Integrations

Connect your hotel data with:

- **Google Sheets** — Export directly for analysis and reporting.
- **Airtable** — Build searchable hotel databases.
- **Zapier** — Trigger workflows based on new hotel discoveries.
- **Webhooks** — Send data to your custom endpoints in real-time.

### Export Formats

- **JSON** — For developers and application integration.
- **CSV** — For spreadsheet analysis and manual review.
- **Excel** — For business reporting and presentations.

---

## Frequently Asked Questions

### How many hotels can I collect?
You can collect up to several hundred hotels per run. For very large datasets, consider running multiple instances with different keywords.

### Does it handle different currencies?
Yes, it extracts the price and currency as shown on the Google Travel page based on your location or proxy settings.

### What if no hotels are found?
Ensure your keyword or URL is valid and accessible. Google sometimes changes its internal API structure; if issues persist, check the logs for details.

---

## Support

For issues or feature requests, contact support through the Apify Console.

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.

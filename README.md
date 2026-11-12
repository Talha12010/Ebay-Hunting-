# eBay Dropshipping Hunter

A Manifest V3 Chrome extension for researching potential dropshipping products on eBay UK (https://www.ebay.co.uk/).

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Click the extension icon and start a scan.

## What it does

- **Multi-page scanning** — scans several search-result pages per keyword in a hidden background tab (1–20 pages per keyword, configurable), with **Start / Pause / Resume / Stop** controls and a live progress bar. Only generic, unbranded listings that pass the dropshipping winner checks are stored — branded and non-viable products are discarded during the scan.
- **Smart product discovery** — enter custom keywords and/or tick category chips (Home & Kitchen, Garden & Outdoor, Pet Supplies, Car Accessories, Phone Accessories, Beauty Accessories, Sports & Fitness, DIY & Tools, Storage & Organisation, Office, Travel).
- **Filtering** — minimum star rating (default 4.5, only listings with visible rating data pass), price range in GBP, and brand exclusion: a built-in list of well-known manufacturer/trademark brands (including **Varo**) plus your own blacklist, matched with word boundaries against titles and verified item-specific brand values so ordinary descriptive words are not mistaken for brands.
- **Brand verification** — a per-product *Verify brand* action loads the actual item page and reads the real `Brand:` value from the item specifics instead of guessing.
- **Opportunity analysis** — per product: price, rating, review count, sold/watching signals when eBay shows them, a transparent 0–100 suitability score with a visible weight breakdown, and a competition proxy (Low/Medium/High/Unknown) based only on recorded interest.
- **Profit estimates** — `Profit = Price − Assumed cost − Assumed fees − Assumed shipping`, using *your own assumptions* from Settings (cost %, fees %, shipping £). Results are always labelled as estimates; the extension never fabricates supplier prices, sales volume or demand data.
- **Dashboard** — tiles for total scanned, matching, unbranded, average rating, best-scoring product, and average estimated profit; 8 sort modes including best overall, lowest price, highest estimated profit/margin, most reviews/sold.
- **Actions per product** — open on eBay, copy link, save/unsave favourites, expandable details view with the full data set and score breakdown, verify brand.
- **Exports** — CSV and Excel (SpreadsheetML `.xls`) for current results or favourites.
- **Saved Products** and **Scan History** tabs; **Settings** page covers filters, profit assumptions, scan speed, and data clearing.
- **Data accuracy** — every result links to its real eBay listing URL, duplicates are merged by item ID, missing fields are shown as "Not shown" rather than invented, and review counts are never confused with star scores.

## Architecture

| File | Role |
| --- | --- |
| `manifest.json` | MV3 config: storage/tabs/scripting permissions, ebay.co.uk host access |
| `background.js` | Service worker: scan queue engine, page navigation with rate-limit delays, product merge/dedupe, brand-verify flow, scan state in `chrome.storage.session` |
| `content.js` | Extracts listing data from search pages and item details from item pages |
| `popup.html/css/js` | Dashboard: Hunter / Saved / History / Settings tabs, stats, filters, cards, exports |
| `lib.js` | Shared logic: brand list, scoring, profit estimates, categories, CSV/Excel builders |
| `options.html/css/js` | Full settings page (filters, profit assumptions, scan behaviour, data clearing) |

## Limitations (by design)

- Supplier, competitor and sales-velocity data are **not** available through eBay's public pages, so they are never invented. Profit and margin figures are clearly flagged as estimates derived from your settings.
- The tool only reads pages you scan; it does not bypass CAPTCHAs, authentication, anti-bot systems or eBay's terms. Rate limits are respected with configurable delays between pages.
- Review counts and ratings depend on what eBay renders; listings without visible rating data are excluded from "matching" results by default.

# LFG SEO baseline, 2026-09-21

Taken the day the SEO fixes and the www host move went live. Compare against it on or after 2026-10-19.

Source: Search Console domain property `sc-domain:lfgdubai.com`, seomonster `gsc_search_analytics`, data_state "all". GSC hides some queries, so query rows do not add up to the totals.

## Before the change: 2026-08-24 to 2026-09-20 (28 days)

| Metric | Value |
|---|---|
| Clicks | 89 |
| Impressions | 826 |
| CTR | 10.8% |

| Query | Clicks | Impressions | Avg position |
|---|---|---|---|
| lfg dubai | 27 | 57 | 1.3 |
| lfg | 17 | 190 | 2.3 |
| bootcamp dubai | 0 | 61 | 16.4 |
| dubai bootcamp | 0 | 19 | 16.5 |
| dubai run club | 0 | 19 | 8.1 |

90 days to 2026-09-21: the bare domain took 262 clicks and 2,687 impressions, www took 4 and 411. Google listed the homepage and /bootcamp on the bare domain and /shop on www.

## What changed on 2026-09-21

- Every canonical, og:url, share image, JSON-LD id, sitemap entry and robots line names https://www.lfgdubai.com. The bare domain 308s to www (was 307).
- Event schema on /bootcamp and /padel carries a real startDate and endDate. Google Rich Results Test: 1 valid Event on each (was a FAIL on /padel).
- Homepage links go straight to /bootcamp (was a 308 hop). Homepage description is 156 characters (was 206).
- Share images absolute and 1200x630 on /bootcamp and /shop.
- Sitemap submitted to the domain property: 6 URLs, 0 errors. The bogus /bootcamp "sitemap" in the www property was deleted.

## How to compare on 2026-10-19

1. `gsc_compare_periods` on `sc-domain:lfgdubai.com`: 2026-09-22 to 2026-10-19 against the window above.
2. `rank_change_attribution` with change date 2026-09-21. It is observational, report its verdict and interval, never "this caused".
3. `gsc_batch_inspect_urls` on the www URLs of /, /bootcamp, /padel, /shop: google_canonical should read www, and /bootcamp and /padel rich results should read PASS.

Expect the homepage listing to move from the bare domain to www first. Brand queries sit at positions 1 to 2 and should hold. "bootcamp dubai" at 16 will not move much from these fixes alone: it needs page content and off-site listings, which are still open.

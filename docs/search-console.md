# Search Console sitemap submission

1. Verify the canonical `https://{team}fanzone.com/` property in Google Search Console using a supported verification method.
2. Deploy the site, then open `https://{team}fanzone.com/sitemap.xml` and confirm it returns XML with a successful HTTP status.
3. In Search Console, choose **Sitemaps**, enter `sitemap.xml`, and select **Submit**.
4. Submit `news-sitemap.xml` only after the newsroom publishes qualifying news articles. An empty news sitemap is valid before then.
5. Review the sitemap and Page indexing reports after Google processes them. Fix reported canonical, redirect, or crawl problems in the site; resubmission does not guarantee indexing or rich results.

The standard sitemap intentionally omits privacy utilities, placeholders, 404 pages, and empty generated detail pages. Query-string states point to the same path-only canonical URL and are not separate sitemap entries.

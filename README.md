# ShopProfit

Lightweight, client-side Etsy profit calculator. The project has no runtime dependencies and can be deployed as a static site to Cloudflare Pages from this directory.

## Local preview

Run `npm start` and open `http://localhost:4173`. The dependency-free Node preview server reads `_redirects`, so extensionless calculator, FAQ, methodology, and alias routes behave like the Cloudflare Pages routing configuration.

## SEO page generation

Run `npm run build:seo` before deployment. It creates static country and digital-product calculator pages and fills the crawlable fee table from the calculator's country data. The standalone `/methodology`, `/faq`, `/privacy`, and `/terms` pages provide crawlable product, privacy, and usage information without requiring JavaScript.

In Cloudflare Pages, use `npm run build:seo` as the build command and `.` as the output directory. The canonical origin in the source is `https://shopprofitcalculator.com/`. Attach the domain and configure HTTP-to-HTTPS and `www`-to-apex redirects in Cloudflare after confirming domain ownership; those host-level redirects cannot be guaranteed by a static `_redirects` file. This project does not purchase or configure domains.

The public support address is configured in `config/site-config.json` under `SUPPORT_EMAIL`. The SEO build writes that address into Privacy, Terms, Contact, and the footer. Run `npm run check:launch` after the build; it fails if the address is missing or invalid. Update this one value if the support address changes, then rebuild.

## Fee assumptions

Etsy's 6.5% transaction fee, country-specific payment processing rates, and regulatory operating rates are entered in `src/countries.js`. Fixed listing, processing, Offsite Ads cap, and Etsy Plus subscription amounts shown in local currencies are estimates where Etsy publishes the charge in USD. Exchange rates change; the calculator excludes sales tax, VAT on seller fees, foreign exchange charges, deposit fees, and account-specific adjustments. Rate data should be checked against Etsy's current fee pages before launch and refreshed when Etsy changes its schedule.

- [Etsy Fee Basics](https://help.etsy.com/hc/en-us/articles/360035902374-Etsy-Fee-Basics)
- [Etsy Payments processing rates](https://help.etsy.com/hc/en-us/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy)
- [Etsy regulatory operating fees](https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee)

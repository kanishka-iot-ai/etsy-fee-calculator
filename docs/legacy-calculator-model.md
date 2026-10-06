# ShopProfit — Legacy Calculator Model Inventory & Specification

> [!WARNING]
> **STATUS: LEGACY / FROZEN**  
> This document specifies the historical static calculator engine located in `src/calculator.js`, `src/countries.js`, and `src/app.js`.  
> **RULE:** Do NOT add new countries, do NOT modify hardcoded rates, and do NOT change calculation mathematics in this legacy model.  
> All future fee intelligence, dynamic rates, and country expansions must be sourced from the live API (`v1.1.1`+).

---

## 1. Architectural Overview

The legacy calculator is an entirely client-side, integer-cent calculation engine designed to estimate Etsy seller net profit and profit margins across 12 baseline countries.

### Legacy Core Files
1. [`src/calculator.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/calculator.js): Pure functional mathematical engine. Implements forward net profit calculation, binary search break-even solver, and target pricing.
2. [`src/countries.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/countries.js): Static lookup table defining 12 baseline market schedules, currency symbols, estimated listing/Plus fees, and time zone inference.
3. [`src/app.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/app.js): DOM orchestration layer, form input parsing, digital vs. physical toggle, local storage caching, and UI output rendering.

---

## 2. Legacy Fee Field Inventory

| Field | Current Source | Current Value | Currency | Fee Base | Calculation Location | Used By | Replacement Field in v1.1.1 | Migration Status |
|---|---|---|---|---|---|---|---|---|
| **Listing Fee** | `src/countries.js` | US: 0.20, UK: 0.16, CA: 0.27, AU: 0.28, DE/FR/IT/ES: 0.18, IN: 16.5, JP: 30, TR: 7, OTHER: 0.20 | Local estimated | Per listing unit | `src/calculator.js:44` (`cents(country.listingFee)`) | `calculateSale`, `netAtPrice` | `listingFee` (`r.listing_fee_amount`) | **AUTO-CALCULATABLE** |
| **Transaction Rate** | `src/calculator.js:1` | `0.065` (6.5%) | Local order currency | Gross revenue (`itemPrice + shipping`) | `src/calculator.js:45` (`rateFee(grossCents, 0.065)`) | `calculateSale`, `netAtPrice`, solver | `r.transaction_rate` | **AUTO-CALCULATABLE** |
| **Processing Rate** | `src/countries.js` | US/CA/AU: 3.0%, UK/DE/FR/IT/ES: 4.0%, IN: 5.0%, JP: 6.0%, TR/OTHER: 6.5% | Local order currency | Gross revenue (`itemPrice + shipping`) | `src/calculator.js:46` (`rateFee(gross, country.processingRate)`) | `calculateSale`, `netAtPrice`, solver | `processingRate` (`r.processing_rate`) | **AUTO-CALCULATABLE** |
| **Processing Fixed Fee** | `src/countries.js` | US/CA/AU: 0.25, UK: 0.20, DE/FR/IT/ES/OTHER: 0.30, IN: 25, JP: 45, TR: 14 | Local currency | Per completed order transaction | `src/calculator.js:46` (`cents(country.processingFixed)`) | `calculateSale`, `netAtPrice`, solver | `processingFixed` (`r.processing_fixed_amount`) | **AUTO-CALCULATABLE** |
| **Regulatory Operating Fee** | `src/countries.js` | UK: 0.48%, CA: 0.50%, FR: 1.14%, IT: 0.80%, ES: 0.88%, IN: 0.05%, TR: 1.67%, US/AU/DE/JP/OTHER: 0% | Local order currency | Gross revenue (`itemPrice + shipping`) | `src/calculator.js:47` (`rateFee(gross, country.regulatoryRate)`) | `calculateSale`, `netAtPrice`, solver | `regulatoryRate` (`r.regulatory_rate`) | **AUTO-CALCULATABLE** |
| **Offsite Ads Rate** | UI option / param | `0.0`, `0.12` (12%), or `0.15` (15%) | Local order currency | Gross revenue (`itemPrice + shipping`) | `src/calculator.js:48` | `calculateSale`, solver | `r.offsite_rate_below_threshold` / `above` | **CONDITIONAL** |
| **Offsite Ads Cap** | `src/countries.js` | US/OTHER: $100, UK: £80, CA: CA$135, AU: A$150, EUR: €95, IN: ₹8300, JP: ¥15000, TR: ₺3400 | Local estimated | Max fee per attributed order | `src/calculator.js:48` (`cents(country.offsiteCap ?? 100)`) | `calculateSale`, solver | `offsiteCap` (`r.offsite_cap_amount`) | **AUTO-CALCULATABLE** |
| **Etsy Plus Monthly Fee** | `src/countries.js` | US/OTHER: 10, UK: 8, CA: 13.5, AU: 15, EUR: 9.5, IN: 830, JP: 1500, TR: 340 | Local estimated | Monthly account subscription | `src/calculator.js:49` (`plusMonthly / salesPerMonth`) | `calculateSale`, solver | `plusMonthly` (`r.plus_monthly_amount`) | **ACCOUNT-LEVEL** |
| **Production Cost** | User input | Variable (default: 0) | Local currency | Direct COGS | `src/calculator.js:50` | `calculateSale`, solver | N/A (User cost input) | **AUTO-CALCULATABLE** |
| **Packaging / Shipping Cost** | User input | Variable (default: 0) | Local currency | Fulfillment cost | `src/calculator.js:51` | `calculateSale`, solver | N/A (User cost input) | **AUTO-CALCULATABLE** |
| **Currency Conversion Fee** | *Not modeled* | Implicit 0% (assumes domestic currency) | Payout currency | Converted payout | N/A | N/A | `r.currency_conversion_rate` (2.5%) | **INFORMATIONAL** |
| **Deposit Fee Schedule** | *Not modeled* | Implicit 0 (assumes no deposit fee or over threshold) | Bank currency | Per disbursement below threshold | N/A | N/A | `depositSchedule` in v1.1.1 | **INFORMATIONAL / ACCOUNT-LEVEL** |
| **Setup Fee** | *Not modeled* | Implicit 0 | USD | One-time onboarding | N/A | N/A | `setup_fee_amount` in v1.1.1 | **INFORMATIONAL** |

---

## 3. Mathematical Formulation & Rounding Rules

### A. Number Representation (Integer Cents)
All monetary calculations in `src/calculator.js` are performed in 100-multiplier integer minor units ("cents"):
$$\text{toCents}(v) = \min(9999999999, \max(0, \operatorname{round}((v + \varepsilon) \times 100)))$$
where $\varepsilon = \text{Number.EPSILON}$.

### B. Gross Revenue
$$\text{grossCents} = \text{itemPriceCents} + \text{shippingChargedCents}$$

### C. Platform Fees Breakdown
1. **Listing Fee:**
   $$\text{listingCents} = \operatorname{round}(\text{country.listingFee} \times 100)$$
2. **Transaction Fee:**
   $$\text{transactionCents} = \operatorname{round}(\text{grossCents} \times 0.065)$$
3. **Payment Processing Fee:**
   $$\text{processingCents} = \operatorname{round}(\text{grossCents} \times \text{country.processingRate}) + \operatorname{round}(\text{country.processingFixed} \times 100)$$
4. **Regulatory Operating Fee:**
   $$\text{regulatoryCents} = \operatorname{round}(\text{grossCents} \times \text{country.regulatoryRate})$$
5. **Offsite Ads Fee:**
   $$\text{offsiteCents} = \min\left(\operatorname{round}(\text{grossCents} \times \text{offsiteRate}), \operatorname{round}(\text{country.offsiteCap} \times 100)\right)$$
6. **Total Platform Fees:**
   $$\text{feesCents} = \text{listingCents} + \text{transactionCents} + \text{processingCents} + \text{regulatoryCents} + \text{offsiteCents}$$

### D. Seller Costs & Subscriptions
1. **Etsy Plus (Amortized per Sale):**
   $$\text{plusCents} = \begin{cases} \operatorname{round}\left(\frac{\text{country.plusMonthly} \times 100}{\max(1, \text{salesPerMonth})}\right) & \text{if plus is enabled} \\ 0 & \text{otherwise} \end{cases}$$
2. **Total Costs:**
   $$\text{costsCents} = \text{productionCents} + \text{packagingCents} + \text{plusCents}$$

### E. Profit & Margins
1. **Net Profit:**
   $$\text{netCents} = \text{grossCents} - \text{feesCents} - \text{costsCents}$$
2. **Profit Margin:**
   $$\text{margin} = \begin{cases} \frac{\text{netCents}}{\text{grossCents}} & \text{if grossCents} > 0 \\ 0 & \text{otherwise} \end{cases}$$
3. **Kept per 100 Cents:**
   $$\text{keptPer100Cents} = \operatorname{round}(\text{margin} \times 10000)$$

### F. Break-Even Solver (`solveMinimumItemPrice`)
Binary search over integer cents solving for $\text{itemCents}$ such that:
$$\text{netAtPrice}(\text{itemCents}) \ge \text{targetProfitCents}$$
Initial upper bound estimate:
$$\text{high} = \max\left(0, \left\lceil \frac{\text{fixedFees} + \text{costs} + \text{targetProfit}}{\max(10^{-6}, 1 - \sum \text{rates})} \right\rceil - \text{shippingCharged}\right)$$
Refined iteratively with binary bisecting until convergence ($O(\log N)$ steps).

---

## 4. Legacy Country Catalog & Timezone Fallback

The legacy catalog is strictly hardcoded to 12 rows:
- `US` (United States, USD)
- `UK` (United Kingdom, GBP)
- `CA` (Canada, CAD)
- `AU` (Australia, AUD)
- `DE` (Germany / Eurozone, EUR)
- `FR` (France, EUR)
- `IT` (Italy, EUR)
- `ES` (Spain, EUR)
- `IN` (India, INR)
- `JP` (Japan, JPY)
- `TR` (Türkiye, TRY)
- `OTHER` (Global / Other, USD)

### Time Zone Fallback Heuristic
`src/countries.js:countryFromTimeZone()` inspects `Intl.DateTimeFormat().resolvedOptions().timeZone`:
- `america/toronto`, `america/vancouver`, `america/edmonton`, `america/winnipeg`, `america/halifax` $\to$ `CA`
- `america/*` $\to$ `US`
- `europe/london` $\to$ `UK`
- `europe/paris` $\to$ `FR`
- `europe/rome` $\to$ `IT`
- `europe/madrid` $\to$ `ES`
- `europe/berlin`, `europe/amsterdam`, `europe/vienna` $\to$ `DE`
- `australia/*` $\to$ `AU`
- `asia/kolkata`, `asia/calcutta` $\to$ `IN`
- `asia/tokyo` $\to$ `JP`
- `europe/istanbul` $\to$ `TR`
- All other time zones $\to$ `OTHER`

---

## 5. Frozen State & Guarantees
- The legacy calculator math in `src/calculator.js` is mathematically deterministic and frozen.
- All existing tests (216 root tests) assert against these exact integer-cent equations.
- Any future integration must maintain exact backward compatibility for these 12 baseline markets.

# ShopProfit — Calculator Migration Map: Legacy to v1.1.1 Intelligence

> [!NOTE]
> This document maps every legacy static calculator entity and calculation dimension to the live, audited `v1.1.1` Global Etsy Fee Intelligence schema.

---

## 1. Migration Dimension Matrix

| Dimension / Fee | Legacy Field | v1.1.1 Source Field | Classification | Migration Rationale & Operational Handling |
|---|---|---|---|---|
| **Country Identification** | `code` (12 countries in `COUNTRIES`) | `country_code` (62 countries via `/v1/fees`) | **AUTO-CALCULATABLE** | Directly hydrates the dropdown with 61 sovereign markets + 1 fallback (`OTHER`). |
| **Transaction Fee** | `TRANSACTION_RATE = 0.065` | `r.transaction_rate = 0.065` | **AUTO-CALCULATABLE** | Universal constant across all jurisdictions; matches live schema perfectly. |
| **Payment Processing (Rate)** | `processingRate` (hardcoded decimal) | `r.processing_rate` | **AUTO-CALCULATABLE** | Automatically supplied per country from official Help Center article 115015628847. |
| **Payment Processing (Fixed)** | `processingFixed` (hardcoded local currency) | `r.processing_fixed_amount` | **AUTO-CALCULATABLE** | Directly used in fixed transaction fee calculations. |
| **Processing Currency** | Implicit (assumed same as `currency`) | `r.processing_fixed_currency` | **INFORMATIONAL** | Allows user warning if listing currency differs from fixed fee denomination (e.g. Japan USD vs JPY). |
| **Domestic vs International Split** | `processingNote` (text only in CA, AU) | `domestic_processing_rate`, `international_processing_rate` | **CONDITIONAL** | Legacy calculator assumes domestic processing. Can be toggled if user specifies international order. |
| **Regulatory Operating Fee** | `regulatoryRate` (0 or percentage) | `r.regulatory_rate` (numeric or `null`) | **AUTO-CALCULATABLE** | Automatically applied for the 9 statutory markets (`CA, FR, HU, IT, IN, ES, TR, UK, VN`); `null` cleanly treated as 0 cents. |
| **Offsite Ads Rate** | `offsiteRate` (0, 0.12, 0.15) | `offsite_rate_below_threshold`, `offsite_rate_above_threshold` | **CONDITIONAL** | 15% standard vs 12% high-volume ($10k+ annual revenue). User selects their shop tier. |
| **Offsite Ads Cap** | `country.offsiteCap ?? 100` | `r.offsite_cap_amount` | **AUTO-CALCULATABLE** | Directly caps maximum Offsite Ads charge to official converted threshold ($100 USD equivalent). |
| **Etsy Plus Subscription** | `country.plusMonthly` | `r.plus_monthly_amount` | **ACCOUNT-LEVEL** | Amortized across user's estimated monthly sales (`plusMonthly / salesPerMonth`). |
| **Deposit Fee Schedule** | *Not modeled in legacy* | `depositSchedule` (`mode, dailyDepositMinimum, feeThreshold, fee`) | **ACCOUNT-LEVEL / INFORMATIONAL** | Deducted at disbursement, not per order. Displayed as account-level intelligence banner. |
| **Currency Conversion Fee** | *Not modeled in legacy* | `r.currency_conversion_rate = 0.025` (2.5%) | **CONDITIONAL / INFORMATIONAL** | Incurred only when listing currency differs from payment account bank currency. |
| **Setup Fee** | *Not modeled in legacy* | `r.setup_fee_amount` ($15 USD / $10 USD in IN) | **INFORMATIONAL** | One-time shop onboarding fee. Displayed in fee breakdown educational tooltips. |
| **Payoneer Integration Context** | *Not modeled in legacy* | `isPayoneerCountry` (16 sovereign markets) | **INFORMATIONAL** | Flags that seller receives funds via Payoneer account, where additional withdrawal fees may apply. |
| **EUR Bank Payout Context** | *Not modeled in legacy* | `bankFxPossibility` (`BG, HR, CZ, HU, RO, PL`) | **INFORMATIONAL** | Informs sellers that Etsy deposits EUR and receiving local bank may charge foreign exchange fees. |

---

## 2. Classification Definitions

1. **AUTO-CALCULATABLE:**
   Directly mapped to order-level arithmetic in `calculateSale()` without requiring new user inputs or assumptions.
   *Examples:* Transaction rate (6.5%), payment processing rate & fixed fee, regulatory rate (for 9 statutory markets), listing fee, Offsite Ads cap.

2. **CONDITIONAL:**
   Requires specific order-level context or seller configuration toggle.
   *Examples:* Offsite Ads tier (0%, 12%, 15%), Domestic vs. International order processing split (e.g. Canada 3% domestic vs 4% international), Currency conversion fee (2.5% if order is cross-currency).

3. **ACCOUNT-LEVEL:**
   Fees that apply at the seller shop level rather than per individual sale.
   *Examples:* Etsy Plus monthly subscription ($10/mo), Deposit schedule minimums and threshold fees.

4. **INFORMATIONAL:**
   Crucial contextual fee intelligence that should be communicated transparently to the seller via badges, notes, or tooltips, but is not subtracted from order gross revenue.
   *Examples:* Payoneer disbursement requirements, bank FX conversion risks for EUR payout markets (`BG, HR, CZ, HU, RO, PL`), one-time shop setup fee ($15 / $10 USD).

5. **NOT YET INTEGRATED:**
   Features reserved for future iterations (e.g., dynamic live FX exchange rates, live automated tax lookups).

---

## 3. Authoritative Etsy Fee Base Audit

A critical engineering finding is that Etsy fees do **NOT** share a single universal calculation base. The table below documents the authoritative base for each fee per official documentation:

```
┌──────────────────────────────┬────────────────────────────────────────────────────────────────────────┐
│ Fee Type                     │ Exact Calculation Base                                                 │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ Transaction Fee              │ 6.5% of total order amount in designated listing currency.             │
│                              │ Base = Item Price + Shipping + Gift Wrap (excl. Etsy-collected tax).   │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ Payment Processing Fee       │ Percentage + Fixed Fee on total sale price, including shipping,        │
│                              │ gift wrap, and applicable buyer sales tax / VAT processed by Etsy.     │
│                              │ Base = Item Price + Shipping + Gift Wrap + Buyer Sales Tax.            │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ Regulatory Operating Fee     │ Country-specific percentage on item price + shipping + gift wrap.      │
│                              │ Base = Item Price + Shipping + Gift Wrap (excl. Etsy-collected tax).   │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ Offsite Ads Fee              │ 15% or 12% of attributed order total, capped at $100 USD equivalent.  │
│                              │ Base = Attributed Item Price + Shipping + Gift Wrap.                   │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ Currency Conversion Fee      │ 2.5% deducted on total converted sale amount when listing currency     │
│                              │ differs from payment account bank deposit currency.                    │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ Deposit Fee                  │ Fixed fee deducted at disbursement if balance is below threshold.      │
│                              │ Base = Account disbursement batch balance (not per transaction).       │
└──────────────────────────────┴────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> In the legacy calculator (`src/calculator.js`), buyer sales tax is not modeled in order inputs. Therefore, `grossCents = itemPrice + shipping` acts as the uniform base for Transaction, Processing, Regulatory, and Offsite Ads. When migrating or extending, maintaining this baseline behavior ensures 100% backward compatibility for all baseline test cases.

---

## 4. Migration Architecture Blueprint (Step 11B Readiness)

```
[ v1.1.1 Cloudflare API / Cache ]
               │
               ▼
   [ src/compatibility.js ]  <── Normalizes API v1.1.1 schema
               │
               ▼
   [ toCalculatorCountry() ] <── Formats rule into legacy-compatible shape
               │
               ▼
      [ src/calculator.js ]  <── Pure deterministic math (UNTOUCHED)
               │
               ▼
      [ src/app.js (UI) ]    <── Seamless rendering across 62 countries
```

This decoupled architecture guarantees zero regression: if the API is offline or initializing, `src/countries.js` remains the static fallback, while dynamic hydration upgrades the country selector to all 62 audited global markets.

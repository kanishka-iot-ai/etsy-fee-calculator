import { FeeIntelligenceClient } from '../src/fee-intelligence-client.js';
import { calculateOrderFees, solveRequiredPrice } from '../src/fee-engine.js';

const PROD_URL = 'https://shopprofitcalculator.com';
const WORKER_URL = 'https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev';

async function main() {
  console.log('=====================================================');
  console.log('SHOPPROFIT STEP 12 LIVE SMOKE TEST & PRODUCTION AUDIT');
  console.log('=====================================================\n');

  let allPassed = true;

  // 1. Worker API Checks (Step 12)
  console.log('--- Step 12: API Production Check ---');
  const verRes = await fetch(`${WORKER_URL}/v1/version`);
  const verData = await verRes.json();
  console.log(`GET /v1/version status: ${verRes.status}`);
  console.log(`Active version_id: ${verData.version_id} (expected: v1.1.1)`);
  if (verRes.status !== 200 || verData.version_id !== 'v1.1.1') {
    console.error('FAIL: Version check failed!');
    allPassed = false;
  }

  const feesRes = await fetch(`${WORKER_URL}/v1/fees`);
  const feesData = await feesRes.json();
  const countryCount = Object.keys(feesData.countries || {}).length;
  const orderCount = (feesData.countryOrder || []).length;
  console.log(`GET /v1/fees status: ${feesRes.status}`);
  console.log(`Total countries: ${countryCount} (expected: 62)`);
  console.log(`Total countryOrder: ${orderCount} (expected: 62)`);
  if (countryCount !== 62 || orderCount !== 62) {
    console.error('FAIL: Country count mismatch!');
    allPassed = false;
  }

  // 2. Client & Normalized Map Load
  console.log('\n--- Step 8: Client & All 62 Markets Load ---');
  const client = new FeeIntelligenceClient(WORKER_URL);
  const normalizedPayload = await client.loadAllNormalizedFeeSchedules();
  console.log(`Normalized schedules loaded: ${normalizedPayload.schedules.size}`);
  console.log(`Payload version: ${normalizedPayload.version_id}`);
  if (normalizedPayload.schedules.size !== 62) {
    console.error('FAIL: Normalized schedule count mismatch!');
    allPassed = false;
  }

  // 3. Core Calculator Verification (Step 6)
  console.log('\n--- Step 6: Core Calculator Verification ---');
  const coreTestCases = [
    { country: 'US', itemPrice: 50, shipping: 5, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'USD' },
    { country: 'UK', itemPrice: 40, shipping: 4, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'GBP' },
    { country: 'CA', itemPrice: 45, shipping: 10, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'CAD' },
    { country: 'CA', itemPrice: 45, shipping: 10, giftWrap: 0, buyerTax: 0, orderType: 'international', currency: 'CAD' },
    { country: 'AU', itemPrice: 60, shipping: 8, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'AUD' },
    { country: 'AU', itemPrice: 60, shipping: 8, giftWrap: 0, buyerTax: 0, orderType: 'international', currency: 'AUD' },
    { country: 'IN', itemPrice: 2000, shipping: 200, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'INR' },
    { country: 'JP', itemPrice: 5000, shipping: 500, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'JPY' },
    { country: 'TR', itemPrice: 1000, shipping: 100, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'TRY' },
    { country: 'BG', itemPrice: 50, shipping: 5, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'EUR' },
    { country: 'VN', itemPrice: 500000, shipping: 50000, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'VND' },
    { country: 'OTHER', itemPrice: 50, shipping: 5, giftWrap: 0, buyerTax: 0, orderType: 'domestic', currency: 'USD' }
  ];

  for (const tc of coreTestCases) {
    const schedule = normalizedPayload.schedules.get(tc.country);
    if (!schedule) {
      console.error(`FAIL: Missing schedule for ${tc.country}`);
      allPassed = false;
      continue;
    }
    const result = calculateOrderFees({
      country: schedule,
      itemPrice: tc.itemPrice,
      shipping: tc.shipping,
      giftWrap: tc.giftWrap,
      buyerSalesTax: tc.buyerTax,
      orderType: tc.orderType,
      listingCurrency: tc.currency,
      paymentAccountCurrency: tc.currency
    });

    const totalFees = result.totals.totalEtsyFees;
    const profit = result.totals.totalProfit;
    const margin = result.totals.margin * 100;

    const hasNaN = [totalFees, profit, margin].some(v => typeof v !== 'number' || Number.isNaN(v));
    if (hasNaN) {
      console.error(`FAIL: NaN detected in ${tc.country} calculation!`);
      allPassed = false;
    } else {
      console.log(`✔ [${tc.country.padEnd(5)} ${tc.orderType.padEnd(13)}] Price: ${String(tc.itemPrice).padStart(6)} ${tc.currency} | Total Fees: ${totalFees.toFixed(2)} | Profit: ${profit.toFixed(2)} | Margin: ${margin.toFixed(2)}% | Reg: ${result.feeBreakdown.regulatory.toFixed(2)}`);
    }
  }

  // 4. Special Features (Step 7)
  console.log('\n--- Step 7: Special Features Verification ---');
  const usSchedule = normalizedPayload.schedules.get('US');

  // 4.1 Offsite Ads 15% & Cap
  const offsite15 = calculateOrderFees({
    country: usSchedule,
    itemPrice: 1000,
    shipping: 0,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  console.log(`✔ Offsite Ads 15% on $1000: fee = $${offsite15.feeBreakdown.offsiteAds} (capped at $100: ${offsite15.feeBreakdown.offsiteAds === 100})`);
  if (offsite15.feeBreakdown.offsiteAds !== 100) {
    console.error('FAIL: Offsite Ads $100 cap failed!');
    allPassed = false;
  }

  // 4.2 Offsite Ads 12%
  const offsite12 = calculateOrderFees({
    country: usSchedule,
    itemPrice: 100,
    shipping: 0,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12
  });
  console.log(`✔ Offsite Ads 12% on $100: fee = $${offsite12.feeBreakdown.offsiteAds}`);
  if (offsite12.feeBreakdown.offsiteAds !== 12) {
    console.error('FAIL: Offsite Ads 12% failed!');
    allPassed = false;
  }

  // 4.3 Etsy Plus
  const plusTest = calculateOrderFees({
    country: usSchedule,
    itemPrice: 50,
    shipping: 0,
    plusEnabled: true,
    salesPerMonth: 20
  });
  console.log(`✔ Etsy Plus $10 amortized over 20 sales: allocation = $${plusTest.feeBreakdown.etsyPlusAmortized}`);
  if (plusTest.feeBreakdown.etsyPlusAmortized !== 0.5) {
    console.error('FAIL: Etsy Plus amortization failed!');
    allPassed = false;
  }

  // 4.4 Target Pricing & Break Even
  const targetPriceCents = solveRequiredPrice(20, {
    country: usSchedule,
    shipping: 5,
    itemCost: 10,
    shippingCost: 5
  });
  const targetPrice = targetPriceCents / 100;
  console.log(`✔ Target Pricing ($20 target profit): required price = $${targetPrice.toFixed(2)}`);

  const breakEvenCents = solveRequiredPrice(0, {
    country: usSchedule,
    shipping: 5,
    itemCost: 10,
    shippingCost: 5
  });
  const breakEvenPrice = breakEvenCents / 100;
  console.log(`✔ Break-Even Pricing ($0 profit): break-even price = $${breakEvenPrice.toFixed(2)}`);
  if (!targetPrice || targetPrice <= 0 || !breakEvenPrice || breakEvenPrice <= 0) {
    console.error('FAIL: Target / Break-even pricing failed!');
    allPassed = false;
  }

  // 4.5 Digital Download mode
  const digitalTest = calculateOrderFees({
    country: usSchedule,
    itemPrice: 15,
    shipping: 0,
    orderType: 'domestic',
    itemCost: 0,
    shippingCost: 0,
    packagingCost: 0
  });
  console.log(`✔ Digital Download mode ($15 item): total fees = $${digitalTest.totals.totalEtsyFees.toFixed(2)}, net profit = $${digitalTest.totals.totalProfit.toFixed(2)}`);

  // 4.6 Currency Conversion 2.5%
  const fxTest = calculateOrderFees({
    country: usSchedule,
    itemPrice: 100,
    shipping: 0,
    listingCurrency: 'USD',
    paymentAccountCurrency: 'EUR'
  });
  console.log(`✔ Currency conversion 2.5% on $100: fee = $${fxTest.feeBreakdown.currencyConversion.toFixed(2)}`);
  if (fxTest.feeBreakdown.currencyConversion !== 2.5) {
    console.error('FAIL: Currency conversion 2.5% failed!');
    allPassed = false;
  }

  // 4.7 Deposit schedule display for statutory markets (TR, VN, etc.)
  const trSchedule = normalizedPayload.schedules.get('TR');
  const trDeposit = trSchedule.accountLevelFees.deposit;
  const trMin = trDeposit.depositMinimum;
  const trThreshold = trDeposit.feeThreshold;
  const trFee = trDeposit.feeAmount;
  console.log(`✔ TR Deposit schedule: min = ${trMin} TRY, threshold = ${trThreshold} TRY, fee = ${trFee} TRY`);
  if (trMin !== 50 || trThreshold !== 600 || trFee !== 42) {
    console.error('FAIL: TR deposit fee mismatch!');
    allPassed = false;
  }

  // Verify all 9 Step 10F markets have correct deposit schedules
  const statutoryDepositExpected = {
    ID: { min: 28000, threshold: 1400000, fee: 28000, cur: 'IDR' },
    IL: { min: 7, threshold: 350, fee: 7, cur: 'ILS' },
    MY: { min: 9, threshold: 400, fee: 8, cur: 'MYR' },
    MX: { min: 40, threshold: 2000, fee: 40, cur: 'MXN' },
    MA: { min: 20, threshold: 1000, fee: 20, cur: 'MAD' },
    PH: { min: 100, threshold: 5000, fee: 100, cur: 'PHP' },
    ZA: { min: 35, threshold: 1500, fee: 30, cur: 'ZAR' },
    TR: { min: 50, threshold: 600, fee: 42, cur: 'TRY' },
    VN: { min: 45000, threshold: 2300000, fee: 45000, cur: 'VND' }
  };

  for (const [code, exp] of Object.entries(statutoryDepositExpected)) {
    const dep = normalizedPayload.schedules.get(code)?.accountLevelFees?.deposit;
    if (!dep || dep.depositMinimum !== exp.min || dep.feeThreshold !== exp.threshold || dep.feeAmount !== exp.fee || dep.currency !== exp.cur) {
      console.error(`FAIL: Statutory deposit mismatch for ${code}: expected`, exp, 'got', dep);
      allPassed = false;
    } else {
      console.log(`✔ [${code} Statutory Deposit] min: ${dep.depositMinimum} ${dep.currency}, threshold: ${dep.feeThreshold} ${dep.currency}, fee: ${dep.feeAmount} ${dep.currency}`);
    }
  }

  // 5. Live Production Routes (Step 9)
  console.log('\n--- Step 9: Live Production Routes (HTTP 200) ---');
  const required200Routes = [
    '/',
    '/fees/',
    '/methodology/',
    '/faq/',
    '/etsy-fee-calculator-uk',
    '/etsy-fee-calculator-canada',
    '/etsy-fee-calculator-australia',
    '/etsy-digital-download-fee-calculator',
    '/privacy',
    '/terms',
    '/contact',
    '/404.html'
  ];

  for (const r of required200Routes) {
    const res = await fetch(`${PROD_URL}${r}`);
    const text = await res.text();
    const canonMatch = text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const canon = canonMatch ? canonMatch[1] : 'NONE';
    const is200 = res.status === 200;
    console.log(`${is200 ? '✔' : '✖'} Route: ${r.padEnd(40)} | Status: ${res.status} | Canon: ${canon}`);
    if (!is200 || (r !== '/404.html' && (!canon || !canon.startsWith('https://shopprofitcalculator.com')))) {
      console.error(`FAIL on route ${r}: status ${res.status}, canon ${canon}`);
      allPassed = false;
    }
  }

  // 6. Live Production Redirects (Step 9)
  console.log('\n--- Step 9: Live Production Redirects (HTTP 301) ---');
  const requiredRedirects = [
    { from: '/etsy-fee-calculator', to: '/fees/' },
    { from: '/etsy-profit-calculator', to: '/' },
    { from: '/calculator', to: '/#calculator' },
    { from: '/fee-breakdown', to: '/fees/' },
    { from: '/how-it-works', to: '/methodology/' },
    { from: '/help', to: '/faq/' }
  ];

  for (const red of requiredRedirects) {
    const res = await fetch(`${PROD_URL}${red.from}`, { redirect: 'manual' });
    const loc = res.headers.get('location');
    const isRedirect = res.status === 301 || res.status === 302;
    const targetMatch = loc === red.to || loc === `${PROD_URL}${red.to}`;
    console.log(`${(isRedirect && targetMatch) ? '✔' : '✖'} Redirect: ${red.from.padEnd(25)} -> ${loc} (${res.status})`);
    if (!isRedirect || !targetMatch) {
      console.error(`FAIL on redirect ${red.from}: status ${res.status}, loc ${loc}`);
      allPassed = false;
    }
  }

  // 7. SEO Live Check (Step 10)
  console.log('\n--- Step 10: SEO Live Check ---');
  const sitemapRes = await fetch(`${PROD_URL}/sitemap.xml`);
  const sitemapTxt = await sitemapRes.text();
  console.log(`✔ sitemap.xml: status ${sitemapRes.status}, contains shopprofitcalculator.com: ${sitemapTxt.includes('https://shopprofitcalculator.com')}`);
  if (sitemapRes.status !== 200 || !sitemapTxt.includes('https://shopprofitcalculator.com')) {
    console.error('FAIL: sitemap.xml invalid');
    allPassed = false;
  }

  const robotsRes = await fetch(`${PROD_URL}/robots.txt`);
  const robotsTxt = await robotsRes.text();
  console.log(`✔ robots.txt: status ${robotsRes.status}, contains Sitemap link: ${robotsTxt.includes('Sitemap: https://shopprofitcalculator.com/sitemap.xml')}`);
  if (robotsRes.status !== 200 || !robotsTxt.includes('Sitemap: https://shopprofitcalculator.com/sitemap.xml')) {
    console.error('FAIL: robots.txt invalid');
    allPassed = false;
  }

  // 8. Anchor Regression (Step 11)
  console.log('\n--- Step 11: Anchor Regression in index.html ---');
  const homeRes = await fetch(`${PROD_URL}/`);
  const homeHtml = await homeRes.text();
  const requiredAnchors = [
    'id="calculator"',
    'id="target-pricing"',
    'id="break-even-tool"',
    'id="offsite-ads"',
    'id="result-heading"',
    'href="/fees/"',
    'href="/methodology/"',
    'href="/faq/"'
  ];
  for (const anchor of requiredAnchors) {
    const present = homeHtml.includes(anchor);
    console.log(`${present ? '✔' : '✖'} Anchor element present: ${anchor}`);
    if (!present) {
      console.error(`FAIL: Missing anchor element ${anchor}`);
      allPassed = false;
    }
  }

  // 9. Module Assets Integrity (Step 5)
  console.log('\n--- Step 5: Module Assets Integrity ---');
  const modules = [
    '/src/fee-intelligence-client.js',
    '/src/compatibility.js',
    '/src/fee-engine.js',
    '/src/app.js'
  ];
  for (const mod of modules) {
    const modRes = await fetch(`${PROD_URL}${mod}`);
    const isJs = modRes.headers.get('content-type')?.includes('javascript');
    console.log(`${(modRes.status === 200 && isJs) ? '✔' : '✖'} Module: ${mod.padEnd(35)} | Status: ${modRes.status} | Content-Type: ${modRes.headers.get('content-type')}`);
    if (modRes.status !== 200 || !isJs) {
      console.error(`FAIL on module ${mod}`);
      allPassed = false;
    }
  }

  console.log('\n=====================================================');
  if (allPassed) {
    console.log('ALL LIVE PRODUCTION SMOKE TESTS PASSED (100% GREEN)');
  } else {
    console.error('LIVE SMOKE TESTS HAD FAILURES');
  }
  console.log('=====================================================');

  return allPassed;
}

main().then(success => {
  if (!success) process.exit(1);
});

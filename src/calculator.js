export const TRANSACTION_RATE = 0.065;
export const OFFSITE_CAP = 100;
const MAX_CENTS = 9_999_999_999;
const toCents = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return amount === Infinity ? MAX_CENTS : 0;
  return Math.min(MAX_CENTS, Math.max(0, Math.round((amount + Number.EPSILON) * 100)));
};
const rateFee = (amountCents, rate) => Math.round(amountCents * rate);
const cents = (value) => Math.max(0, Math.round(value * 100));

function netAtPrice(itemCents, { shipping, country, offsiteRate, plusCents, production, packaging }) {
  const gross = itemCents + toCents(shipping);
  const platformFees = cents(country.listingFee) + rateFee(gross, TRANSACTION_RATE)
    + rateFee(gross, country.processingRate) + cents(country.processingFixed)
    + rateFee(gross, country.regulatoryRate)
    + Math.min(rateFee(gross, offsiteRate), cents(country.offsiteCap ?? OFFSITE_CAP));
  return gross - platformFees - plusCents - toCents(production) - toCents(packaging);
}

function solveMinimumItemPrice(targetCents, { shipping, country, offsiteRate, plusCents, production, packaging }) {
  const rate = TRANSACTION_RATE + country.processingRate + country.regulatoryRate + offsiteRate;
  const fixed = cents(country.listingFee) + cents(country.processingFixed) + plusCents
    + toCents(production) + toCents(packaging) + targetCents;
  let high = Math.max(0, Math.ceil(fixed / Math.max(0.000001, 1 - rate) - toCents(shipping)));
  while (netAtPrice(high, { shipping, country, offsiteRate, plusCents, production, packaging }) < targetCents) {
    high = Math.max(high + 100, high * 2);
  }
  let low = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (netAtPrice(mid, { shipping, country, offsiteRate, plusCents, production, packaging }) >= targetCents) high = mid;
    else low = mid + 1;
  }
  return low;
}

export function calculateGrossRevenue(itemPrice, shipping) {
  return toCents(itemPrice) + toCents(shipping);
}

export function calculateSale({ itemPrice, shipping, production, packaging, country, offsiteRate = 0, plus = false, salesPerMonth = 30 }) {
  const grossCents = calculateGrossRevenue(itemPrice, shipping);
  const listingCents = cents(country.listingFee);
  const transactionCents = rateFee(grossCents, TRANSACTION_RATE);
  const processingCents = rateFee(grossCents, country.processingRate) + cents(country.processingFixed);
  const regulatoryCents = rateFee(grossCents, country.regulatoryRate);
  const offsiteCents = Math.min(rateFee(grossCents, offsiteRate), cents(country.offsiteCap ?? OFFSITE_CAP));
  const plusCents = plus ? Math.round(cents(country.plusMonthly) / Math.max(1, salesPerMonth)) : 0;
  const productionCents = toCents(production);
  const packagingCents = toCents(packaging);
  const feesCents = listingCents + transactionCents + processingCents + regulatoryCents + offsiteCents;
  const costsCents = productionCents + packagingCents + plusCents;
  const netCents = grossCents - feesCents - costsCents;
  const margin = grossCents > 0 ? netCents / grossCents : 0;
  const breakEvenCents = solveMinimumItemPrice(0, { shipping, country, offsiteRate, plusCents, production, packaging });

  return {
    grossCents, listingCents, transactionCents, processingCents, regulatoryCents, offsiteCents,
    productionCents, packagingCents, plusCents, feesCents, costsCents, netCents, margin,
    breakEvenCents,
    platformRate: grossCents ? feesCents / grossCents : 0,
    costsRate: grossCents ? costsCents / grossCents : 0,
    keptPer100Cents: Math.round(margin * 10000),
  };
}

export function calculateRequiredPrice({ targetProfit, shipping, country, offsiteRate = 0, plus = false, salesPerMonth = 30, production = 0, packaging = 0 }) {
  const plusCents = Math.round(plus ? cents(country.plusMonthly) / Math.max(1, salesPerMonth) : 0);
  return solveMinimumItemPrice(toCents(targetProfit), { shipping, country, offsiteRate, plusCents, production, packaging });
}

export function formatMoney(minorUnits, country, { currency = country.currency } = {}) {
  const value = (Number(minorUnits) || 0) / 100;
  try {
    return new Intl.NumberFormat(country.locale, { style: "currency", currency }).format(value);
  } catch {
    return `${country.symbol}${value.toFixed(currency === "JPY" ? 0 : 2)}`;
  }
}

export const asCents = (value) => toCents(value);

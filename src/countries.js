/**
 * Seller fee assumptions shown by ShopProfit.
 * Processing and regulatory rates are based on Etsy's published fee tables.
 * Local listing fees and Etsy Plus equivalents are estimates of Etsy's USD
 * charges converted to the display currency; exchange rates can change.
 */
export const COUNTRIES = {
  US: { name: "United States", flag: "🇺🇸", currency: "USD", symbol: "$", locale: "en-US", listingFee: 0.20, processingRate: 0.03, processingFixed: 0.25, regulatoryRate: 0, plusMonthly: 10, offsiteCap: 100 },
  UK: { name: "United Kingdom", flag: "🇬🇧", currency: "GBP", symbol: "£", locale: "en-GB", listingFee: 0.16, processingRate: 0.04, processingFixed: 0.20, regulatoryRate: 0.0048, plusMonthly: 8, offsiteCap: 80 },
  CA: { name: "Canada", flag: "🇨🇦", currency: "CAD", symbol: "CA$", locale: "en-CA", listingFee: 0.27, processingRate: 0.03, processingFixed: 0.25, regulatoryRate: 0.005, plusMonthly: 13.5, offsiteCap: 135, processingNote: "Domestic or US order rate; international orders are 4% + CA$0.25." },
  AU: { name: "Australia", flag: "🇦🇺", currency: "AUD", symbol: "A$", locale: "en-AU", listingFee: 0.28, processingRate: 0.03, processingFixed: 0.25, regulatoryRate: 0, plusMonthly: 15, offsiteCap: 150, processingNote: "Domestic order rate; international orders are 4% + A$0.25." },
  DE: { name: "Germany / Eurozone", flag: "🇩🇪", currency: "EUR", symbol: "€", locale: "de-DE", listingFee: 0.18, processingRate: 0.04, processingFixed: 0.30, regulatoryRate: 0, plusMonthly: 9.5, offsiteCap: 95 },
  FR: { name: "France", flag: "🇫🇷", currency: "EUR", symbol: "€", locale: "fr-FR", listingFee: 0.18, processingRate: 0.04, processingFixed: 0.30, regulatoryRate: 0.0114, plusMonthly: 9.5, offsiteCap: 95 },
  IT: { name: "Italy", flag: "🇮🇹", currency: "EUR", symbol: "€", locale: "it-IT", listingFee: 0.18, processingRate: 0.04, processingFixed: 0.30, regulatoryRate: 0.008, plusMonthly: 9.5, offsiteCap: 95 },
  ES: { name: "Spain", flag: "🇪🇸", currency: "EUR", symbol: "€", locale: "es-ES", listingFee: 0.18, processingRate: 0.04, processingFixed: 0.30, regulatoryRate: 0.0088, plusMonthly: 9.5, offsiteCap: 95 },
  IN: { name: "India", flag: "🇮🇳", currency: "INR", symbol: "₹", locale: "en-IN", listingFee: 16.5, processingRate: 0.05, processingFixed: 25, regulatoryRate: 0.0005, plusMonthly: 830, offsiteCap: 8300 },
  JP: { name: "Japan", flag: "🇯🇵", currency: "JPY", symbol: "¥", locale: "ja-JP", listingFee: 30, processingRate: 0.06, processingFixed: 45, regulatoryRate: 0, plusMonthly: 1500, offsiteCap: 15000, processingNote: "Etsy publishes the fixed processing charge in USD; the JPY amount is an estimate and currency conversion is not modeled." },
  TR: { name: "Türkiye", flag: "🇹🇷", currency: "TRY", symbol: "₺", locale: "tr-TR", listingFee: 7, processingRate: 0.065, processingFixed: 14, regulatoryRate: 0.0167, plusMonthly: 340, offsiteCap: 3400 },
  OTHER: { name: "Global / Other", flag: "🌐", currency: "USD", symbol: "$", locale: "en-US", listingFee: 0.20, processingRate: 0.065, processingFixed: 0.30, regulatoryRate: 0, plusMonthly: 10, offsiteCap: 100, processingNote: "Generic USD baseline only; this is not a country-specific Etsy fee schedule." },
};

export const COUNTRY_ORDER = ["US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"];

export function countryFromTimeZone(timeZone = "") {
  const zone = timeZone.toLowerCase();
  if (zone.startsWith("america/toronto") || zone.startsWith("america/vancouver") || zone.startsWith("america/edmonton") || zone.startsWith("america/winnipeg") || zone.startsWith("america/halifax")) return "CA";
  if (zone.startsWith("america/")) return "US";
  if (zone.startsWith("europe/london")) return "UK";
  if (zone.startsWith("europe/paris")) return "FR";
  if (zone.startsWith("europe/rome")) return "IT";
  if (zone.startsWith("europe/madrid")) return "ES";
  if (zone.startsWith("europe/berlin") || zone.startsWith("europe/amsterdam") || zone.startsWith("europe/vienna")) return "DE";
  if (zone.startsWith("australia/")) return "AU";
  if (zone.startsWith("asia/kolkata") || zone.startsWith("asia/calcutta")) return "IN";
  if (zone.startsWith("asia/tokyo")) return "JP";
  if (zone.startsWith("europe/istanbul")) return "TR";
  return "OTHER";
}

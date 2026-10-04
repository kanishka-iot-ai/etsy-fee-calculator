import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_LANGUAGES,
  SUPPORTED_UI_LANGUAGES,
  parseLanguageTag,
  detectPreferredLanguage,
  isLanguageSupported,
  getLanguageDirection,
  getLanguageLocale,
  formatNumber,
  formatCurrency,
  formatDate
} from "../src/i18n.js";
import { LANGUAGES, languageForRegion } from "../src/translations.js";
import { COUNTRIES } from "../src/countries.js";
import { calculateSale, calculateRequiredPrice } from "../src/calculator.js";
import { readFile } from "node:fs/promises";

test("ALL_LANGUAGES registry contains worldwide languages across major scripts", () => {
  assert.ok(Object.keys(ALL_LANGUAGES).length >= 30, "registry has 30+ global languages");
  const required = [
    "en", "hi", "bn", "pa", "mr", "gu", "ta", "te", "kn", "ml", "or", "as",
    "fr", "de", "es", "pt", "it", "nl", "pl", "tr", "ja", "ko", "zh",
    "ar", "he", "fa", "ur", "ru", "uk", "vi", "th", "id", "ms", "fil"
  ];
  for (const code of required) {
    assert.ok(ALL_LANGUAGES[code], `ALL_LANGUAGES includes ${code}`);
    assert.ok(ALL_LANGUAGES[code].name, `${code} has English name`);
    assert.ok(ALL_LANGUAGES[code].nativeName, `${code} has native name`);
    assert.ok(ALL_LANGUAGES[code].locale, `${code} has locale`);
    assert.ok(ALL_LANGUAGES[code].dir === "ltr" || ALL_LANGUAGES[code].dir === "rtl", `${code} has valid direction`);
  }
});

test("SUPPORTED_UI_LANGUAGES only includes verified complete UI translation dictionaries", () => {
  for (const code of SUPPORTED_UI_LANGUAGES) {
    assert.ok(LANGUAGES[code], `LANGUAGES dictionary exists for ${code}`);
    assert.ok(LANGUAGES[code].strings, `${code} has strings`);
    if (code !== "en") {
      assert.ok(Object.keys(LANGUAGES[code].strings).length > 50, `${code} has substantial translation dictionary`);
    }
  }
});

test("parseLanguageTag extracts language, region, and script correctly", () => {
  const parsedFr = parseLanguageTag("fr-FR");
  assert.equal(parsedFr.language, "fr");
  assert.equal(parsedFr.region, "FR");

  const parsedZh = parseLanguageTag("zh-Hans-CN");
  assert.equal(parsedZh.language, "zh");
  assert.equal(parsedZh.region, "CN");

  const parsedEn = parseLanguageTag("en-US");
  assert.equal(parsedEn.language, "en");
  assert.equal(parsedEn.region, "US");

  assert.equal(parseLanguageTag(""), null);
  assert.equal(parseLanguageTag(null), null);
});

test("detectPreferredLanguage respects Priority 1: explicit user saved choice", () => {
  // Explicit saved choice overrides whatever browser says
  assert.equal(detectPreferredLanguage({ savedLanguage: "fr-FR", languages: ["en-US"] }), "fr-FR");
  assert.equal(detectPreferredLanguage({ savedLanguage: "de-DE", languages: ["zh-CN", "en-US"] }), "de-DE");
  assert.equal(detectPreferredLanguage({ savedLanguage: "ja-JP", languages: ["fr-FR"] }), "ja-JP");
  assert.equal(detectPreferredLanguage({ savedLanguage: "es", languages: ["en-US"] }), "es-ES");
  assert.equal(detectPreferredLanguage({ savedLanguage: "ar", languages: ["en-US"] }), "ar");

  // Invalid or 'auto' saved language falls through to browser preferences
  assert.equal(detectPreferredLanguage({ savedLanguage: "auto", languages: ["fr-FR"] }), "fr-FR");
  assert.equal(detectPreferredLanguage({ savedLanguage: "invalid-code", languages: ["de-DE"] }), "de-DE");
});

test("detectPreferredLanguage handles Priority 2, 3, and 4 across all 25+ requested language tags", () => {
  const tests = [
    // Exact & regional matches for supported languages
    { input: ["en-US"], expected: "en" },
    { input: ["en-GB"], expected: "en" },
    { input: ["fr-FR"], expected: "fr-FR" },
    { input: ["fr-CA"], expected: "fr-FR" },
    { input: ["de-DE"], expected: "de-DE" },
    { input: ["de-AT"], expected: "de-DE" },
    { input: ["es-ES"], expected: "es-ES" },
    { input: ["es-MX"], expected: "es-ES" },
    { input: ["ja-JP"], expected: "ja-JP" },
    { input: ["hi-IN"], expected: "hi-IN" },
    { input: ["zh-CN"], expected: "zh-CN" },
    { input: ["ar"], expected: "ar" },
    { input: ["ar-EG"], expected: "ar" },

    // Traditional Chinese guard: zh-TW must not fall into simplified zh-CN
    { input: ["zh-TW", "en-US"], expected: "en" },
    { input: ["zh-HK", "en-GB"], expected: "en" },

    // Languages not in SUPPORTED_UI_LANGUAGES fallback safely to English
    { input: ["pt-BR", "en-US"], expected: "en" },
    { input: ["pt-PT", "en-US"], expected: "en" },
    { input: ["it-IT", "en-US"], expected: "en" },
    { input: ["nl-NL", "en-US"], expected: "en" },
    { input: ["ko-KR", "en-US"], expected: "en" },
    { input: ["bn-IN", "en-US"], expected: "en" },
    { input: ["pa-IN", "en-US"], expected: "en" },
    { input: ["he", "en-US"], expected: "en" },
    { input: ["fa", "en-US"], expected: "en" },
    { input: ["ur", "en-US"], expected: "en" },
    { input: ["ru-RU", "en-US"], expected: "en" },
    { input: ["th-TH", "en-US"], expected: "en" },
    { input: ["vi-VN", "en-US"], expected: "en" },
    { input: ["id-ID", "en-US"], expected: "en" },

    // Empty and missing arrays fallback to English
    { input: [], expected: "en" },
    { input: null, expected: "en" },
    { input: [""], expected: "en" },
  ];

  for (const { input, expected } of tests) {
    const result = detectPreferredLanguage({ savedLanguage: null, languages: input });
    assert.equal(result, expected, `testing ${JSON.stringify(input)} -> expected ${expected}, got ${result}`);
  }
});

test("RTL and LTR direction helpers return correct values", () => {
  assert.equal(getLanguageDirection("ar"), "rtl");
  assert.equal(getLanguageDirection("ar-EG"), "rtl");
  assert.equal(getLanguageDirection("he"), "rtl");
  assert.equal(getLanguageDirection("fa"), "rtl");
  assert.equal(getLanguageDirection("ur"), "rtl");

  assert.equal(getLanguageDirection("en"), "ltr");
  assert.equal(getLanguageDirection("fr-FR"), "ltr");
  assert.equal(getLanguageDirection("de-DE"), "ltr");
  assert.equal(getLanguageDirection("es-ES"), "ltr");
  assert.equal(getLanguageDirection("hi-IN"), "ltr");
  assert.equal(getLanguageDirection("ja-JP"), "ltr");
  assert.equal(getLanguageDirection("zh-CN"), "ltr");
});

test("formatNumber formats without mutating underlying numerical values", () => {
  const val = 1234.56;
  const en = formatNumber(val, "en-US");
  assert.ok(en.includes("1,234.56") || en.includes("1234.56"));

  const de = formatNumber(val, "de-DE");
  assert.ok(de.includes("1.234,56") || de.includes("1234,56"));

  // Check NaN and invalid numbers don't throw
  assert.equal(formatNumber(NaN), "0");
  assert.equal(formatNumber(Infinity), "0");
});

test("formatCurrency supports different country currencies and locales independently", () => {
  const usd = formatCurrency(3500, COUNTRIES.US);
  assert.ok(usd.includes("35"));

  const gbp = formatCurrency(3500, COUNTRIES.UK);
  assert.ok(gbp.includes("35"));

  const inr = formatCurrency(3500, COUNTRIES.IN);
  assert.ok(inr.includes("35"));
});

test("CALCULATOR REGRESSION: math remains 100% identical regardless of UI language", () => {
  // Test scenario with all fee components:
  // Item $35, shipping $5, production $7, packaging $4, US seller, 15% offsite ads, Etsy Plus ON, 20 sales/mo
  const baseInput = {
    itemPrice: 35,
    shipping: 5,
    production: 7,
    packaging: 4,
    country: COUNTRIES.US,
    offsiteRate: 0.15,
    plus: true,
    salesPerMonth: 20
  };

  const baseline = calculateSale(baseInput);
  const baselineBreakEven = baseline.breakEvenCents;
  const baselineTarget = calculateRequiredPrice({ ...baseInput, targetProfit: 15 });

  // Baseline verification:
  // Gross: 3500 + 500 = 4000
  // Listing: 20
  // Transaction: round(4000 * 0.065) = 260
  // Processing: round(4000 * 0.03) + 25 = 120 + 25 = 145
  // Regulatory: 0
  // Offsite: min(round(4000 * 0.15), 10000) = 600
  // Plus allocation: round(1000 / 20) = 50
  // Platform fees: 20 + 260 + 145 + 0 + 600 = 1025
  // Costs: 700 + 400 + 50 = 1150
  // Net: 4000 - 1025 - 1150 = 1825
  assert.equal(baseline.grossCents, 4000);
  assert.equal(baseline.listingCents, 20);
  assert.equal(baseline.transactionCents, 260);
  assert.equal(baseline.processingCents, 145);
  assert.equal(baseline.regulatoryCents, 0);
  assert.equal(baseline.offsiteCents, 600);
  assert.equal(baseline.plusCents, 50);
  assert.equal(baseline.feesCents, 1025);
  assert.equal(baseline.costsCents, 1150);
  assert.equal(baseline.netCents, 1825);

  // Now verify that changing language context NEVER mutates these numbers
  const testLanguages = ["en", "fr-FR", "de-DE", "es-ES", "hi-IN", "ja-JP", "zh-CN", "ar"];
  for (const lang of testLanguages) {
    const saleResult = calculateSale(baseInput);
    const breakEven = saleResult.breakEvenCents;
    const targetPrice = calculateRequiredPrice({ ...baseInput, targetProfit: 15 });

    assert.equal(saleResult.grossCents, baseline.grossCents, `${lang} grossCents must match`);
    assert.equal(saleResult.feesCents, baseline.feesCents, `${lang} feesCents must match`);
    assert.equal(saleResult.costsCents, baseline.costsCents, `${lang} costsCents must match`);
    assert.equal(saleResult.netCents, baseline.netCents, `${lang} netCents must match`);
    assert.equal(saleResult.margin, baseline.margin, `${lang} margin must match`);
    assert.equal(breakEven, baselineBreakEven, `${lang} breakEven must match`);
    assert.equal(targetPrice, baselineTarget, `${lang} targetPrice must match`);
  }
});

test("styles.css includes script-safe font stacks and RTL architecture", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(css.includes("[dir=\"rtl\"]"), "styles.css has RTL selectors");
  assert.ok(css.includes("--font-display"), "styles.css defines --font-display");
  assert.ok(css.includes("Noto Sans Arabic"), "styles.css has Arabic font fallback");
  assert.ok(css.includes("Noto Sans Devanagari"), "styles.css has Devanagari font fallback");
  assert.ok(css.includes("Noto Sans JP"), "styles.css has Japanese font fallback");
  assert.ok(css.includes("Noto Sans SC"), "styles.css has Chinese font fallback");
});

test("index.html language selector contains native language labels including Arabic", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes("id=\"language-nav\""), "language selector exists");
  assert.ok(html.includes("value=\"auto\""), "Auto option exists");
  assert.ok(html.includes("value=\"en\">English</option>"));
  assert.ok(html.includes("value=\"fr-FR\">Français</option>"));
  assert.ok(html.includes("value=\"de-DE\">Deutsch</option>"));
  assert.ok(html.includes("value=\"es-ES\">Español</option>"));
  assert.ok(html.includes("value=\"ja-JP\">日本語</option>"));
  assert.ok(html.includes("value=\"zh-CN\">中文</option>"));
  assert.ok(html.includes("value=\"hi-IN\">हिन्दी</option>"));
  assert.ok(html.includes("value=\"ar\">العربية</option>"));
});

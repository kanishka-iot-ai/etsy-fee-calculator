/**
 * ShopProfit — Global Language, Locale & Internationalization Engine
 *
 * Implements deterministic browser-first language detection, scalable
 * worldwide language registry, BCP 47 locale parsing, RTL direction support,
 * and localized display formatting without altering financial mathematics.
 */

export const ALL_LANGUAGES = {
  en: { name: "English", nativeName: "English", locale: "en", dir: "ltr" },
  hi: { name: "Hindi", nativeName: "हिन्दी", locale: "hi-IN", dir: "ltr" },
  bn: { name: "Bengali", nativeName: "বাংলা", locale: "bn-IN", dir: "ltr" },
  pa: { name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", locale: "pa-IN", dir: "ltr" },
  mr: { name: "Marathi", nativeName: "मराठी", locale: "mr-IN", dir: "ltr" },
  gu: { name: "Gujarati", nativeName: "ગુજરાતી", locale: "gu-IN", dir: "ltr" },
  ta: { name: "Tamil", nativeName: "தமிழ்", locale: "ta-IN", dir: "ltr" },
  te: { name: "Telugu", nativeName: "తెలుగు", locale: "te-IN", dir: "ltr" },
  kn: { name: "Kannada", nativeName: "ಕನ್ನಡ", locale: "kn-IN", dir: "ltr" },
  ml: { name: "Malayalam", nativeName: "മലയാളം", locale: "ml-IN", dir: "ltr" },
  or: { name: "Odia", nativeName: "ଓଡ଼ିଆ", locale: "or-IN", dir: "ltr" },
  as: { name: "Assamese", nativeName: "অসমীয়া", locale: "as-IN", dir: "ltr" },
  fr: { name: "French", nativeName: "Français", locale: "fr-FR", dir: "ltr" },
  de: { name: "German", nativeName: "Deutsch", locale: "de-DE", dir: "ltr" },
  es: { name: "Spanish", nativeName: "Español", locale: "es-ES", dir: "ltr" },
  pt: { name: "Portuguese", nativeName: "Português", locale: "pt-PT", dir: "ltr" },
  it: { name: "Italian", nativeName: "Italiano", locale: "it-IT", dir: "ltr" },
  nl: { name: "Dutch", nativeName: "Nederlands", locale: "nl-NL", dir: "ltr" },
  pl: { name: "Polish", nativeName: "Polski", locale: "pl-PL", dir: "ltr" },
  tr: { name: "Turkish", nativeName: "Türkçe", locale: "tr-TR", dir: "ltr" },
  ja: { name: "Japanese", nativeName: "日本語", locale: "ja-JP", dir: "ltr" },
  ko: { name: "Korean", nativeName: "한국어", locale: "ko-KR", dir: "ltr" },
  zh: { name: "Chinese", nativeName: "中文", locale: "zh-CN", dir: "ltr" },
  ar: { name: "Arabic", nativeName: "العربية", locale: "ar", dir: "rtl" },
  he: { name: "Hebrew", nativeName: "עברית", locale: "he", dir: "rtl" },
  fa: { name: "Persian", nativeName: "فارسی", locale: "fa", dir: "rtl" },
  ur: { name: "Urdu", nativeName: "اردو", locale: "ur", dir: "rtl" },
  ru: { name: "Russian", nativeName: "Русский", locale: "ru-RU", dir: "ltr" },
  uk: { name: "Ukrainian", nativeName: "Українська", locale: "uk-UA", dir: "ltr" },
  vi: { name: "Vietnamese", nativeName: "Tiếng Việt", locale: "vi-VN", dir: "ltr" },
  th: { name: "Thai", nativeName: "ไทย", locale: "th-TH", dir: "ltr" },
  id: { name: "Indonesian", nativeName: "Bahasa Indonesia", locale: "id-ID", dir: "ltr" },
  ms: { name: "Malay", nativeName: "Bahasa Melayu", locale: "ms-MY", dir: "ltr" },
  fil: { name: "Filipino", nativeName: "Filipino", locale: "fil-PH", dir: "ltr" }
};

/**
 * Languages with complete, verified production UI translation dictionaries.
 * Only languages in this array can be automatically selected or shown in UI.
 */
export const SUPPORTED_UI_LANGUAGES = [
  "en",
  "zh-CN",
  "hi-IN",
  "fr-FR",
  "de-DE",
  "es-ES",
  "ja-JP",
  "ar"
];

/**
 * Mapping of language aliases and regional variants to verified supported UI dictionaries.
 */
export const LANGUAGE_ALIASES = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  "en-ca": "en",
  "en-au": "en",
  "en-nz": "en",
  "en-in": "en",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  hi: "hi-IN",
  "hi-in": "hi-IN",
  fr: "fr-FR",
  "fr-fr": "fr-FR",
  "fr-ca": "fr-FR",
  "fr-be": "fr-FR",
  "fr-ch": "fr-FR",
  de: "de-DE",
  "de-de": "de-DE",
  "de-at": "de-DE",
  "de-ch": "de-DE",
  es: "es-ES",
  "es-es": "es-ES",
  "es-mx": "es-ES",
  "es-419": "es-ES",
  "es-ar": "es-ES",
  "es-co": "es-ES",
  "es-cl": "es-ES",
  "es-pe": "es-ES",
  "es-us": "es-ES",
  ja: "ja-JP",
  "ja-jp": "ja-JP",
  ar: "ar",
  "ar-sa": "ar",
  "ar-eg": "ar",
  "ar-ae": "ar",
  "ar-ma": "ar",
  "ar-kw": "ar",
  "ar-qa": "ar",
};

/**
 * Safely parse a BCP 47 language tag into language, region, and script components.
 */
export function parseLanguageTag(tag) {
  if (!tag || typeof tag !== "string") return null;
  const clean = tag.trim();
  if (!clean) return null;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Locale === "function") {
      const loc = new Intl.Locale(clean);
      return {
        tag: clean,
        language: (loc.language || "").toLowerCase(),
        region: (loc.region || "").toUpperCase(),
        script: loc.script || "",
      };
    }
  } catch {
    // Graceful fallback to regex parsing
  }
  const match = clean.match(/^([a-zA-Z]{2,3})(?:-([a-zA-Z]{4}))?(?:-([a-zA-Z]{2}|\d{3}))?/);
  if (!match) return { tag: clean, language: clean.toLowerCase(), region: "", script: "" };
  return {
    tag: clean,
    language: (match[1] || "").toLowerCase(),
    script: match[2] || "",
    region: (match[3] || "").toUpperCase(),
  };
}

/**
 * Deterministic language detection prioritizing:
 * 1. Explicit user choice (saved preference)
 * 2. Exact match in browser language preferences (navigator.languages)
 * 3. Language-only / regional fallback (e.g., fr-CA -> fr-FR, es-MX -> es-ES)
 * 4. Safe universal fallback (English: "en")
 *
 * Traditional Chinese (zh-TW, zh-HK) is never erroneously mapped to simplified Chinese (zh-CN).
 */
export function detectPreferredLanguage({
  savedLanguage,
  languages,
  supportedLanguages = SUPPORTED_UI_LANGUAGES,
} = {}) {
  // PRIORITY 1: Explicit user choice
  if (savedLanguage && typeof savedLanguage === "string" && savedLanguage !== "auto") {
    const norm = savedLanguage.trim();
    if (supportedLanguages.includes(norm)) return norm;
    const lower = norm.toLowerCase();
    if (LANGUAGE_ALIASES[lower] && supportedLanguages.includes(LANGUAGE_ALIASES[lower])) {
      return LANGUAGE_ALIASES[lower];
    }
  }

  // PRIORITY 2 & 3: Browser Language Preferences
  let list = [];
  if (Array.isArray(languages)) {
    list = languages;
  } else if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      list = navigator.languages;
    } else if (navigator.language) {
      list = [navigator.language];
    }
  }

  for (const rawTag of list) {
    if (!rawTag || typeof rawTag !== "string") continue;
    const parsed = parseLanguageTag(rawTag);
    if (!parsed) continue;

    const lowerTag = parsed.tag.toLowerCase();

    // Traditional Chinese guard: zh-TW, zh-HK, zh-Hant must not be confused with simplified zh-CN
    if (parsed.language === "zh") {
      const isTraditional = parsed.region === "TW" || parsed.region === "HK" || parsed.region === "MO" || parsed.script.toLowerCase() === "hant";
      if (isTraditional) {
        if (supportedLanguages.includes("zh-TW")) return "zh-TW";
        continue;
      }
    }

    // Exact supported match
    for (const sup of supportedLanguages) {
      if (sup.toLowerCase() === lowerTag) return sup;
    }

    // Alias mapping
    if (LANGUAGE_ALIASES[lowerTag] && supportedLanguages.includes(LANGUAGE_ALIASES[lowerTag])) {
      return LANGUAGE_ALIASES[lowerTag];
    }

    // Language-only fallback
    const langOnly = parsed.language;
    if (LANGUAGE_ALIASES[langOnly] && supportedLanguages.includes(LANGUAGE_ALIASES[langOnly])) {
      return LANGUAGE_ALIASES[langOnly];
    }
    for (const sup of supportedLanguages) {
      const supParsed = parseLanguageTag(sup);
      if (supParsed && supParsed.language === langOnly) {
        return sup;
      }
    }
  }

  // PRIORITY 4: Universal fallback
  return "en";
}

/**
 * Returns true if a language code or alias is supported by the UI.
 */
export function isLanguageSupported(code, supportedLanguages = SUPPORTED_UI_LANGUAGES) {
  if (!code || typeof code !== "string") return false;
  if (supportedLanguages.includes(code)) return true;
  const lower = code.trim().toLowerCase();
  return Boolean(LANGUAGE_ALIASES[lower] && supportedLanguages.includes(LANGUAGE_ALIASES[lower]));
}

/**
 * Return text direction: "rtl" for Arabic, Hebrew, Persian, Urdu; otherwise "ltr".
 */
export function getLanguageDirection(code) {
  const parsed = parseLanguageTag(code);
  const lang = parsed ? parsed.language : (code || "").toLowerCase();
  const rtlLanguages = ["ar", "he", "fa", "ur"];
  return rtlLanguages.includes(lang) ? "rtl" : "ltr";
}

/**
 * Returns BCP 47 locale for Intl operations.
 */
export function getLanguageLocale(code) {
  const map = {
    en: "en",
    "zh-CN": "zh-CN",
    "hi-IN": "hi-IN",
    "fr-FR": "fr-FR",
    "de-DE": "de-DE",
    "es-ES": "es-ES",
    "ja-JP": "ja-JP",
    ar: "ar",
  };
  return map[code] || "en";
}

/**
 * Formats a numeric value using Intl.NumberFormat without mutating raw data.
 */
export function formatNumber(value, locale = "en", options = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  try {
    return new Intl.NumberFormat(locale, options).format(num);
  } catch {
    return String(num);
  }
}

/**
 * Formats currency without altering financial calculations.
 */
export function formatCurrency(minorUnits, country, { currency = country.currency, locale = country.locale } = {}) {
  const value = (Number(minorUnits) || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${country.symbol || ""}${value.toFixed(currency === "JPY" ? 0 : 2)}`;
  }
}

/**
 * Formats dates using Intl.DateTimeFormat.
 */
export function formatDate(date, locale = "en", options = {}) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    return d.toISOString().split("T")[0];
  }
}

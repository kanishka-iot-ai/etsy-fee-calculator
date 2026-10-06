/**
 * ShopProfit — Legacy Calculator Comparison Fixtures
 *
 * Deterministic test fixtures capturing the exact calculation results
 * of the legacy calculator engine (src/calculator.js + src/countries.js)
 * across all 12 baseline markets.
 *
 * SAFETY INVARIANT: These expected numbers MUST NOT be altered.
 * Any future calculator migration or refactoring must prove 100% parity
 * against these baseline fixtures.
 */

export const LEGACY_CALCULATOR_CASES = {
  US: {
    countryCode: "US",
    inputs: {
      itemPrice: 50,
      shipping: 10,
      production: 15,
      packaging: 2,
      offsiteRate: 0,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 6000,
      listingCents: 20,
      transactionCents: 390,
      processingCents: 205,
      regulatoryCents: 0,
      offsiteCents: 0,
      productionCents: 1500,
      packagingCents: 200,
      plusCents: 0,
      feesCents: 615,
      costsCents: 1700,
      netCents: 3685,
      margin: 0.6141666666666666,
      breakEvenCents: 928,
      platformRate: 0.1025,
      costsRate: 0.2833333333333333,
      keptPer100Cents: 6142
    }
  },

  UK: {
    countryCode: "UK",
    inputs: {
      itemPrice: 40,
      shipping: 5,
      production: 10,
      packaging: 1.5,
      offsiteRate: 0.15,
      plus: true,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 4500,
      listingCents: 16,
      transactionCents: 293,
      processingCents: 200,
      regulatoryCents: 22,
      offsiteCents: 675,
      productionCents: 1000,
      packagingCents: 150,
      plusCents: 27,
      feesCents: 1206,
      costsCents: 1177,
      netCents: 2117,
      margin: 0.47044444444444444,
      breakEvenCents: 1140,
      platformRate: 0.268,
      costsRate: 0.26155555555555554,
      keptPer100Cents: 4704
    }
  },

  CA: {
    countryCode: "CA",
    inputs: {
      itemPrice: 60,
      shipping: 12,
      production: 20,
      packaging: 3,
      offsiteRate: 0.12,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 7200,
      listingCents: 27,
      transactionCents: 468,
      processingCents: 241,
      regulatoryCents: 36,
      offsiteCents: 864,
      productionCents: 2000,
      packagingCents: 300,
      plusCents: 0,
      feesCents: 1636,
      costsCents: 2300,
      netCents: 3264,
      margin: 0.4533333333333333,
      breakEvenCents: 1815,
      platformRate: 0.22722222222222221,
      costsRate: 0.3194444444444444,
      keptPer100Cents: 4533
    }
  },

  AU: {
    countryCode: "AU",
    inputs: {
      itemPrice: 75,
      shipping: 15,
      production: 25,
      packaging: 4,
      offsiteRate: 0,
      plus: true,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 9000,
      listingCents: 28,
      transactionCents: 585,
      processingCents: 295,
      regulatoryCents: 0,
      offsiteCents: 0,
      productionCents: 2500,
      packagingCents: 400,
      plusCents: 50,
      feesCents: 908,
      costsCents: 2950,
      netCents: 5142,
      margin: 0.5713333333333334,
      breakEvenCents: 1819,
      platformRate: 0.10088888888888889,
      costsRate: 0.3277777777777778,
      keptPer100Cents: 5713
    }
  },

  DE: {
    countryCode: "DE",
    inputs: {
      itemPrice: 45,
      shipping: 8,
      production: 12,
      packaging: 2,
      offsiteRate: 0.15,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 5300,
      listingCents: 18,
      transactionCents: 345,
      processingCents: 242,
      regulatoryCents: 0,
      offsiteCents: 795,
      productionCents: 1200,
      packagingCents: 200,
      plusCents: 0,
      feesCents: 1400,
      costsCents: 1400,
      netCents: 2500,
      margin: 0.4716981132075472,
      breakEvenCents: 1143,
      platformRate: 0.2641509433962264,
      costsRate: 0.2641509433962264,
      keptPer100Cents: 4717
    }
  },

  FR: {
    countryCode: "FR",
    inputs: {
      itemPrice: 55,
      shipping: 10,
      production: 18,
      packaging: 2.5,
      offsiteRate: 0,
      plus: true,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 6500,
      listingCents: 18,
      transactionCents: 423,
      processingCents: 290,
      regulatoryCents: 74,
      offsiteCents: 0,
      productionCents: 1800,
      packagingCents: 250,
      plusCents: 32,
      feesCents: 805,
      costsCents: 2082,
      netCents: 3613,
      margin: 0.5558461538461539,
      breakEvenCents: 1410,
      platformRate: 0.12384615384615384,
      costsRate: 0.3203076923076923,
      keptPer100Cents: 5558
    }
  },

  IT: {
    countryCode: "IT",
    inputs: {
      itemPrice: 35,
      shipping: 7,
      production: 10,
      packaging: 1,
      offsiteRate: 0.12,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 4200,
      listingCents: 18,
      transactionCents: 273,
      processingCents: 198,
      regulatoryCents: 34,
      offsiteCents: 504,
      productionCents: 1000,
      packagingCents: 100,
      plusCents: 0,
      feesCents: 1027,
      costsCents: 1100,
      netCents: 2073,
      margin: 0.49357142857142855,
      breakEvenCents: 797,
      platformRate: 0.24452380952380953,
      costsRate: 0.2619047619047619,
      keptPer100Cents: 4936
    }
  },

  ES: {
    countryCode: "ES",
    inputs: {
      itemPrice: 30,
      shipping: 6,
      production: 8,
      packaging: 1.2,
      offsiteRate: 0,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 3600,
      listingCents: 18,
      transactionCents: 234,
      processingCents: 174,
      regulatoryCents: 32,
      offsiteCents: 0,
      productionCents: 800,
      packagingCents: 120,
      plusCents: 0,
      feesCents: 458,
      costsCents: 920,
      netCents: 2222,
      margin: 0.6172222222222222,
      breakEvenCents: 493,
      platformRate: 0.1272222222222222,
      costsRate: 0.25555555555555554,
      keptPer100Cents: 6172
    }
  },

  IN: {
    countryCode: "IN",
    inputs: {
      itemPrice: 1500,
      shipping: 200,
      production: 500,
      packaging: 50,
      offsiteRate: 0.15,
      plus: true,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 170000,
      listingCents: 1650,
      transactionCents: 11050,
      processingCents: 11000,
      regulatoryCents: 85,
      offsiteCents: 25500,
      productionCents: 50000,
      packagingCents: 5000,
      plusCents: 2767,
      feesCents: 49285,
      costsCents: 57767,
      netCents: 62948,
      margin: 0.37028235294117645,
      breakEvenCents: 64298,
      platformRate: 0.28991176470588237,
      costsRate: 0.3398058823529412,
      keptPer100Cents: 3703
    }
  },

  JP: {
    countryCode: "JP",
    inputs: {
      itemPrice: 5000,
      shipping: 800,
      production: 1500,
      packaging: 200,
      offsiteRate: 0,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 580000,
      listingCents: 3000,
      transactionCents: 37700,
      processingCents: 39300,
      regulatoryCents: 0,
      offsiteCents: 0,
      productionCents: 150000,
      packagingCents: 20000,
      plusCents: 0,
      feesCents: 80000,
      costsCents: 170000,
      netCents: 330000,
      margin: 0.5689655172413793,
      breakEvenCents: 122857,
      platformRate: 0.13793103448275862,
      costsRate: 0.29310344827586204,
      keptPer100Cents: 5690
    }
  },

  TR: {
    countryCode: "TR",
    inputs: {
      itemPrice: 800,
      shipping: 150,
      production: 250,
      packaging: 30,
      offsiteRate: 0.12,
      plus: true,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 95000,
      listingCents: 700,
      transactionCents: 6175,
      processingCents: 7575,
      regulatoryCents: 1587,
      offsiteCents: 11400,
      productionCents: 25000,
      packagingCents: 3000,
      plusCents: 1133,
      feesCents: 27437,
      costsCents: 29133,
      netCents: 38430,
      margin: 0.4045263157894737,
      breakEvenCents: 27591,
      platformRate: 0.28881052631578946,
      costsRate: 0.30666315789473686,
      keptPer100Cents: 4045
    }
  },

  OTHER: {
    countryCode: "OTHER",
    inputs: {
      itemPrice: 100,
      shipping: 20,
      production: 30,
      packaging: 5,
      offsiteRate: 0.15,
      plus: false,
      salesPerMonth: 30,
      tax: 0
    },
    expected: {
      grossCents: 12000,
      listingCents: 20,
      transactionCents: 780,
      processingCents: 810,
      regulatoryCents: 0,
      offsiteCents: 1800,
      productionCents: 3000,
      packagingCents: 500,
      plusCents: 0,
      feesCents: 3410,
      costsCents: 3500,
      netCents: 5090,
      margin: 0.4241666666666667,
      breakEvenCents: 2932,
      platformRate: 0.2841666666666667,
      costsRate: 0.2916666666666667,
      keptPer100Cents: 4242
    }
  }
};

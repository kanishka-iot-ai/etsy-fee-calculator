/**
 * ShopProfit Country & Timezone Utilities
 *
 * NOTE: The obsolete static fee database has been permanently removed.
 * Authoritative global fee intelligence is provided dynamically by the
 * v1.1.1 API through src/fee-intelligence-client.js, src/compatibility.js,
 * and src/fee-engine.js.
 */

import { countryFromTimeZone } from "./fee-engine.js";

export const COUNTRY_ORDER = Object.freeze([
  "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"
]);

export { countryFromTimeZone };

export const PROVIDER_EVENT_PRICE_DISCLOSURE = "Event summary, not an individual offer. Fee basis may vary; verify checkout total and availability with the provider.";

const CURRENCIES = new Set(["USD", "CAD"]);
const PRICE_BASES = new Set(["unknown", "base", "all-in"]);
const MAX_PRICE_CENTS = 100_000_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const nullableCents = (value, field) => {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_CENTS) throw new TypeError(`${field} must be bounded non-negative integer cents or null.`);
  return value;
};

export function validateProviderEventPrice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Provider event price must be an object.");
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(value.provider)) throw new TypeError("Invalid provider event price provider.");
  if (typeof value.marketType !== "string" || !value.marketType.trim() || value.marketType.length > 80) throw new TypeError("Invalid provider event price market type.");
  const min = nullableCents(value.minCents, "minCents");
  const max = nullableCents(value.maxCents, "maxCents");
  if (min !== null && max !== null && min > max) throw new TypeError("Provider event price minimum exceeds maximum.");
  if (!CURRENCIES.has(value.currency)) throw new TypeError("Unsupported provider event price currency.");
  if (!PRICE_BASES.has(value.priceBasis)) throw new TypeError("Invalid provider event price basis.");
  if (typeof value.capturedAt !== "string" || !ISO.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt))) throw new TypeError("Invalid provider event price timestamp.");
  if (typeof value.sourceIdentifier !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.sourceIdentifier)) throw new TypeError("Invalid provider event price source identifier.");
  if (typeof value.maxIsCapped !== "boolean" || (max === null && value.maxIsCapped)) throw new TypeError("Invalid provider event price cap state.");
  return value;
}

function dollarsToCents(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE_CENTS / 100) throw new TypeError("Invalid provider event price amount.");
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - value) > 1e-9) throw new TypeError("Provider event price cannot be safely converted to cents.");
  return cents;
}

export function providerEventPricesFromRanges(ranges, { provider, sourceIdentifier, capturedAt, priceBasis = "unknown" }) {
  if (!Array.isArray(ranges)) return [];
  const prices = [];
  for (const range of ranges) {
    try {
      const price = {
        provider,
        marketType: String(range?.marketType ?? range?.type ?? "unknown").trim(),
        minCents: dollarsToCents(range?.min ?? null),
        maxCents: dollarsToCents(range?.max ?? null),
        currency: String(range?.currency ?? "").toUpperCase(),
        priceBasis,
        capturedAt,
        sourceIdentifier,
        maxIsCapped: range?.maxIsCapped === true,
      };
      validateProviderEventPrice(price);
      prices.push(price);
    } catch { /* A malformed range does not invalidate its event summary. */ }
  }
  return prices;
}

export function providerEventPriceCopy(price, locale = "en-US") {
  validateProviderEventPrice(price);
  const format = (cents) => new Intl.NumberFormat(locale, { style: "currency", currency: price.currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  if (price.minCents !== null && price.maxCents !== null) return `Ticketmaster-reported event range: ${format(price.minCents)}–${format(price.maxCents)}`;
  if (price.minCents !== null) return `From ${format(price.minCents)}`;
  if (price.maxCents !== null) return `Up to ${format(price.maxCents)}`;
  return "Price range not supplied";
}

export { MAX_PRICE_CENTS };

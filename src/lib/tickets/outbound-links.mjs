const PROVIDER_HOSTS = Object.freeze({
  ticketmaster: ["www.ticketmaster.com", "ticketmaster.com"],
  "fictional-box-office": ["fictional-box-office.example.invalid"],
  "fictional-verified": ["fictional-verified.example.invalid"],
  "fictional-market-a": ["fictional-market-a.example.invalid"],
  "fictional-market-b": ["fictional-market-b.example.invalid"],
  "fictional-summary": ["fictional-summary.example.invalid"],
  "fictional-links": ["fictional-links.example.invalid"],
  "fictional-stale": ["fictional-stale.example.invalid"],
  "fictional-outage": ["fictional-outage.example.invalid"],
});

const SECRET_QUERY_NAME = /(?:^|[_-])(?:access[_-]?token|api[_-]?key|secret|signature|authorization|auth)(?:$|[_-])/i;

export function safeProviderUrl(provider, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const hosts = PROVIDER_HOSTS[provider] ?? [];
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !hosts.includes(parsed.hostname.toLowerCase())) return null;
  if ([...parsed.searchParams.keys()].some((key) => SECRET_QUERY_NAME.test(key))) return null;
  return parsed.toString();
}

export function providerOutboundLink(provider, canonicalUrl, affiliateUrl) {
  const affiliate = safeProviderUrl(provider, affiliateUrl);
  if (affiliate) return { href: affiliate, rel: "sponsored nofollow noopener", affiliate: true };
  const canonical = safeProviderUrl(provider, canonicalUrl);
  return canonical ? { href: canonical, rel: "nofollow noopener", affiliate: false } : null;
}

export const providerHostAllowlist = PROVIDER_HOSTS;

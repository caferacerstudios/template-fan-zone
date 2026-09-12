// scripts/fetch-ebay.mjs
/**
 * Fetch public eBay listings for a seller using the Browse API (static-site friendly).
 *
 * Env vars:
 *   EBAY_CLIENT_ID        (App ID / Client ID)  [or use EBAY_APP_ID]
 *   EBAY_CLIENT_SECRET    (Cert ID / Client Secret)
 *   EBAY_SELLER           (seller username, e.g. lawhi-46)
 *   EBAY_MARKETPLACE_ID   (optional, default EBAY_US)
 *   EBAY_LIMIT            (optional, default 50)
 *   EBAY_QUERY            (optional, default "video game")
 *
 * Output:
 *   src/data/ebay.json  -> { seller, marketplace, fetchedAt, query, items:[{title,href,img,price}] }
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_SELLER = process.env.EBAY_SELLER;

const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
const EBAY_LIMIT = Number(process.env.EBAY_LIMIT || 50);
const EBAY_QUERY = (process.env.EBAY_QUERY || "video game").trim();

if (!EBAY_CLIENT_ID) throw new Error("Missing EBAY_CLIENT_ID (or EBAY_APP_ID).");
if (!EBAY_CLIENT_SECRET) throw new Error("Missing EBAY_CLIENT_SECRET (Cert ID / Client Secret).");
if (!EBAY_SELLER) throw new Error("Missing EBAY_SELLER.");

function b64(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

async function getAppAccessToken() {
  const tokenUrl = "https://api.ebay.com/identity/v1/oauth2/token";

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${b64(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`)}`,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const json = JSON.parse(text);
  if (!json.access_token) {
    throw new Error(`Token response missing access_token: ${text}`);
  }

  return json.access_token;
}

async function fetchSellerListings(accessToken) {
  const endpoint = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");

  // REQUIRED by Browse API:
  endpoint.searchParams.set("q", EBAY_QUERY);

  // Seller filter:
  endpoint.searchParams.set("filter", `sellers:{${EBAY_SELLER}}`);

  // Optional:
  endpoint.searchParams.set("limit", String(EBAY_LIMIT));

  const res = await fetch(endpoint.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Browse search failed (${res.status}): ${text}`);
  }

  const json = JSON.parse(text);

  const items = (json.itemSummaries || []).map((it) => {
    const priceVal = it?.price?.value;
    const priceCur = it?.price?.currency;
    const price =
      priceVal && priceCur ? `${priceVal} ${priceCur}` : priceVal ? String(priceVal) : "";

    return {
      title: it?.title || "",
      href: it?.itemWebUrl || "",
      img: it?.image?.imageUrl || "",
      price,
    };
  });

  return items;
}

async function main() {
  const token = await getAppAccessToken();
  const items = await fetchSellerListings(token);

  const out = {
    seller: EBAY_SELLER,
    marketplace: EBAY_MARKETPLACE_ID,
    fetchedAt: new Date().toISOString(),
    query: EBAY_QUERY,
    items,
  };

  const outPath = path.join(process.cwd(), "src", "data", "ebay.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log(`Wrote ${items.length} items -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

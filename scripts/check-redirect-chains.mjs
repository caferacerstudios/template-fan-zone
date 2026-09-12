import http from "node:http";
import { pathToFileURL } from "node:url";

export const CANONICAL_ORIGIN = "https://{team}fanzone.com";
export const MAX_REDIRECTS = 8;
export const REPRESENTATIVE_PATHS = [
  "/",
  "/news",
  "/schedule",
  "/players",
  "/tickets",
  "/games/1392216",
];

export function redirectCases(paths = REPRESENTATIVE_PATHS) {
  return paths.flatMap((path) => {
    const slashPath = path === "/" ? "/" : `${path}/`;
    return [
      [`http apex ${path}`, `http://{team}fanzone.com${path}`],
      [`https apex ${path}`, `https://{team}fanzone.com${path}`],
      [`http www ${path}`, `http://www.{team}fanzone.com${path}`],
      [`https www ${path}`, `https://www.{team}fanzone.com${path}`],
      [`trailing slash ${path}`, `https://{team}fanzone.com${slashPath}`],
      [`non-trailing slash ${path}`, `https://{team}fanzone.com${path}`],
      [`query string ${path}`, `https://{team}fanzone.com${slashPath}?redirect_check=one%2Ftwo&repeat=a&repeat=b`],
    ];
  });
}

export async function followRedirectChain(initialUrl, request, maxRedirects = MAX_REDIRECTS) {
  const visited = new Set();
  const transitions = new Set();
  const chain = [];
  let current = new URL(initialUrl);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const href = current.href;
    if (visited.has(href)) throw new Error(`repeated URL: ${href}`);
    visited.add(href);

    const response = await request(current);
    chain.push({ url: href, status: response.status, location: response.location ?? null });
    if (response.status < 300 || response.status >= 400) return chain;
    if (!response.location) throw new Error(`redirect ${response.status} from ${href} has no Location`);
    if (redirects === maxRedirects) throw new Error(`more than ${maxRedirects} redirects from ${initialUrl}`);
    const next = new URL(response.location, current);
    const sameResource = current.protocol === next.protocol
      && current.host === next.host
      && current.search === next.search
      && current.pathname.replace(/\/$/, "") === next.pathname.replace(/\/$/, "")
      && current.pathname !== next.pathname;
    if (sameResource && transitions.has(`${next.href} -> ${current.href}`)) {
      throw new Error(`slash/no-slash cycle: ${next.href} -> ${current.href} -> ${next.href}`);
    }
    transitions.add(`${current.href} -> ${next.href}`);
    current = next;
  }

  throw new Error(`more than ${maxRedirects} redirects from ${initialUrl}`);
}

export function assertCanonicalResult(initialUrl, chain) {
  const final = chain.at(-1);
  if (final.status !== 200) throw new Error(`final status is ${final.status}, expected 200`);
  const finalUrl = new URL(final.url);
  if (finalUrl.protocol !== "https:") throw new Error(`final scheme is ${finalUrl.protocol}, expected https:`);
  if (finalUrl.host !== "{team}fanzone.com") throw new Error(`final host is ${finalUrl.host}`);
  if (finalUrl.pathname !== "/" && finalUrl.pathname.endsWith("/")) {
    throw new Error(`final path has a trailing slash: ${finalUrl.pathname}`);
  }
  const initial = new URL(initialUrl);
  const expectedPath = initial.pathname === "/" ? "/" : initial.pathname.replace(/\/$/, "");
  if (finalUrl.pathname !== expectedPath) {
    throw new Error(`final path is ${finalUrl.pathname}, expected ${expectedPath}`);
  }
  if (finalUrl.search !== initial.search) {
    throw new Error(`query changed from ${initial.search || "(empty)"} to ${finalUrl.search || "(empty)"}`);
  }
  if (initial.href === finalUrl.href && chain.length !== 1) {
    throw new Error(`canonical URL redirected instead of returning 200: ${initial.href}`);
  }
}

export function localNginxRequest(connectOrigin) {
  const connection = new URL(connectOrigin);
  return (logicalUrl) => new Promise((resolve, reject) => {
    const request = http.request({
      hostname: connection.hostname,
      port: connection.port || 80,
      method: "GET",
      path: `${logicalUrl.pathname}${logicalUrl.search}`,
      headers: {
        Host: logicalUrl.host,
        "X-Forwarded-Proto": logicalUrl.protocol.slice(0, -1),
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({
        status: response.statusCode,
        location: response.headers.location,
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function main() {
  const connectOrigin = process.argv[2] ?? "http://127.0.0.1:4322";
  const request = localNginxRequest(connectOrigin);
  for (const [name, initialUrl] of redirectCases()) {
    const chain = await followRedirectChain(initialUrl, request);
    assertCanonicalResult(initialUrl, chain);
    console.log(`${name}: ${chain.map(({ url, status }) => `${url} [${status}]`).join(" -> ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Redirect check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

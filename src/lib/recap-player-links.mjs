import { buildPlayerRouteRegistry } from "./indexability.mjs";

const literalPlayerToken = /\{[^{}]*\bt\s*:\s*(['"])player\1[^{}]*\}/gi;
const normalizedName = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function quotedField(token, field) {
  const match = token.match(new RegExp(`\\b${field}\\s*:\\s*(?:'((?:\\\\.|[^'])*)'|"((?:\\\\.|[^"])*)")`, "i"));
  return (match?.[1] ?? match?.[2] ?? "").replace(/\\(['"\\])/g, "$1");
}

function literalSegment(token) {
  const name = quotedField(token, "name") || quotedField(token, "v");
  if (!name) return null;
  const id = token.match(/\bid\s*:\s*(['"])?([^,'"}\s]+)\1(?=\s*[,}])/i)?.[2] ?? null;
  return { t:"player", v:name, id, name };
}

export function playerRouteRegistry(records = []) {
  return buildPlayerRouteRegistry(records);
}

export function playerProfileHref(segment, registry) {
  if (!segment || segment.t !== "player") return null;
  const id = String(segment.id ?? "");
  const direct = registry?.routes?.get(id);
  if (direct) return `/players/${encodeURIComponent(direct.canonicalId)}`;
  const name = normalizedName(segment.name ?? segment.v);
  if (!name) return null;
  const route = [...(registry?.routes?.values?.() ?? [])].find((entry) => !entry.alias && normalizedName(entry.name) === name);
  return route ? `/players/${encodeURIComponent(route.canonicalId)}` : null;
}

export function recapRenderParts(value, registry) {
  const segments = Array.isArray(value) ? value : [value];
  return segments.flatMap((segment) => {
    if (segment && typeof segment === "object" && segment.t === "player") {
      const text = String(segment.name ?? segment.v ?? "");
      return text ? [{ text, href:playerProfileHref(segment, registry) }] : [];
    }
    const text = typeof segment === "string" ? segment : String(segment?.v ?? segment?.text ?? "");
    const parts = [];
    let start = 0;
    for (const match of text.matchAll(literalPlayerToken)) {
      if (match.index > start) parts.push({ text:text.slice(start, match.index), href:null });
      const player = literalSegment(match[0]);
      parts.push(player
        ? { text:player.name, href:playerProfileHref(player, registry) }
        : { text:match[0], href:null });
      start = match.index + match[0].length;
    }
    if (start < text.length) parts.push({ text:text.slice(start), href:null });
    return parts;
  });
}

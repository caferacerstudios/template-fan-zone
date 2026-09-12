const SEA = "SEA";
const HOUR = 3_600_000;

const TEAM_ALIASES = new Map(Object.entries({
  SEA: ["sea", "seattle", "seattle {team}", "{team}"],
  ARI: ["ari", "az", "arizona", "arizona cardinals", "cardinals"],
  ATL: ["atl", "atlanta", "atlanta falcons", "falcons"],
  BAL: ["bal", "baltimore", "baltimore ravens", "ravens"],
  BUF: ["buf", "buffalo", "buffalo bills", "bills"],
  CAR: ["car", "carolina", "carolina panthers", "panthers"],
  CHI: ["chi", "chicago", "chicago bears", "bears"],
  CIN: ["cin", "cincinnati", "cincinnati bengals", "bengals"],
  CLE: ["cle", "cleveland", "cleveland browns", "browns"],
  DAL: ["dal", "dallas", "dallas cowboys", "cowboys"],
  DEN: ["den", "denver", "denver broncos", "broncos"],
  DET: ["det", "detroit", "detroit lions", "lions"],
  GB: ["gb", "gnb", "green bay", "green bay packers", "packers"],
  HOU: ["hou", "houston", "houston texans", "texans"],
  IND: ["ind", "indianapolis", "indianapolis colts", "colts"],
  JAX: ["jax", "jac", "jacksonville", "jacksonville jaguars", "jaguars"],
  KC: ["kc", "kan", "kansas city", "kansas city chiefs", "chiefs"],
  LV: ["lv", "lvr", "las vegas", "las vegas raiders", "raiders"],
  LAC: ["lac", "los angeles chargers", "la chargers", "chargers"],
  LAR: ["lar", "la", "los angeles rams", "la rams", "rams"],
  MIA: ["mia", "miami", "miami dolphins", "dolphins"],
  MIN: ["min", "minnesota", "minnesota vikings", "vikings"],
  NE: ["ne", "nwe", "new england", "new england patriots", "patriots"],
  NO: ["no", "nor", "new orleans", "new orleans saints", "saints"],
  NYG: ["nyg", "new york giants", "ny giants", "giants"],
  NYJ: ["nyj", "new york jets", "ny jets", "jets"],
  PHI: ["phi", "philadelphia", "philadelphia eagles", "eagles"],
  PIT: ["pit", "pittsburgh", "pittsburgh steelers", "steelers"],
  SF: ["sf", "sfo", "san francisco", "san francisco 49ers", "49ers", "niners"],
  TB: ["tb", "tampa bay", "tampa bay buccaneers", "buccaneers", "bucs"],
  TEN: ["ten", "tennessee", "tennessee titans", "titans"],
  WAS: ["was", "wsh", "washington", "washington commanders", "commanders"],
}).flatMap(([abbr, aliases]) => aliases.map((alias) => [alias, abbr])));

const clean = (value) => String(value ?? "").normalize("NFKD").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
const teamValue = (team) => team?.abbreviation ?? team?.abbr ?? team?.name ?? team?.full_name ?? team?.fullName ?? team;

export function normalizeNflTeam(value) {
  const normalized = clean(teamValue(value));
  return TEAM_ALIASES.get(normalized) ?? null;
}

export function sfzEventKey(game) {
  const id = String(game?.game_id ?? game?.id ?? "").trim();
  if (!id) throw new TypeError("A stable schedule game.id or game_id is required.");
  const synthesized = `${game?.season}-${game?.phase}-${game?.week ?? "tbd"}-${game?.state}`;
  if (game?.game_id == null && id === synthesized) throw new TypeError("A synthesized schedule display ID cannot be used as a stable event key.");
  if (game?.state === "bye" || game?.bye === true) throw new TypeError("A bye is not a ticket event.");
  return `sea:${id}`;
}

function gameTeams(game) {
  const home = normalizeNflTeam(game?.homeTeam ?? game?.home_team);
  const away = normalizeNflTeam(game?.awayTeam ?? game?.away_team ?? game?.visitor_team);
  return { home, away, opponent: home === SEA ? away : away === SEA ? home : normalizeNflTeam(game?.opponent) };
}

function providerTeams(event, attractionIds) {
  let home = normalizeNflTeam(event?.homeTeam);
  let away = normalizeNflTeam(event?.awayTeam);
  const teams = (event?.teams ?? event?.attractions ?? []).map((entry) => {
    const id = String(entry?.id ?? entry?.attractionId ?? "");
    return attractionIds[id] ?? normalizeNflTeam(entry);
  }).filter(Boolean);
  if (!home && event?.homeTeamId != null) home = attractionIds[String(event.homeTeamId)] ?? null;
  if (!away && event?.awayTeamId != null) away = attractionIds[String(event.awayTeamId)] ?? null;
  if (!home || !away) {
    // Discovery attractions identify the participants but do not identify their
    // sides. Ticketmaster NFL titles consistently present HOME vs. AWAY, so use
    // only an explicit separator and exact NFL aliases to recover that order.
    const title = String(event?.name ?? event?.title ?? "").normalize("NFKD");
    const parts = title.split(/\s+(?:vs?\.?|versus)\s+/i);
    if (parts.length === 2) {
      const titleHome = normalizeNflTeam(parts[0]);
      const titleAway = normalizeNflTeam(parts[1]);
      if (titleHome && titleAway && titleHome !== titleAway) {
        home ??= titleHome;
        away ??= titleAway;
      }
    }
  }
  return { home, away, teams: new Set([home, away, ...teams].filter(Boolean)) };
}

function eventText(event) {
  return clean([event?.name, event?.title, event?.eventType, event?.type, event?.category, event?.classification].filter(Boolean).join(" "));
}

function rejectionReasons(game, event, attractionIds) {
  const text = eventText(event);
  const reasons = [];
  const type = clean(event?.eventType ?? event?.type ?? event?.category);
  if (/\bparking\b|parking only/.test(text)) reasons.push("parking-event");
  if (/\btailgate\b/.test(text)) reasons.push("tailgate-package");
  if (/\bhalf price\b/.test(text)) reasons.push("promotional-event-shell");
  if (/hotel package|travel package/.test(text)) reasons.push("travel-package");
  if (/season ticket.*(?:notification|interest|wait|list)|(?:notification|interest|wait) list/.test(text)) reasons.push("season-ticket-interest-list");
  if (/\bdeposit\b/.test(text)) reasons.push("deposit-product");
  if (/\bhospitality\b|vip experience|club access only/.test(text)) reasons.push("hospitality-only");
  if (/watch party|viewing party/.test(text)) reasons.push("watch-party");
  if (event?.speculative === true || event?.placeholder === true || event?.eventStatus === "speculative") reasons.push("speculative-shell");
  if (event?.duplicateOf || event?.isDuplicate === true) reasons.push("duplicate-shell");
  if (type && !/(nfl|football|game admission|admission)/.test(type)) reasons.push("non-nfl-event-type");
  const phase = clean(game?.phase ?? game?.season_type);
  if (phase === "regular" && /preseason|pre season|exhibition/.test(text)) reasons.push("preseason-for-regular-game");
  const teams = providerTeams(event, attractionIds).teams;
  const named = [...TEAM_ALIASES].filter(([alias]) => text.split(" ").length > 0 && new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(text)).map(([, abbr]) => abbr);
  const evidenceTeams = new Set([...teams, ...named]);
  if (evidenceTeams.size && !evidenceTeams.has(SEA)) reasons.push("{team}-not-present");
  return [...new Set(reasons)];
}

function venueScore(game, event) {
  const gameVenue = clean(game?.venue?.name ?? game?.venue ?? game?.stadium?.name);
  const providerVenue = clean(event?.venue?.name ?? event?.venueName ?? event?.venue);
  if (!gameVenue || !providerVenue) return { known: false, match: false };
  const match = gameVenue === providerVenue || gameVenue.includes(providerVenue) || providerVenue.includes(gameVenue);
  return { known: true, match };
}

function timestamps(event) {
  const values = [event?.startTimeUtc, event?.startsAt, event?.datetime];
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  if (event?.localStart && event?.timeZone) {
    const match = String(event.localStart).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const fields = match.slice(1).map(Number);
      const desired = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5] ?? 0);
      let probe = desired;
      try {
        // Two passes handle DST offsets without relying on the worker's local timezone.
        for (let index = 0; index < 2; index += 1) {
          const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(probe)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
          const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
          probe += desired - rendered;
        }
        if (Number.isFinite(probe)) return probe;
      } catch { return null; }
    }
  }
  return null;
}

function dateEvidence(game, event) {
  const gameTime = game?.startsAt ? new Date(game.startsAt).getTime() : null;
  const providerTime = timestamps(event);
  const gameDate = game?.date ?? (Number.isFinite(gameTime) ? new Date(gameTime).toISOString().slice(0, 10) : null);
  let providerDate = event?.localDate ?? event?.date ?? null;
  if (!providerDate && Number.isFinite(providerTime) && event?.timeZone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(providerTime)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
      providerDate = `${parts.year}-${parts.month}-${parts.day}`;
    } catch { /* Fall through to UTC only when the provider supplied no usable zone. */ }
  }
  providerDate ??= Number.isFinite(providerTime) ? new Date(providerTime).toISOString().slice(0, 10) : null;
  return {
    dateKnown: Boolean(gameDate && providerDate),
    dateMatch: Boolean(gameDate && providerDate && gameDate === providerDate),
    timeKnown: Number.isFinite(gameTime) && Number.isFinite(providerTime) && game?.timeConfirmed !== false,
    timeDifferenceHours: Number.isFinite(gameTime) && Number.isFinite(providerTime) ? Math.abs(gameTime - providerTime) / HOUR : null,
  };
}

function overrideFor(registry, provider, gameKey, eventId) {
  const entries = Array.isArray(registry?.overrides) ? registry.overrides : [];
  return entries.find((entry) => entry.provider === provider && entry.sfzEventKey === gameKey && (entry.providerEventId === eventId || entry.action === "block" && (!entry.providerEventId || entry.providerEventId === eventId)));
}

export function evaluateProviderEvent(game, event, options = {}) {
  const provider = String(event?.provider ?? options.provider ?? "").trim();
  const providerEventId = String(event?.id ?? event?.providerEventId ?? "").trim();
  const eventKey = sfzEventKey(game);
  const override = overrideFor(options.overrides, provider, eventKey, providerEventId);
  if (override?.action === "block") return { provider, providerEventId, eventKey, outcome: "rejected", matchMethod: "manual", confidence: "none", publishable: false, reviewRequired: false, reasons: ["manual-block"], override };
  if (override?.action === "map") return { provider, providerEventId, eventKey, outcome: "matched", matchMethod: "manual", confidence: "high", publishable: true, reviewRequired: false, reasons: ["manual-map"], override };

  const attractionIds = options.attractionIds ?? {};
  const rejected = rejectionReasons(game, event, attractionIds);
  if (!providerEventId) rejected.push("missing-provider-event-id");
  if (rejected.length) return { provider, providerEventId, eventKey, outcome: "rejected", matchMethod: "unmatched", confidence: "none", publishable: false, reviewRequired: false, reasons: rejected };

  const expected = gameTeams(game);
  const actual = providerTeams(event, attractionIds);
  const hasBoth = actual.teams.has(SEA) && actual.teams.has(expected.opponent);
  const orderedKnown = Boolean(actual.home && actual.away);
  const orderedMatch = actual.home === expected.home && actual.away === expected.away;
  const reversed = orderedKnown && actual.home === expected.away && actual.away === expected.home;
  const venue = venueScore(game, event);
  const date = dateEvidence(game, event);
  const phase = clean(event?.phase ?? event?.seasonType);
  const phaseMatch = !phase || phase === clean(game?.phase);
  const reasons = [];
  if (!hasBoth) reasons.push("both-teams-not-confirmed");
  if (reversed) reasons.push("home-away-conflict");
  if (venue.known && !venue.match) reasons.push("venue-conflict");
  if (date.dateKnown && !date.dateMatch && (date.timeDifferenceHours == null || date.timeDifferenceHours > 14 * 24)) reasons.push("date-conflict");
  if (!phaseMatch) reasons.push("season-phase-conflict");
  if (reasons.some((reason) => ["home-away-conflict", "date-conflict", "season-phase-conflict"].includes(reason))) return { provider, providerEventId, eventKey, outcome: "rejected", matchMethod: "unmatched", confidence: "none", publishable: false, reviewRequired: false, reasons };

  const attractionEvidence = (event?.teams ?? event?.attractions ?? []).some((entry) => options.attractionIds?.[String(entry?.id ?? entry?.attractionId ?? "")]);
  const strongTime = date.timeKnown && date.timeDifferenceHours <= 6;
  const rescheduleWindow = date.timeKnown && date.timeDifferenceHours > 6 && date.timeDifferenceHours <= 14 * 24;
  let confidence = "low";
  if (hasBoth && orderedMatch && venue.match && strongTime) confidence = "high";
  else if (hasBoth && orderedMatch && venue.match && (!date.dateKnown || rescheduleWindow)) confidence = "medium";
  else if (hasBoth && orderedMatch && date.dateMatch) confidence = "medium";
  else if (hasBoth) confidence = "low";
  if (!hasBoth) reasons.push("insufficient-team-evidence");
  if (rescheduleWindow) reasons.push("possible-reschedule");
  if (!venue.known) reasons.push("venue-unconfirmed");
  if (!date.timeKnown) reasons.push("kickoff-time-unconfirmed");
  return {
    provider, providerEventId, eventKey,
    outcome: confidence === "high" ? "matched" : "review",
    matchMethod: attractionEvidence ? "provider-crosswalk" : "teams-venue-time",
    confidence,
    publishable: confidence === "high",
    reviewRequired: confidence !== "high",
    reasons: [...new Set(reasons)],
    evidence: { teams: hasBoth, homeAway: orderedMatch, venue: venue.match, date: date.dateMatch, timeDifferenceHours: date.timeDifferenceHours, eventType: eventText(event) },
  };
}

export function validateMatchOverrides(registry) {
  if (!registry || registry.schemaVersion !== "1.0.0" || !Array.isArray(registry.overrides)) throw new TypeError("Match override registry must use schemaVersion 1.0.0 and an overrides array.");
  const identities = new Set();
  for (const [index, entry] of registry.overrides.entries()) {
    if (!["map", "block"].includes(entry?.action)) throw new TypeError(`Override ${index} has an invalid action.`);
    for (const field of ["sfzEventKey", "provider", "providerEventId", "note", "addedAt", "reason"]) if (!String(entry?.[field] ?? "").trim()) throw new TypeError(`Override ${index} is missing ${field}.`);
    if (!entry.sfzEventKey.startsWith("sea:")) throw new TypeError(`Override ${index} has an invalid SFZ event key.`);
    if (!Number.isFinite(new Date(entry.addedAt).getTime())) throw new TypeError(`Override ${index} has an invalid addedAt timestamp.`);
    const identity = `${entry.sfzEventKey}:${entry.provider}:${entry.providerEventId}`;
    if (identities.has(identity)) throw new TypeError(`Override ${index} duplicates ${identity}.`);
    identities.add(identity);
  }
  return registry;
}

export function matchProviderEvents(games, providerEvents, options = {}) {
  const evaluations = [];
  for (const game of games) for (const event of providerEvents) evaluations.push({ game, event, result: evaluateProviderEvent(game, event, options) });
  const matches = [], unresolvedGames = [];
  for (const game of games) {
    const rows = evaluations.filter((row) => row.game === game);
    const providers = new Set(rows.map((row) => row.result.provider));
    let ambiguous = false;
    for (const provider of providers) {
      const publishable = rows.filter((row) => row.result.provider === provider && row.result.publishable);
      if (publishable.length === 1) matches.push(publishable[0].result);
      else if (publishable.length > 1) {
        ambiguous = true;
        for (const row of publishable) Object.assign(row.result, { outcome: "review", confidence: "medium", publishable: false, reviewRequired: true, reasons: [...row.result.reasons, "multiple-high-confidence-candidates"] });
      }
    }
    if (!matches.some((match) => match.eventKey === sfzEventKey(game))) unresolvedGames.push({ eventKey: sfzEventKey(game), reason: ambiguous ? "ambiguous-candidates" : rows.some((row) => row.result.outcome === "review") ? "review-required" : "no-match" });
  }
  return { matches, candidates: evaluations.map(({ result }) => result), rejected: evaluations.map(({ result }) => result).filter((result) => result.outcome === "rejected"), unresolvedGames };
}

export function createMatchReviewReport(games, providerEvents, options = {}) {
  const report = matchProviderEvents(games, providerEvents, options);
  const lines = ["# Provider Event Match Review", "", "Generated deterministically from committed fixtures.", "", "## Matched events", ""];
  lines.push(...(report.matches.length ? report.matches.map((row) => `- ${row.eventKey} → ${row.provider}:${row.providerEventId} (${row.confidence}, ${row.matchMethod})`) : ["- None"]));
  lines.push("", "## Rejected candidates", "", ...(report.rejected.length ? report.rejected.map((row) => `- ${row.provider}:${row.providerEventId || "(missing ID)"} for ${row.eventKey}: ${row.reasons.join(", ")}`) : ["- None"]));
  lines.push("", "## Unresolved games", "", ...(report.unresolvedGames.length ? report.unresolvedGames.map((row) => `- ${row.eventKey}: ${row.reason}`) : ["- None"]), "");
  return { ...report, markdown: lines.join("\n") };
}

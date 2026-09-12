import test from "node:test";
import assert from "node:assert/strict";
import { playerStatGroups, resolvePlayerProfile } from "../src/lib/player-profile-view.mjs";
import { playerIndexability } from "../src/lib/indexability.mjs";

const biography = "A verified professional biography with substantial context about the player's development, career experience, team history, and current role.";
const fixture = (name = "Jane Player", position = "DE") => ({
  routeId: "jane-player", resolvedPlayerIds: ["jane-player", "123"], fallbackName: name,
  currentRoster: { identityPolicy: "verified-provider-id", players: [{ id: "jane-player", name, position, status: "Active", balldontlieId: null }] },
  players: { data: [{ id: 123, full_name: name, position_abbreviation: position }] },
  season: { playerSeasonStats: [{ player: { id: 123, full_name: name, position_abbreviation: position }, sacks: 4, field_goals_made: 20 }] },
  profiles: { profiles: { "jane-player": { name, bio: biography, careerHighlights: [], materialUpdatedAt: "2026-09-12T00:00:00Z" } } },
});
function decision(model) {
  const title = `${model.displayName} Seattle {Team} Profile`;
  const groups = playerStatGroups(model.statRow, model.position);
  return playerIndexability({ routeId: "jane-player", canonicalId: "jane-player", identity: model.displayName,
    profileIdentity: model.profile.name, biography: model.profile.bio, rosterStatus: "Active",
    usefulSections: [model.profile.careerHighlights.length, model.profile.seasonOverview, groups.length],
    roleContext: Boolean(model.profile.careerHighlights.length || model.profile.seasonOverview || groups.length),
    title, h1: title, canonicalPath: "/players/jane-player", materialUpdatedAt: model.rawProfile.materialUpdatedAt });
}

test("unverified same-name NFL rows do not make incomplete current-roster profiles indexable", () => {
  for (const [name, position] of [["Jarran Reed", "NT"], ["Jason Myers", "K"], ["Rylie Mills", "DE"]]) {
    const model = resolvePlayerProfile(fixture(name, position));
    assert.equal(model.statRow, null, name);
    assert.deepEqual(playerStatGroups(model.statRow, model.position), [], name);
    assert.equal(decision(model).indexable, false, name);
    assert.ok(decision(model).reasons.includes("missing player-specific career or role context"));
  }
});

test("verified position-appropriate stats keep complete profiles eligible", () => {
  const input = fixture();
  input.currentRoster.players[0].balldontlieId = 123;
  const model = resolvePlayerProfile(input);
  assert.equal(model.statRow.player.id, 123);
  assert.deepEqual(playerStatGroups(model.statRow, model.position).map(group => group.label), ["Defense"]);
  assert.equal(decision(model).indexable, true);
});

test("a matched row with zero, nonnumeric, or irrelevant statistics is not a rendered section", () => {
  for (const [position, row] of [["DE", { sacks: 0, total_tackles: null }], ["K", { sacks: 4, field_goals_made: "20" }], ["OL", { passing_yards: 200 }]]) {
    assert.deepEqual(playerStatGroups(row, position), []);
  }
  assert.deepEqual(playerStatGroups({ field_goals_made: 20, sacks: 4 }, "K"), [{ label: "Kicking", items: [{ label: "Field goals made", value: 20 }] }]);
});

test("legacy profile shapes use the same normalized biography and visible overview", () => {
  const input = fixture();
  input.profiles.profiles["jane-player"] = { name: "Jane Player", biography: { overview: biography }, careerHighlights: [], seasonOverview: {}, materialUpdatedAt: "2026-09-12T00:00:00Z" };
  const empty = resolvePlayerProfile(input);
  assert.equal(empty.profile.bio, biography);
  assert.equal(empty.profile.seasonOverview, undefined);
  assert.equal(decision(empty).indexable, false);
  input.profiles.profiles["jane-player"].seasonOverview.paragraph = "A substantive overview of the player's completed season.";
  assert.equal(decision(resolvePlayerProfile(input)).indexable, true);
});

test("canonical profile lookup takes precedence over an older numeric alias", () => {
  const input = fixture();
  input.resolvedPlayerIds = ["123"];
  input.profiles.profiles["123"] = { name: "Jane Player", bio: "Older cached alias biography", careerHighlights: [] };
  assert.equal(resolvePlayerProfile(input).profile.bio, biography);
});

test("historical rows and career-stat fallback preserve existing page behavior", () => {
  const input = fixture();
  input.currentRoster.players = [];
  const historical = resolvePlayerProfile(input);
  assert.equal(historical.liveStatRow.player.id, 123);
  input.season.playerSeasonStats = [];
  input.careerFactsStore = { players: { "jane-player": { recentSeasons: [{ season: 2025, games: 16, sacks: 3 }] } } };
  const fallback = resolvePlayerProfile(input);
  assert.equal(fallback.liveStatRow, null);
  assert.equal(fallback.statRow.sacks, 3);
  assert.equal(playerStatGroups(fallback.statRow, fallback.position)[0].label, "Defense");
});

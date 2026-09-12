import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerRouteRegistry, PLAYER_QUALITY_STATES, playerIndexability, preferredPlayerId, gameIndexability, hasMeaningfulGameGuide, hasMeaningfulViewingInformation } from "../src/lib/indexability.mjs";

test("scheduled {Team} games do not require recaps to be indexable", () => {
  const game = { id: "week-1", status: "Scheduled", date: "2026-09-13T20:25:00Z", home_team: { abbreviation: "SEA" }, visitor_team: { abbreviation: "SF" } };
  const complete = { game, id:game.id, opponentName:"San Francisco 49ers", canonicalPath:"/games/week-1", hasGuide:true, hasViewingInformation:true };
  assert.equal(gameIndexability(complete).indexable, true);
  assert.equal(gameIndexability({ game: { ...game, status: "Cancelled" }, id: game.id, opponentName: "San Francisco 49ers", canonicalPath: "/games/week-1" }).indexable, false);
});

test("future games require publisher guidance and concrete viewing information", () => {
  const game={id:"week-18",status:"TBD",state:"tbd",date:"2027-01-09",home_team:{abbreviation:"LAR"},visitor_team:{abbreviation:"SEA"}};
  const base={game,id:game.id,opponentName:"Los Angeles Rams",canonicalPath:"/games/week-18"};
  assert.equal(gameIndexability({...base,hasGuide:true,hasViewingInformation:false}).indexable,false);
  assert.equal(hasMeaningfulGameGuide({summary:"A detailed matchup guide with verified travel and stadium context for Seattle supporters attending this game.",alerts:[{text:"This section contains maintained, player-independent game-day advice with enough specific transportation, entry, venue, and timing context to help a supporter plan safely."}]}),true);
  assert.equal(hasMeaningfulViewingInformation({status:"tbd",kickoffLabel:"Time TBD",national:"TBD"}),false);
  assert.equal(hasMeaningfulViewingInformation({kickoffLabel:"1:25 p.m. PST",national:"FOX, regional coverage"}),true);
});

test("player gate requires identity, biography, status, useful data, and the preferred alias", () => {
  const complete = { routeId:"sam-darnold",canonicalId:"sam-darnold",identity:"Sam Darnold",profileIdentity:"Sam Darnold",biography:"A substantive career biography with enough unique context to identify the player's teams, development, professional history, and role in Seattle.",rosterStatus:"Active",usefulSections:[true],roleContext:true,title:"Sam Darnold Seattle {Team} Profile",h1:"Sam Darnold Seattle {Team} Profile",canonicalPath:"/players/sam-darnold",materialUpdatedAt:"2026-09-02T00:00:00Z",verifiedResolved:true };
  assert.equal(playerIndexability(complete).indexable, true);
  assert.equal(playerIndexability(complete).state, PLAYER_QUALITY_STATES.INDEXABLE);
  assert.equal(playerIndexability({ ...complete, biography: "" }).indexable, false);
  assert.equal(playerIndexability({ ...complete, usefulSections: [] }).indexable, false);
  assert.equal(preferredPlayerId("123", "Jaxon Smith-Njigba"), "jaxon-smith-njigba");
  assert.equal(playerIndexability({ ...complete, routeId: "123", canonicalId: "jaxon-smith-njigba" }).indexable, false);
  assert.equal(playerIndexability({ ...complete, routeId: "123", canonicalId: "jaxon-smith-njigba" }).state, PLAYER_QUALITY_STATES.ALIAS);
});

test("numeric and name routes resolve to exactly one canonical",()=>{
  const registry=buildPlayerRouteRegistry([{id:"123",name:"Jane Doe"},{id:"jane-doe",name:"Jane Doe"}]);
  assert.equal(registry.routes.get("123").canonicalId,"jane-doe");
  assert.equal(registry.routes.get("123").alias,true);
  assert.equal(registry.routes.get("jane-doe").alias,false);
});

test("published malformed apostrophe IDs redirect to the decoded canonical player",()=>{
  const registry=buildPlayerRouteRegistry([{id:"danthony-bell",name:"D'Anthony Bell",legacyIds:["d-x27-anthony-bell"]}]);
  assert.equal(registry.routes.get("danthony-bell").alias,false);
  assert.deepEqual(registry.routes.get("d-x27-anthony-bell"),{canonicalId:"danthony-bell",dataIds:["danthony-bell"],name:"D'Anthony Bell",alias:true});
});

test("representative roster states remain accessible but incomplete profiles are noindex",()=>{
  const base={routeId:"jane-doe",canonicalId:"jane-doe",identity:"Jane Doe",title:"Jane Doe Seattle {Team} Profile",h1:"Jane Doe Seattle {Team} Profile",canonicalPath:"/players/jane-doe",materialUpdatedAt:"2026-09-02",verifiedResolved:true};
  for(const rosterStatus of ["Active","Practice Squad","Reserve/Injured"]){const result=playerIndexability({...base,rosterStatus,biography:"",usefulSections:[],roleContext:false});assert.equal(result.state,PLAYER_QUALITY_STATES.INCOMPLETE);assert.equal(result.indexable,false);}
  const historical=playerIndexability({...base,biography:"Jane Doe played a verified professional role for Seattle and this biography supplies specific career context beyond generic roster facts.",historicallyLabeled:true,usefulSections:[true],roleContext:true});
  assert.equal(historical.state,PLAYER_QUALITY_STATES.HISTORICAL);
});

test("quality gate rejects identity, placeholder, timestamp, and statistics-label failures",()=>{
  const complete={routeId:"jane-doe",canonicalId:"jane-doe",identity:"Jane Doe",profileIdentity:"Jane Doe",biography:"Jane Doe held a specific verified {Team} role and has substantial professional career context documented here.",rosterStatus:"Active",usefulSections:[true],roleContext:true,title:"Jane Doe Seattle {Team} Profile",h1:"Jane Doe Seattle {Team} Profile",canonicalPath:"/players/jane-doe",materialUpdatedAt:"2026-09-02",verifiedResolved:true};
  assert.match(playerIndexability({...complete,profileIdentity:"Janet Doe"}).reasons.join(" "),/does not match/);
  assert.match(playerIndexability({...complete,biography:"Repository build artifact placeholder prose that is deliberately long enough to pass a naive length-only gate for this player."}).reasons.join(" "),/placeholder/);
  assert.match(playerIndexability({...complete,materialUpdatedAt:null}).reasons.join(" "),/materialUpdatedAt/);
  assert.match(playerIndexability({...complete,statisticsLabelValid:false}).reasons.join(" "),/mislabeled/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { playerRouteRegistry, recapRenderParts } from "../src/lib/recap-player-links.mjs";

const registry = playerRouteRegistry([
  { id:"jaxon-smith-njigba", name:"Jaxon Smith-Njigba" },
  { id:"sam-darnold", name:"Sam Darnold" },
]);

test("literal player tokens use the existing canonical profile route and preserve prose", () => {
  const parts = recapRenderParts("A catch by {t:'player',v:'Jaxon Smith-Njigba',id:869,name:'Jaxon Smith-Njigba'} sealed it.", registry);
  assert.deepEqual(parts, [
    { text:"A catch by ", href:null },
    { text:"Jaxon Smith-Njigba", href:"/players/jaxon-smith-njigba" },
    { text:" sealed it.", href:null },
  ]);
  assert.doesNotMatch(parts.map((part) => part.text).join(""), /\{t:'player'/);
});

test("structured references retain working links and unresolved tokens show a readable name", () => {
  assert.deepEqual(recapRenderParts([
    { t:"player", v:"Sam Darnold", id:"sam-darnold", name:"Sam Darnold" },
    { t:"text", v:" found " },
    { t:"text", v:"{t:'player',v:'Unknown Receiver',id:999,name:'Unknown Receiver'}." },
  ], registry), [
    { text:"Sam Darnold", href:"/players/sam-darnold" },
    { text:" found ", href:null },
    { text:"Unknown Receiver", href:null },
    { text:".", href:null },
  ]);
});

test("multiple literal references keep punctuation and resolve independently", () => {
  assert.deepEqual(recapRenderParts("{t:'player',v:'Sam Darnold',id:1,name:'Sam Darnold'} to {t:'player',v:'Jaxon Smith-Njigba',id:869,name:'Jaxon Smith-Njigba'}!", registry), [
    { text:"Sam Darnold", href:"/players/sam-darnold" },
    { text:" to ", href:null },
    { text:"Jaxon Smith-Njigba", href:"/players/jaxon-smith-njigba" },
    { text:"!", href:null },
  ]);
});

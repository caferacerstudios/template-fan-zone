import test from "node:test";
import assert from "node:assert/strict";
import { chartPath, providerChartPoints } from "../src/lib/tickets/chart-path.mjs";

const history = values => values.map((value, index) => ({
  observedAt: `2026-08-${String(index + 1).padStart(2, "0")}`,
  ticketmasterCents: value,
}));
const pointsFor = values => providerChartPoints(history(values), "ticketmaster", index => index * 10, value => value / 100);
const moveCount = path => (path.match(/M/g) || []).length;

test("chart path handles empty, single-point, and two-point runs", () => {
  assert.equal(chartPath([]), "");
  assert.equal(chartPath([{ x: 4, y: 8 }]), "M4,8");
  assert.equal(chartPath([{ x: 0, y: 2 }, { x: 10, y: 7 }]), "M0,2 L10,7");
});

test("chart path uses shape-preserving cubic curves through every source point", () => {
  const points = [{ x: 0, y: 10 }, { x: 10, y: 5 }, { x: 20, y: 8 }, { x: 30, y: 2 }];
  const path = chartPath(points);
  assert.equal((path.match(/ C/g) || []).length, points.length - 1);
  for (const point of points) assert.match(path, new RegExp(`(?:M| )${point.x},${point.y}(?: C|$)`));

  const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
  assert.ok(numbers.every(Number.isFinite));
  assert.match(path, /C/);
});

test("monotone runs keep cubic control points within neighboring values", () => {
  const path = chartPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]);
  const yCoordinates = [...path.matchAll(/(?:M|C| )-?\d+(?:\.\d+)?(?:,)(-?\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
  assert.ok(yCoordinates.every(y => y >= 0 && y <= 20));
});

test("one missing observation produces one path with original horizontal spacing", () => {
  const points = pointsFor([29000, null, 30000]);
  assert.deepEqual(points.map(({ x, value, sourceIndex }) => ({ x, value, sourceIndex })), [{ x: 0, value: 29000, sourceIndex: 0 }, { x: 20, value: 30000, sourceIndex: 2 }]);
  assert.equal(moveCount(chartPath(points)), 1);
});

test("multiple consecutive missing observations do not create a second path section", () => {
  const points = pointsFor([29000, null, null, null, 31000]);
  assert.deepEqual(points.map(point => point.x), [0, 40]);
  assert.equal(moveCount(chartPath(points)), 1);
});

test("multiple missing spans retain every valid provider observation in one path", () => {
  const points = pointsFor([29000, null, 30000, null, null, 29500]);
  assert.deepEqual(points.map(point => [point.sourceIndex, point.value]), [[0, 29000], [2, 30000], [5, 29500]]);
  assert.equal(moveCount(chartPath(points)), 1);
});

test("leading and trailing nulls bound the path to the first and last valid points", () => {
  const points = pointsFor([null, null, 29000, null, 30000, null]);
  assert.deepEqual(points.map(point => [point.x, point.value]), [[20, 29000], [40, 30000]]);
  assert.equal(chartPath(points), "M20,290 L40,300");
});

test("one valid observation yields a marker coordinate without requiring a line", () => {
  const points = pointsFor([null, 29000, null]);
  assert.deepEqual(points.map(point => [point.x, point.y]), [[10, 290]]);
  assert.equal(points.length, 1);
});

test("provider sparsity is independent", () => {
  const rows = [
    { observedAt: "2026-08-01", ticketmasterCents: 29000, stubhubCents: null },
    { observedAt: "2026-08-02", ticketmasterCents: null, stubhubCents: 28000 },
    { observedAt: "2026-08-03", ticketmasterCents: 30000, stubhubCents: null },
    { observedAt: "2026-08-04", ticketmasterCents: null, stubhubCents: 29500 },
  ];
  const x = index => index * 10, y = value => value / 100;
  const ticketmaster = providerChartPoints(rows, "ticketmaster", x, y);
  const stubhub = providerChartPoints(rows, "stubhub", x, y);
  assert.deepEqual(ticketmaster.map(point => point.x), [0, 20]);
  assert.deepEqual(stubhub.map(point => point.x), [10, 30]);
  assert.equal(moveCount(chartPath(ticketmaster)), 1);
  assert.equal(moveCount(chartPath(stubhub)), 1);
});

test("selected date ranges connect only valid points inside each range", () => {
  const rows = history([27000, null, 28000, null, 29000, null, 30000]);
  for (const start of [0, 2, 4]) {
    const selected = rows.slice(start);
    const points = providerChartPoints(selected, "ticketmaster", index => index * 10, value => value);
    assert.equal(moveCount(chartPath(points)), 1);
    assert.ok(points.every(point => selected[point.sourceIndex].ticketmasterCents === point.value));
  }
});

const coordinate = value => Number.isFinite(value) ? String(value) : "";

export function providerChartPoints(points, market, x, y) {
  return points
    .map((point, sourceIndex) => {
      const value = point[`${market}Cents`];
      if (!Number.isSafeInteger(value)) return null;
      return { x: x(sourceIndex), y: y(value), value, observedAt: point.observedAt, sourceIndex };
    })
    .filter(Boolean);
}

export function chartPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${coordinate(points[0].x)},${coordinate(points[0].y)}`;
  if (points.length === 2) return `M${coordinate(points[0].x)},${coordinate(points[0].y)} L${coordinate(points[1].x)},${coordinate(points[1].y)}`;

  const slopes = points.slice(1).map((point, index) =>
    (point.y - points[index].y) / (point.x - points[index].x)
  );
  const tangents = [slopes[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const before = slopes[index - 1], after = slopes[index];
    tangents[index] = before * after <= 0 ? 0 : 2 / (1 / before + 1 / after);
  }
  tangents.push(slopes.at(-1));

  let path = `M${coordinate(points[0].x)},${coordinate(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index], end = points[index + 1], width = end.x - start.x;
    path += ` C${coordinate(start.x + width / 3)},${coordinate(start.y + tangents[index] * width / 3)} ${coordinate(end.x - width / 3)},${coordinate(end.y - tangents[index + 1] * width / 3)} ${coordinate(end.x)},${coordinate(end.y)}`;
  }
  return path;
}

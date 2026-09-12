import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PERFORMANCE_BUDGET = Object.freeze({
  javascriptBytes: 150 * 1024,
  imageBytes: 14 * 1024 * 1024,
  largestImageBytes: 3 * 1024 * 1024,
  thirdPartyOrigins: 2,
});

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(location));
    else files.push(location);
  }
  return files;
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export async function auditBuild(directory) {
  const root = fileURLToPath(directory instanceof URL ? directory : new URL(`file://${path.resolve(directory)}/`));
  const files = await filesBelow(root);
  const javascript = files.filter((file) => path.extname(file) === ".js");
  const images = files.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const html = files.filter((file) => path.extname(file) === ".html");
  const sizes = new Map(await Promise.all(files.map(async (file) => [file, (await stat(file)).size])));
  const origins = new Set();

  for (const file of html) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:src|href)=["']https?:\/\/([^/"']+)/gi)) origins.add(match[1]);
  }

  const javascriptBytes = javascript.reduce((sum, file) => sum + sizes.get(file), 0);
  const imageBytes = images.reduce((sum, file) => sum + sizes.get(file), 0);
  const largestImage = images.sort((a, b) => sizes.get(b) - sizes.get(a))[0];
  const largestImageBytes = largestImage ? sizes.get(largestImage) : 0;
  const metrics = { javascriptBytes, imageBytes, largestImageBytes, thirdPartyOrigins: origins.size };
  const failures = Object.entries(PERFORMANCE_BUDGET).filter(([key, limit]) => metrics[key] > limit);

  console.log("\nPerformance budget");
  console.log(`  JavaScript: ${formatBytes(javascriptBytes)} / ${formatBytes(PERFORMANCE_BUDGET.javascriptBytes)}`);
  console.log(`  Images: ${formatBytes(imageBytes)} / ${formatBytes(PERFORMANCE_BUDGET.imageBytes)}`);
  console.log(`  Largest image: ${formatBytes(largestImageBytes)} / ${formatBytes(PERFORMANCE_BUDGET.largestImageBytes)}${largestImage ? ` (${path.relative(root, largestImage)})` : ""}`);
  console.log(`  Third-party origins in initial HTML: ${origins.size} / ${PERFORMANCE_BUDGET.thirdPartyOrigins}${origins.size ? ` (${[...origins].join(", ")})` : ""}`);

  if (failures.length) throw new Error(`Performance budget exceeded: ${failures.map(([key]) => key).join(", ")}`);
  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await auditBuild(new URL(`file://${path.resolve(process.argv[2] ?? "dist")}/`));
}

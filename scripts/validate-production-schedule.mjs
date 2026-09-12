#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProductionOutputFile, validateProductionSchedule } from "../src/lib/production-schedule-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schedulePath = path.join(root, "src/data/nfl/{team}.json");
const distPath = path.join(root, "dist");

function validateSource() {
  let schedule;
  try { schedule = JSON.parse(fs.readFileSync(schedulePath, "utf8")); }
  catch (error) { throw new Error(`Cannot read canonical production schedule: ${error.message}`); }
  validateProductionSchedule(schedule);
  console.log("Production schedule source validation passed.");
}

function validateDist() {
  if (!fs.existsSync(distPath) || !fs.statSync(distPath).isDirectory()) throw new Error("Production output validation failed: dist directory is missing");
  let checked = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const pathname = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(pathname);
      else if (/\.(?:html|xml|json)$/i.test(entry.name)) {
        validateProductionOutputFile(path.relative(root, pathname), fs.readFileSync(pathname, "utf8"));
        checked += 1;
      }
    }
  };
  visit(distPath);
  if (checked === 0) throw new Error("Production output validation failed: dist contains no public HTML/XML/JSON files");
  console.log(`Production output validation passed (${checked} HTML/XML/JSON files checked).`);
}

try {
  const modes = new Set(process.argv.slice(2));
  if (modes.size === 0 || modes.has("--source")) validateSource();
  if (modes.has("--dist")) validateDist();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}

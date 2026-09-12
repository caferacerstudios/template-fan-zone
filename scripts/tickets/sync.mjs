#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { runTicketSync } from "./pipeline.mjs";

try {
  const status = await runTicketSync(loadConfig());
  process.stdout.write(`${JSON.stringify({ outcome: status.outcome, generatedAt: status.generatedAt, totals: status.totals })}\n`);
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code) ? error.code : "SYNC_FAILED";
  process.stderr.write(`${JSON.stringify({ outcome: "failed", errorCode: code })}\n`);
  process.exitCode = 1;
}

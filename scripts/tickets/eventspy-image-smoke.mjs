#!/usr/bin/env node
import { chromium } from "playwright-core";
const browser=await chromium.launch({headless:true});
try { const context=await browser.newContext({offline:true,storageState:undefined,httpCredentials:undefined}); await context.close(); }
finally { await browser.close(); }
process.stdout.write('{"outcome":"EVENTSPY_IMAGE_SMOKE_OK","network":"disabled"}\n');

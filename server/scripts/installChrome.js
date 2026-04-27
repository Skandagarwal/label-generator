const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (!process.env.RENDER && !process.env.INSTALL_PUPPETEER_CHROME) {
  console.log("Skipping Chrome install outside Render.");
  process.exit(0);
}

process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";

fs.mkdirSync(process.env.PUPPETEER_CACHE_DIR, { recursive: true });

const puppeteerBin = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  "puppeteer"
);

const result = spawnSync(puppeteerBin, ["browsers", "install", "chrome"], {
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status || 0);

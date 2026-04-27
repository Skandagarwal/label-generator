const { spawnSync } = require("node:child_process");
const path = require("node:path");

if (!process.env.RENDER && !process.env.INSTALL_PUPPETEER_CHROME) {
  console.log("Skipping Chrome install outside Render.");
  process.exit(0);
}

process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";

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

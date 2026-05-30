const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

if (!process.env.RENDER && !process.env.INSTALL_PUPPETEER_CHROME) {
  console.log("Skipping Chrome install outside Render.");
  process.exit(0);
}

process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";

fs.mkdirSync(process.env.PUPPETEER_CACHE_DIR, { recursive: true });

try {
  const executablePath = puppeteer.executablePath();

  if (executablePath && fs.existsSync(executablePath)) {
    console.log(`Chrome already available at ${executablePath}`);
    process.exit(0);
  }
} catch (err) {
  // Continue to install Chrome when Puppeteer cannot resolve an executable yet.
}

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

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

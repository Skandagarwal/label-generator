const { spawn } = require("node:child_process");
const path = require("node:path");
const { networkInterfaces } = require("node:os");

const getLanIp = () => {
  const interfaces = networkInterfaces();

  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) {
        return item.address;
      }
    }
  }

  return "localhost";
};

const lanIp = getLanIp();
const env = {
  ...process.env,
  HOST: "0.0.0.0",
  PUBLIC_API_ORIGIN: `http://${lanIp}:5050`,
  REACT_APP_API_BASE: `http://${lanIp}:5050/api`,
};

console.log(`LAN app: http://${lanIp}:3000`);
console.log(`LAN API: http://${lanIp}:5050`);

const child = spawn(
  path.join(__dirname, "..", "node_modules", ".bin", "concurrently"),
  ["npm run server", "npm run client"],
  {
    env,
    stdio: "inherit",
    shell: false,
  }
);

child.on("exit", (code) => {
  process.exit(code || 0);
});

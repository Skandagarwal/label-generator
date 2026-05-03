const express = require("express");
const cors = require("cors");
const path = require("node:path");
const { connectDatabase, getDatabaseProvider } = require("./services/dataStore");

const app = express();
const PORT = process.env.PORT || 5050;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const clientBuildPath = path.join(__dirname, "..", "client", "build");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CLIENT_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "5mb" }));

// routes
const authRoutes = require("./routes/authRoutes");
const labelRoutes = require("./routes/labelRoutes");
app.use("/api/auth", authRoutes);
app.use("/api", labelRoutes);

app.get("/test", (req, res) => {
  res.send("TEST WORKING");
});

app.get("/api/status", (req, res) => {
  res.json({
    database: getDatabaseProvider(),
    firebaseConfigured: getDatabaseProvider() === "firebase",
  });
});

app.use(express.static(clientBuildPath));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

connectDatabase()
  .then(() => {
    console.log("Database ready");
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
  });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("node:path");

const app = express();
const PORT = process.env.PORT || 5050;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/labels";
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const clientBuildPath = path.join(__dirname, "..", "client", "build");

mongoose.set("bufferCommands", false);

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

app.use(express.static(clientBuildPath));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
  });

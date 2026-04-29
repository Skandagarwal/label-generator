const express = require("express");
const User = require("../models/User");

const router = express.Router();
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;

const normalizePhone = (phone = "") => String(phone).replace(/[^\d+]/g, "").trim();

const isValidPhone = (phone) => /^\+?\d{10,15}$/.test(phone);

const createOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const sendOtp = async (phone, otp) => {
  // Plug a real SMS provider here later. Keep this local-only until credentials are added.
  console.log(`OTP for ${phone}: ${otp}`);
};

const cleanText = (value = "") => String(value || "").trim();

const profileFields = (body = {}) => ({
  name: cleanText(body.name),
  manufacturer: cleanText(body.manufacturer || body.name),
  manufacturerAddress: cleanText(body.manufacturerAddress),
  manufacturerWebsite: cleanText(body.manufacturerWebsite),
  manufacturerEmail: cleanText(body.manufacturerEmail),
  manufacturerPhone: cleanText(body.manufacturerPhone),
  manufacturerLogo: String(body.manufacturerLogo || "").startsWith("data:image/")
    ? String(body.manufacturerLogo)
    : "",
});

const serializeUser = (user) => ({
  phone: user.phone,
  name: user.name || user.phone,
  manufacturer: user.manufacturer || user.name || user.phone,
  manufacturerAddress: user.manufacturerAddress || "",
  manufacturerWebsite: user.manufacturerWebsite || "",
  manufacturerEmail: user.manufacturerEmail || "",
  manufacturerPhone: user.manufacturerPhone || user.phone || "",
  manufacturerLogo: user.manufacturerLogo || "",
});

router.post("/request-otp", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);

    if (!name) {
      return res.status(400).json({ message: "Enter your name" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }

    const otp = createOtp();

    otpStore.set(phone, {
      otp,
      name,
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    await sendOtp(phone, otp);

    res.json({
      message: "OTP sent",
      devOtp: process.env.NODE_ENV === "production" ? undefined : otp,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not send OTP" });
  }
});

router.post("/verify-otp", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const name = String(req.body.name || "").trim();
  const otp = String(req.body.otp || "").trim();
  const record = otpStore.get(phone);

  if (!record || record.expiresAt < Date.now()) {
    otpStore.delete(phone);
    return res.status(400).json({ message: "OTP expired. Request a new one." });
  }

  if (record.otp !== otp) {
    return res.status(400).json({ message: "Incorrect OTP" });
  }

  otpStore.delete(phone);

  try {
    const user = await User.findOneAndUpdate(
      { phone },
      {
        $setOnInsert: {
          phone,
          manufacturer: name || record.name || phone,
          manufacturerPhone: phone,
        },
        $set: {
          name: name || record.name || phone,
        },
      },
      { new: true, upsert: true }
    ).lean();

    res.json({
      message: "Login successful",
      user: serializeUser(user),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not load user profile" });
  }
});

router.get("/profile/:phone", async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);

    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }

    const user = await User.findOne({ phone }).lean();

    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json({ user: serializeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not load profile" });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }

    const fields = profileFields(req.body);
    const user = await User.findOneAndUpdate(
      { phone },
      {
        $set: {
          phone,
          ...fields,
          manufacturerPhone: fields.manufacturerPhone || phone,
        },
      },
      { new: true, upsert: true }
    ).lean();

    res.json({ message: "Profile saved", user: serializeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not save profile" });
  }
});

module.exports = router;

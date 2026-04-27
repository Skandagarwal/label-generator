const express = require("express");

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

router.post("/verify-otp", (req, res) => {
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
  res.json({
    message: "Login successful",
    user: {
      phone,
      name: name || record.name || phone,
    },
  });
});

module.exports = router;

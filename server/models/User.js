const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: String,
    manufacturer: String,
    manufacturerAddress: String,
    manufacturerWebsite: String,
    manufacturerEmail: String,
    manufacturerPhone: String,
    manufacturerLogo: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);

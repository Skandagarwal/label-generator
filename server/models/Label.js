const mongoose = require("mongoose");

const LabelSchema = new mongoose.Schema(
  {
    formatNo: String,
    drumNo: String,
    commodity: String,
    lotNo: String,
    poNo: String,
    mfgDate: String,
    bestBefore: String,
    netWt: String,
    tareWt: String,
    grossWt: String,
    customerName: String,
    customerAddress: String,
    storage: String,
    license: String,
    manufacturer: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Label", LabelSchema);

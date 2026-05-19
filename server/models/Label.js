const mongoose = require("mongoose");

const LabelSchema = new mongoose.Schema(
  {
    formatNo: String,
    drumNo: String,
    commodity: String,
    lotNo: String,
    poNo: String,
    mfgDate: String,
    bestBeforeGap: String,
    bestBefore: String,
    netWt: String,
    tareWt: String,
    grossWt: String,
    customerName: String,
    customerAddress: String,
    warningText: String,
    storage: String,
    license: String,
    manufacturer: String,
    manufacturerAddress: String,
    manufacturerWebsite: String,
    manufacturerEmail: String,
    manufacturerPhone: String,
    manufacturerLogo: String,
    pdfLayout: String,
    templateId: String,
    templateName: String,
    fieldLabels: mongoose.Schema.Types.Mixed,
    hiddenFields: [String],
    customFields: [
      {
        key: String,
        label: String,
        type: String,
        value: String,
      },
    ],
    ownerPhone: { type: String, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Label", LabelSchema);

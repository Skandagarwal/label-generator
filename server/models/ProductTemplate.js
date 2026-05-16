const mongoose = require("mongoose");

const CustomFieldSchema = new mongoose.Schema(
  {
    key: String,
    label: String,
    type: { type: String, default: "text" },
    required: { type: Boolean, default: false },
    defaultValue: String,
  },
  { _id: false }
);

const ProductTemplateSchema = new mongoose.Schema(
  {
    ownerPhone: { type: String, index: true },
    name: { type: String, required: true },
    productName: String,
    defaults: {
      formatNo: String,
      commodity: String,
      warningText: String,
      storage: String,
      license: String,
      bestBeforeGap: String,
    },
    customFields: [CustomFieldSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductTemplate", ProductTemplateSchema);

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

const FieldSettingSchema = new mongoose.Schema(
  {
    key: String,
    label: String,
    visible: { type: Boolean, default: true },
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
    fieldSettings: [FieldSettingSchema],
    customFields: [CustomFieldSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductTemplate", ProductTemplateSchema);

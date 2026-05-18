import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { hasFirebaseWebConfig, sendFirebaseOtp } from "./firebaseAuth";
import "./App.css";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (window.location.hostname === "localhost" && window.location.port === "3000"
    ? "http://localhost:5050/api"
    : "/api");
const DRUM_ROWS_BATCH_SIZE = 10;
const SUPPORT_EMAIL = "batchmark.help@gmail.com";

const fields = [
  {
    name: "formatNo",
    label: "Format No",
    placeholder: "AE/API/ST/SOP-11/F1-00",
    defaultValue: "AE/API/ST/SOP-11/F1-00",
  },
  {
    name: "drumNo",
    label: "Drum No",
    required: true,
    multiline: true,
    helper: "Add one drum number per line, or separate with commas.",
  },
  { name: "commodity", label: "Commodity", required: true },
  { name: "lotNo", label: "Lot No", required: true },
  { name: "poNo", label: "P.O. No" },
  { name: "mfgDate", label: "Mfg. Date", type: "date" },
  {
    name: "bestBeforeGap",
    label: "Best Before Gap",
    type: "select",
    defaultValue: "2",
    options: Array.from({ length: 10 }, (_, index) => ({
      value: String(index + 1),
      label: `${index + 1} year${index === 0 ? "" : "s"}`,
    })),
  },
  { name: "bestBefore", label: "Best Before", type: "date" },
  { name: "netWt", label: "Net Wt.", placeholder: "25.000 KGS." },
  { name: "tareWt", label: "Tare Wt.", placeholder: "3.640 KGS." },
  { name: "grossWt", label: "Gross Wt.", placeholder: "28.640 KGS." },
  { name: "customerName", label: "Customer Name" },
  { name: "customerAddress", label: "Customer Address", multiline: true },
  {
    name: "storage",
    label: "Storage Condition",
    multiline: true,
    placeholder: "HIGHLY HYGROSCOPIC POWDER. STORE AT COOL AND DRY PLACE.",
  },
  {
    name: "warningText",
    label: "Warning Text",
    placeholder: '"NOT FOR MEDICINAL USE"',
    defaultValue: '"NOT FOR MEDICINAL USE"',
  },
  { name: "license", label: "License Number" },
  { name: "manufacturer", label: "Manufacturer", multiline: true },
  { name: "manufacturerAddress", label: "Manufacturer Address", multiline: true },
  { name: "manufacturerWebsite", label: "Manufacturer Website" },
  { name: "manufacturerEmail", label: "Manufacturer Email" },
  { name: "manufacturerPhone", label: "Manufacturer Phone" },
];

const fieldGroups = [
  {
    title: "Batch Details",
    fields: [
      "formatNo",
      "commodity",
      "lotNo",
      "poNo",
      "mfgDate",
      "bestBeforeGap",
      "bestBefore",
    ],
  },
  {
    title: "Customer And Compliance",
    fields: ["customerName", "customerAddress", "warningText", "storage", "license", "manufacturer"],
  },
];

const fieldsByName = fields.reduce((items, field) => {
  items[field.name] = field;
  return items;
}, {});

const customizableTemplateFields = [
  { key: "formatNo", label: "Format No", group: "Batch" },
  { key: "drumNo", label: "Drum No", group: "Batch" },
  { key: "commodity", label: "Commodity", group: "Batch" },
  { key: "lotNo", label: "Lot No", group: "Batch" },
  { key: "poNo", label: "P.O. No", group: "Batch" },
  { key: "mfgDate", label: "Mfg. Date", group: "Batch" },
  { key: "bestBefore", label: "Best Before", group: "Batch" },
  { key: "netWt", label: "Net Wt.", group: "Weights" },
  { key: "tareWt", label: "Tare Wt.", group: "Weights" },
  { key: "grossWt", label: "Gross Wt.", group: "Weights" },
  { key: "customerName", label: "Buyer / Customer Name", group: "Buyer" },
  { key: "customerAddress", label: "Buyer / Customer Address", group: "Buyer" },
  { key: "warningText", label: "Warning Text", group: "Compliance" },
  { key: "storage", label: "Storage Condition", group: "Compliance" },
  { key: "license", label: "License Number", group: "Compliance" },
  { key: "manufacturer", label: "Manufacturer Name", group: "Manufacturer" },
  { key: "manufacturerAddress", label: "Manufacturer Address", group: "Manufacturer" },
  { key: "manufacturerWebsite", label: "Manufacturer Website", group: "Manufacturer" },
  { key: "manufacturerEmail", label: "Manufacturer Email", group: "Manufacturer" },
  { key: "manufacturerPhone", label: "Manufacturer Phone", group: "Manufacturer" },
  { key: "manufacturerLogo", label: "Manufacturer Logo", group: "Manufacturer" },
];

const templateLayoutPositions = [
  { value: "left", label: "Left details" },
  { value: "right", label: "Right details" },
  { value: "center", label: "Center notice" },
  { value: "bottom", label: "Bottom block" },
  { value: "hidden", label: "Hidden" },
];

const defaultTemplatePositionFor = (field, index = 0) => {
  if (["warningText", "storage", "license"].includes(field.key)) {
    return "center";
  }

  if (field.group === "Manufacturer") {
    return "bottom";
  }

  return index % 2 === 0 ? "left" : "right";
};

const normalizeTemplatePosition = (value = "left") =>
  templateLayoutPositions.some((option) => option.value === value) ? value : "left";

const emptyFieldSetting = (field, index = 0) => ({
  key: field.key,
  label: field.label,
  visible: true,
  defaultValue: fieldsByName[field.key]?.defaultValue || "",
  position: defaultTemplatePositionFor(field, index),
  order: index + 1,
});

const defaultTemplateFieldSettings = () =>
  customizableTemplateFields.map((field, index) => emptyFieldSetting(field, index));

const emptyForm = fields.reduce((values, field) => {
  values[field.name] = field.defaultValue || "";
  return values;
}, {});

const emptyDrumItem = (drumNo = "", netWt = "", tareWt = "") => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  drumNo,
  netWt,
  tareWt,
  grossWt: calculateGrossWeight(netWt, tareWt),
});

const parseWeight = (value = "") => {
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);

  if (!match) {
    return null;
  }

  return {
    amount: Number(match[1]),
    decimals: match[1].includes(".") ? match[1].split(".")[1].length : 0,
    unit: match[2].trim(),
  };
};

const formatWeight = (value = "") => {
  const parsed = parseWeight(value);

  if (!parsed) {
    return "";
  }

  const amountText = String(value).trim().match(/^-?\d+(?:\.\d+)?/)?.[0] || "";
  const unit = parsed.unit || "KGS.";

  return `${amountText} ${unit}`;
};

const calculateGrossWeight = (netWt, tareWt) => {
  const net = parseWeight(netWt);
  const tare = parseWeight(tareWt);

  if (!net || !tare) {
    return "";
  }

  const decimals = Math.max(net.decimals, tare.decimals);
  const unit = net.unit || tare.unit || "KGS.";
  const total = (net.amount + tare.amount).toFixed(decimals);

  return `${total} ${unit}`;
};

const getNextDrumNo = (drumNo = "") => {
  const match = String(drumNo).trim().match(/^(.*?)(\d+)(?:\/\d+)?([^0-9]*)$/);

  if (!match) {
    return "";
  }

  const nextNumber = String(Number(match[2]) + 1).padStart(match[2].length, "0");

  return `${match[1]}${nextNumber}${match[3] || ""}`;
};

const formatDrumSequence = (index, total) => `${index + 1}/${Math.max(total, 1)}`;

const cleanSheetCell = (value = "") => String(value ?? "").trim();

const normalizeSheetHeader = (value = "") =>
  cleanSheetCell(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const findSheetColumn = (headers, names) =>
  headers.findIndex((header) => names.includes(normalizeSheetHeader(header)));

const sheetRowHasValue = (row = []) => row.some((value) => cleanSheetCell(value));

const parseSpreadsheetDrumRows = (rows = []) => {
  const nonEmptyRows = rows.filter(sheetRowHasValue);

  if (!nonEmptyRows.length) {
    return [];
  }

  const firstRow = nonEmptyRows[0].map(cleanSheetCell);
  const drumNoIndex = findSheetColumn(firstRow, ["drumno", "drum", "drumnumber"]);
  const netWtIndex = findSheetColumn(firstRow, ["netwt", "netweight", "net"]);
  const tareWtIndex = findSheetColumn(firstRow, ["tarewt", "tareweight", "tare"]);
  const hasHeader = netWtIndex >= 0 || tareWtIndex >= 0 || drumNoIndex >= 0;
  const dataRows = hasHeader ? nonEmptyRows.slice(1) : nonEmptyRows;

  return dataRows
    .map((row, index) => {
      const cells = row.map(cleanSheetCell);

      if (hasHeader) {
        const netWt = netWtIndex >= 0 ? cells[netWtIndex] : "";
        const tareWt = tareWtIndex >= 0 ? cells[tareWtIndex] : "";
        const drumNo = drumNoIndex >= 0 ? cells[drumNoIndex] : String(index + 1);

        return emptyDrumItem(drumNo || String(index + 1), netWt, tareWt);
      }

      const parts = cells.filter(Boolean);
      const hasDrumNo = parts.length >= 3;
      const netWt = hasDrumNo ? parts[1] : parts[0];
      const tareWt = hasDrumNo ? parts[2] : parts[1];

      return emptyDrumItem(hasDrumNo ? parts[0] : String(index + 1), netWt || "", tareWt || "");
    })
    .filter((item) => item.netWt || item.tareWt);
};

const parseBulkDrumRows = (value = "") =>
  String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,|\t]+|\s{2,}/).map((part) => part.trim()).filter(Boolean))
    .map((parts, index) => {
      const hasDrumNo = parts.length >= 3;
      const netWt = hasDrumNo ? parts[1] : parts[0];
      const tareWt = hasDrumNo ? parts[2] : parts[1];

      return emptyDrumItem(hasDrumNo ? parts[0] : String(index + 1), netWt || "", tareWt || "");
    })
    .filter((item) => item.netWt || item.tareWt);

const parseDate = (value) => {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (slashMatch) {
    return new Date(
      Number(slashMatch[3]),
      Number(slashMatch[2]) - 1,
      Number(slashMatch[1])
    );
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3])
    );
  }

  return null;
};

const formatDate = (date) => {
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};

const normalizeDateValue = (value) => {
  const parsed = parseDate(value);
  return parsed ? formatDate(parsed) : value;
};

const calculateBestBefore = (mfgDate, yearGap = 2) => {
  const parsed = parseDate(mfgDate);

  if (!parsed) {
    return "";
  }

  const years = Math.max(1, Number(yearGap) || 2);
  const bestBefore = new Date(parsed);
  bestBefore.setFullYear(bestBefore.getFullYear() + years);
  bestBefore.setDate(bestBefore.getDate() - 1);

  return formatDate(bestBefore);
};

const toInputDate = (value) => {
  const parsed = parseDate(value);

  if (!parsed) {
    return "";
  }

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();

  return `${year}-${month}-${day}`;
};

const formatHistoryDate = (value) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const safeFilePart = (value) =>
  String(value || "label")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "label";

const getLabelName = (label = {}) => label.commodity || label.drumNo || "this label";

const getHistoryDay = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getHistoryTime = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getBatchGroupKey = (label = {}) => {
  const created = new Date(label.createdAt);
  const createdMinute = Number.isNaN(created.getTime())
    ? "unknown"
    : created.toISOString().slice(0, 16);

  return [
    label.commodity || "untitled",
    label.lotNo || "no-lot",
    label.poNo || "no-po",
    label.customerName || "no-customer",
    label.mfgDate || "no-mfg",
    label.bestBefore || "no-best-before",
    createdMinute,
  ].join("|");
};

const groupHistoryLabels = (items = []) => {
  const groups = new Map();

  items.forEach((label) => {
    const key = getBatchGroupKey(label);
    const existing = groups.get(key);

    if (existing) {
      existing.labels.push(label);
      return;
    }

    groups.set(key, {
      key,
      commodity: label.commodity || "Untitled Label",
      lotNo: label.lotNo || "-",
      poNo: label.poNo || "-",
      customerName: label.customerName || "-",
      createdAt: label.createdAt,
      labels: [label],
    });
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    labels: group.labels.slice().sort((a, b) =>
      String(a.drumNo || "").localeCompare(String(b.drumNo || ""), undefined, {
        numeric: true,
      })
    ),
  }));
};

const groupHistoryByDay = (groups = []) => {
  const sections = new Map();

  groups.forEach((group) => {
    const day = getHistoryDay(group.createdAt);
    const existing = sections.get(day);

    if (existing) {
      existing.groups.push(group);
      existing.labelCount += group.labels.length;
      return;
    }

    sections.set(day, {
      day,
      createdAt: group.createdAt,
      labelCount: group.labels.length,
      groups: [group],
    });
  });

  return Array.from(sections.values());
};

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const getSavedUser = () =>
  window.localStorage.getItem("labelUserName") ||
  window.localStorage.getItem("labelUserPhone") ||
  "";
const getSavedPhone = () => window.localStorage.getItem("labelUserPhone") || "";
const getProfileStorageKey = (phone = getSavedPhone()) =>
  phone ? `labelUserProfile:${phone}` : "";
const emptyManufacturerDetails = (userName = "", phone = "") => ({
  manufacturer: userName || "",
  manufacturerAddress: "",
  manufacturerWebsite: "",
  manufacturerEmail: "",
  manufacturerPhone: phone || "",
  manufacturerLogo: "",
});
const getLegacyManufacturerDetails = (userName = getSavedUser(), phone = getSavedPhone()) => ({
  manufacturer:
    window.localStorage.getItem("labelUserManufacturer") ||
    window.localStorage.getItem("labelUserName") ||
    userName ||
    "",
  manufacturerAddress: window.localStorage.getItem("labelUserManufacturerAddress") || "",
  manufacturerWebsite: window.localStorage.getItem("labelUserManufacturerWebsite") || "",
  manufacturerEmail: window.localStorage.getItem("labelUserManufacturerEmail") || "",
  manufacturerPhone: window.localStorage.getItem("labelUserManufacturerPhone") || phone || "",
  manufacturerLogo: window.localStorage.getItem("labelUserManufacturerLogo") || "",
});
const getSavedManufacturerDetails = (userName = getSavedUser(), phone = getSavedPhone()) => {
  const key = getProfileStorageKey(phone);

  if (key) {
    try {
      const savedProfile = JSON.parse(window.localStorage.getItem(key) || "null");

      if (savedProfile) {
        return {
          ...emptyManufacturerDetails(userName, phone),
          manufacturer: savedProfile.manufacturer || savedProfile.name || userName || "",
          manufacturerAddress: savedProfile.manufacturerAddress || "",
          manufacturerWebsite: savedProfile.manufacturerWebsite || "",
          manufacturerEmail: savedProfile.manufacturerEmail || "",
          manufacturerPhone: savedProfile.manufacturerPhone || savedProfile.phone || phone || "",
          manufacturerLogo: savedProfile.manufacturerLogo || "",
        };
      }
    } catch (err) {
      console.error("Could not read saved profile", err);
    }
  }

  // Only use the old unscoped localStorage profile for the same phone number.
  // This avoids leaking one vendor's manufacturer details into another login.
  if (phone && window.localStorage.getItem("labelUserPhone") === phone) {
    return getLegacyManufacturerDetails(userName, phone);
  }

  return emptyManufacturerDetails(userName, phone);
};

const saveUserProfileLocally = (user = {}) => {
  if (user.name) {
    window.localStorage.setItem("labelUserName", user.name);
  }

  if (user.phone) {
    window.localStorage.setItem("labelUserPhone", user.phone);
  }

  window.localStorage.setItem("labelUserManufacturer", user.manufacturer || user.name || "");
  window.localStorage.setItem("labelUserManufacturerAddress", user.manufacturerAddress || "");
  window.localStorage.setItem("labelUserManufacturerWebsite", user.manufacturerWebsite || "");
  window.localStorage.setItem("labelUserManufacturerEmail", user.manufacturerEmail || "");
  window.localStorage.setItem(
    "labelUserManufacturerPhone",
    user.manufacturerPhone || user.phone || ""
  );
  window.localStorage.setItem("labelUserManufacturerLogo", user.manufacturerLogo || "");

  if (user.phone) {
    window.localStorage.setItem(
      getProfileStorageKey(user.phone),
      JSON.stringify({
        phone: user.phone,
        name: user.name || user.phone,
        manufacturer: user.manufacturer || user.name || "",
        manufacturerAddress: user.manufacturerAddress || "",
        manufacturerWebsite: user.manufacturerWebsite || "",
        manufacturerEmail: user.manufacturerEmail || "",
        manufacturerPhone: user.manufacturerPhone || user.phone || "",
        manufacturerLogo: user.manufacturerLogo || "",
      })
    );
  }
};

const mergeProfileDetails = (serverUser = {}, localDetails = getSavedManufacturerDetails()) => ({
  phone: serverUser.phone || getSavedPhone(),
  name: serverUser.name || getSavedUser(),
  manufacturer: serverUser.manufacturer || localDetails.manufacturer || serverUser.name || "",
  manufacturerAddress: serverUser.manufacturerAddress || localDetails.manufacturerAddress || "",
  manufacturerWebsite: serverUser.manufacturerWebsite || localDetails.manufacturerWebsite || "",
  manufacturerEmail: serverUser.manufacturerEmail || localDetails.manufacturerEmail || "",
  manufacturerPhone:
    serverUser.manufacturerPhone ||
    localDetails.manufacturerPhone ||
    serverUser.phone ||
    getSavedPhone(),
  manufacturerLogo: serverUser.manufacturerLogo || localDetails.manufacturerLogo || "",
});

const hasProfileBackfill = (serverUser = {}, mergedUser = {}) =>
  ["manufacturer", "manufacturerAddress", "manufacturerWebsite", "manufacturerEmail", "manufacturerPhone", "manufacturerLogo"]
    .some((field) => !serverUser[field] && Boolean(mergedUser[field]));

const applyUserDefaults = (values, userName = getSavedUser()) => ({
  ...values,
  ...getSavedManufacturerDetails(userName),
});

const downloadPdfBlob = (data, fileName) => {
  const url = window.URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");

  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
};

const downloadLabelPdf = async (label) => {
  const res = await axios.get(`${API_BASE}/labels/${label._id}/pdf`, {
    responseType: "blob",
  });

  downloadPdfBlob(res.data, `label-${safeFilePart(label.drumNo || label._id)}.pdf`);
};

const downloadLabelBatchPdf = async (labels, fileName = "labels.pdf") => {
  const ownerPhone = getSavedPhone();
  const res = await axios.post(
    `${API_BASE}/labels/batch/pdf`,
    {
      ids: labels.map((label) => label._id),
      ownerPhone,
    },
    {
      responseType: "blob",
    }
  );

  downloadPdfBlob(res.data, fileName);
};

const labelsApiUrl = () => {
  const ownerPhone = getSavedPhone();
  const params = ownerPhone ? `?ownerPhone=${encodeURIComponent(ownerPhone)}` : "";

  return `${API_BASE}/labels${params}`;
};

const labelDeleteUrl = (id) => {
  const ownerPhone = getSavedPhone();
  const params = ownerPhone ? `?ownerPhone=${encodeURIComponent(ownerPhone)}` : "";

  return `${API_BASE}/labels/${id}${params}`;
};

const templatesApiUrl = () => {
  const ownerPhone = getSavedPhone();
  const params = ownerPhone ? `?ownerPhone=${encodeURIComponent(ownerPhone)}` : "";

  return `${API_BASE}/templates${params}`;
};

const templateApiUrl = (id) => `${API_BASE}/templates/${id}`;

const emptyTemplateField = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  label: "",
  type: "text",
  required: false,
  defaultValue: "",
  position: "bottom",
  order: 100,
});

const emptyTemplateDraft = () => ({
  name: "",
  productName: "",
  defaults: {
    formatNo: "AE/API/ST/SOP-11/F1-00",
    commodity: "",
    warningText: "",
    storage: "",
    license: "",
    bestBeforeGap: "2",
  },
  fieldSettings: defaultTemplateFieldSettings(),
  customFields: [emptyTemplateField()],
});

const normalizeTemplateFieldKey = (value = "", fallback = "field") =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;

const buildTemplatePayload = (draft, ownerPhone = getSavedPhone()) => ({
  ownerPhone,
  name: draft.name.trim(),
  productName: draft.productName.trim() || draft.name.trim(),
  defaults: {
    formatNo: draft.defaults.formatNo.trim(),
    commodity: draft.defaults.commodity.trim() || draft.productName.trim(),
    warningText: draft.defaults.warningText.trim(),
    storage: draft.defaults.storage.trim(),
    license: draft.defaults.license.trim(),
    bestBeforeGap: draft.defaults.bestBeforeGap || "2",
  },
  fieldSettings: draft.fieldSettings.map((setting) => ({
    key: setting.key,
    label:
      setting.label.trim() ||
      customizableTemplateFields.find((field) => field.key === setting.key)?.label ||
      setting.key,
    visible: setting.visible !== false,
    defaultValue: setting.defaultValue.trim(),
    position:
      setting.visible === false
        ? "hidden"
        : normalizeTemplatePosition(setting.position),
    order: Number(setting.order) || 0,
  })),
  customFields: draft.customFields
    .map((field, index) => ({
      key: normalizeTemplateFieldKey(field.label, `field_${index + 1}`),
      label: field.label.trim(),
      type: field.type || "text",
      required: Boolean(field.required),
      defaultValue: field.defaultValue.trim(),
      position: normalizeTemplatePosition(field.position || "bottom"),
      order: Number(field.order) || index + 100,
    }))
    .filter((field) => field.label),
});

const templateToDraft = (template = {}) => ({
  name: template.name || "",
  productName: template.productName || "",
  defaults: {
    formatNo: template.defaults?.formatNo || "AE/API/ST/SOP-11/F1-00",
    commodity: template.defaults?.commodity || "",
    warningText: template.defaults?.warningText || "",
    storage: template.defaults?.storage || "",
    license: template.defaults?.license || "",
    bestBeforeGap: template.defaults?.bestBeforeGap || "2",
  },
  fieldSettings: defaultTemplateFieldSettings().map((setting) => {
    const savedSetting = (template.fieldSettings || []).find((item) => item.key === setting.key);

    return {
      ...setting,
      ...savedSetting,
      visible: savedSetting?.visible !== false,
      position: normalizeTemplatePosition(
        savedSetting?.position || setting.position
      ),
      order: Number(savedSetting?.order || setting.order) || setting.order,
    };
  }),
  customFields: template.customFields?.length
    ? template.customFields.map((field) => ({
        ...emptyTemplateField(),
        ...field,
        position: normalizeTemplatePosition(field.position || "bottom"),
        order: Number(field.order) || 100,
      }))
    : [emptyTemplateField()],
});

const templateFieldSettingMap = (template) =>
  (template?.fieldSettings || []).reduce((items, setting) => {
    items[setting.key] = setting;
    return items;
  }, {});

const templateFieldLabel = (template, key, fallback) =>
  templateFieldSettingMap(template)[key]?.label || fallback;

const templateFieldVisible = (template, key) => {
  const setting = templateFieldSettingMap(template)[key];
  return !setting || (setting.visible !== false && setting.position !== "hidden");
};

const templateFieldDefault = (template, key) =>
  templateFieldSettingMap(template)[key]?.defaultValue || "";

const templateFieldLabelsPayload = (template) =>
  (template?.fieldSettings || []).reduce((items, setting) => {
    if (setting.label) {
      items[setting.key] = setting.label;
    }
    return items;
  }, {});

const templateHiddenFieldsPayload = (template) =>
  (template?.fieldSettings || [])
    .filter((setting) => setting.visible === false || setting.position === "hidden")
    .map((setting) => setting.key);

const templatePreviewFallbacks = {
  formatNo: "AE/API/ST/SOP-11/F1-00",
  drumNo: "1/8",
  commodity: "L-CARNITINE BASE",
  lotNo: "AE/API/1102",
  poNo: "ANE-PO-2026-24/006",
  mfgDate: "03/05/2026",
  bestBefore: "02/05/2028",
  netWt: "25.000 KGS.",
  tareWt: "3.640 KGS.",
  grossWt: "28.640 KGS.",
  customerName: "DHARMANADAN EXPORT PVT.LTD.",
  customerAddress: "AHMEDABAD - 382427",
  warningText: '"NOT FOR MEDICINAL USE"',
  storage: "COOL AND DRY PLACE",
  license: "10016051001567",
  manufacturer: "AGGARWWAL EXPORTS",
  manufacturerAddress: "B/6-9, ROSHAN BAGH INDUSTRIAL ESTATE",
  manufacturerWebsite: "www.example.com",
  manufacturerEmail: "info@example.com",
  manufacturerPhone: "+91-9000000000",
};

const previewValueForField = (template, key, values = {}) => {
  const value = values[key] || templateFieldDefault(template, key);

  return value || template?.defaults?.[key] || templatePreviewFallbacks[key] || "Sample value";
};

const templatePreviewFields = (template = {}, values = {}) => {
  const builtInFields = (template.fieldSettings || defaultTemplateFieldSettings())
    .filter((setting) => setting.visible !== false && setting.position !== "hidden")
    .map((setting) => ({
      key: setting.key,
      label:
        setting.label ||
        customizableTemplateFields.find((field) => field.key === setting.key)?.label ||
        setting.key,
      value: previewValueForField(template, setting.key, values),
      position: normalizeTemplatePosition(setting.position),
      order: Number(setting.order) || 0,
    }));

  const customFields = (template.customFields || [])
    .filter((field) => field.label && field.position !== "hidden")
    .map((field, index) => ({
      key: field.key || `custom_${index}`,
      label: field.label,
      value: values[field.key] || field.defaultValue || "Custom value",
      position: normalizeTemplatePosition(field.position || "bottom"),
      order: Number(field.order) || index + 100,
    }));

  return [...builtInFields, ...customFields].sort((a, b) => a.order - b.order);
};

function TemplateLayoutPreview({ template, values = {}, title = "Template Preview" }) {
  const fieldsForPreview = templatePreviewFields(template, values);
  const groups = templateLayoutPositions.reduce((items, option) => {
    if (option.value !== "hidden") {
      items[option.value] = fieldsForPreview.filter(
        (field) => normalizeTemplatePosition(field.position) === option.value
      );
    }
    return items;
  }, {});
  const renderField = (field) => (
    <div className="template-preview-row" key={field.key}>
      <span>{field.label}</span>
      <strong>{field.value}</strong>
    </div>
  );

  return (
    <section className="template-preview-card" aria-label={title}>
      <div className="section-heading">
        <p className="step-label">{title}</p>
        <h3>{template?.name || "Standard label"}</h3>
      </div>
      <div className="template-preview-sheet">
        <div className="template-preview-top">
          <div>{(groups.left || []).map(renderField)}</div>
          <div>{(groups.right || []).map(renderField)}</div>
        </div>
        {(groups.center || []).length > 0 && (
          <div className="template-preview-center">
            {(groups.center || []).map(renderField)}
          </div>
        )}
        {(groups.bottom || []).length > 0 && (
          <div className="template-preview-bottom">
            {(groups.bottom || []).map(renderField)}
          </div>
        )}
      </div>
    </section>
  );
}

const firebaseOtpErrorMessage = (err = {}) => {
  const code = err.code || "";

  if (code === "auth/operation-not-allowed") {
    return "Phone OTP is not enabled in Firebase Authentication.";
  }

  if (code === "auth/unauthorized-domain") {
    return "This website domain is not authorized in Firebase Authentication.";
  }

  if (code === "auth/invalid-phone-number") {
    return "Enter phone number with country code, for example +919639011349.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many OTP attempts. Please wait and try again.";
  }

  if (code === "auth/billing-not-enabled") {
    return "Firebase phone OTP needs billing enabled for this project.";
  }

  return err.message ? `${err.message} (${code || "Firebase OTP"})` : "Could not send OTP.";
};

const firebaseVerifyErrorMessage = (err = {}) => {
  const code = err.code || "";

  if (code === "auth/invalid-verification-code") {
    return "Incorrect OTP. Please enter the latest code sent to this phone.";
  }

  if (code === "auth/code-expired" || code === "auth/session-expired") {
    return "OTP expired. Please request a new OTP.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait and try again.";
  }

  if (code === "auth/missing-verification-code") {
    return "Enter the 6 digit OTP.";
  }

  return err.message
    ? `${err.message} (${code || "Firebase OTP"})`
    : "Could not verify OTP.";
};

function DeleteConfirmDialog({ labelName, onCancel, onConfirm, busy }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <p className="eyebrow">Delete label</p>
        <h2 id="delete-title">Remove this label?</h2>
        <p>{labelName} will be deleted from history. This action cannot be undone.</p>
        <div className="confirm-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting..." : "Delete"}
          </button>
        </div>
      </section>
    </div>
  );
}

function BrandLockup({ compact = false }) {
  return (
    <div className={compact ? "brand-lockup compact-brand" : "brand-lockup"}>
      <img className="brand-logo" src="/brand-assets/batchmark-logo.png" alt="BatchMark" />
    </div>
  );
}

function AppNav({ currentUser = "", onLogout }) {
  const currentPath = window.location.pathname;
  const appLinks = currentUser
    ? [
        { href: "/home", label: "Home" },
        { href: "/create", label: "Create" },
        { href: "/templates", label: "Templates" },
        { href: "/history", label: "History" },
        { href: "/profile", label: "Profile" },
      ]
    : [
        { href: "/", label: "Overview" },
        { href: "/features", label: "Features" },
        { href: "/contact", label: "Contact" },
        { href: "/login", label: "Login" },
      ];
  const isActive = (href) =>
    href === "/home" ? currentPath === "/home" : currentPath === href;

  return (
    <nav className="product-nav" aria-label="Primary navigation">
      <a className="nav-brand" href={currentUser ? "/home" : "/"}>
        <BrandLockup compact />
      </a>
      <div className="nav-menu">
        {appLinks.map((link) => (
          <a
            key={link.href}
            className={isActive(link.href) ? "nav-link active" : "nav-link"}
            href={link.href}
          >
            {link.label}
          </a>
        ))}
      </div>
      {currentUser && (
        <button className="nav-logout" type="button" onClick={onLogout}>
          Logout
        </button>
      )}
    </nav>
  );
}

function LandingPage({ currentUser, onLogout }) {
  const handlePrimaryAction = () => {
    window.location.href = currentUser ? "/create" : "/login";
  };

  return (
    <main className="page-shell landing-shell">
      <AppNav currentUser={currentUser} onLogout={onLogout} />

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Batch label system</p>
          <h1>BatchMark</h1>
          <p>
            A simple web tool for vendors who create drum labels, QR verification links,
            manufacturer records, and batch PDF files without rebuilding the same label by hand.
          </p>
          <div className="landing-actions">
            <button type="button" onClick={handlePrimaryAction}>
              {currentUser ? "Create a Label" : "Login to Start"}
            </button>
            <a className="secondary-link-button" href="/features">
              View Features
            </a>
          </div>
          <div className="landing-metrics" aria-label="BatchMark highlights">
            <span>Bulk drum labels</span>
            <span>Public QR pages</span>
            <span>Saved history</span>
          </div>
        </div>

        <div className="landing-preview" aria-label="BatchMark label preview">
          <div className="preview-label-sheet">
            <div className="preview-label-top">
              <span>DRUM NO.</span>
              <strong>1/100</strong>
            </div>
            <div className="preview-label-row">
              <span>COMMODITY</span>
              <strong>L-CARNITINE BASE</strong>
            </div>
            <div className="preview-label-row">
              <span>LOT NO.</span>
              <strong>AE/API/1102</strong>
            </div>
            <div className="preview-label-row">
              <span>NET WT.</span>
              <strong>25.000 KGS.</strong>
            </div>
            <div className="preview-label-row">
              <span>GROSS WT.</span>
              <strong>28.640 KGS.</strong>
            </div>
            <div className="preview-qr" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>PDF labels with QR records for buyers and internal teams.</p>
          </div>
        </div>
      </section>

      <section className="landing-feature-grid" aria-label="BatchMark benefits">
        <article>
          <span className="feature-number">01</span>
          <h2>Generate labels faster</h2>
          <p>Create one label or a complete drum batch with automatic drum numbering and gross weight calculation.</p>
        </article>
        <article>
          <span className="feature-number">02</span>
          <h2>Share safe QR records</h2>
          <p>Each QR opens a public label record while private dashboard, profile, and history stay protected.</p>
        </article>
        <article>
          <span className="feature-number">03</span>
          <h2>Reuse vendor details</h2>
          <p>Manufacturer logo, address, contact details, and label settings stay ready for future batches.</p>
        </article>
      </section>

      <section className="landing-flow">
        <div>
          <p className="eyebrow">How it works</p>
          <h2>From batch details to PDF in a clean workflow.</h2>
        </div>
        <ol>
          <li>Login with phone OTP.</li>
          <li>Add product, lot, dates, buyer, and compliance details.</li>
          <li>Generate drum rows manually, by quick setup, or from a sheet.</li>
          <li>Download PDFs and keep every label in history.</li>
        </ol>
      </section>

      <AppFooter />
    </main>
  );
}

function AppFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand-copy">
        <BrandLockup compact />
        <p>Precision label software for batch, drum, and QR-based product records.</p>
      </div>
      <nav className="footer-links" aria-label="Footer navigation">
        <a href="/about">About</a>
        <a href="/features">Features</a>
        <a href="/contact">Contact</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </nav>
    </footer>
  );
}

function LoginPage({ onLogin }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("phone");
  const [devOtp, setDevOtp] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [firebaseConfirmation, setFirebaseConfirmation] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    if (step === "phone") {
      if (hasFirebaseWebConfig) {
        sendFirebaseOtp(phone)
          .then((confirmation) => {
            setFirebaseConfirmation(confirmation);
            setDevOtp("");
            setStep("otp");
            setStatus("OTP sent to the phone number.");
          })
          .catch((err) => {
            console.error(err);
            setStatus(firebaseOtpErrorMessage(err));
          })
          .finally(() => setIsSubmitting(false));

        return;
      }

      axios
        .post(`${API_BASE}/auth/request-otp`, { name, phone })
        .then((res) => {
          setDevOtp(res.data.devOtp || "");
          setStep("otp");
          setStatus("OTP sent to the phone number.");
        })
        .catch((err) => {
          setStatus(err.response?.data?.message || "Could not send OTP.");
        })
        .finally(() => setIsSubmitting(false));

      return;
    }

    const cleanOtp = otp.replace(/\D/g, "");

    if (step === "otp" && cleanOtp.length !== 6) {
      setStatus("Enter the 6 digit OTP.");
      setIsSubmitting(false);
      return;
    }

    if (firebaseConfirmation) {
      firebaseConfirmation
        .confirm(cleanOtp)
        .then((result) => result.user.getIdToken())
        .then((idToken) => axios.post(`${API_BASE}/auth/firebase-login`, { name, idToken }))
        .then((res) => {
          const user = res.data.user || {};
          const userName = user.name || name.trim() || phone;
          const userPhone = user.phone || phone;
          const localDetails = getSavedManufacturerDetails(userName, userPhone);
          const mergedUser = mergeProfileDetails(
            { ...user, name: userName, phone: userPhone },
            localDetails
          );

          saveUserProfileLocally(mergedUser);
          if (hasProfileBackfill(user, mergedUser)) {
            axios.put(`${API_BASE}/auth/profile`, mergedUser).catch((err) => {
              console.error("Could not migrate local profile to Firebase", err);
            });
          }
          onLogin(mergedUser.name || userName);
          window.history.pushState({}, "", "/home");
        })
        .catch((err) => {
          console.error(err);
          setStatus(firebaseVerifyErrorMessage(err));
        })
        .finally(() => setIsSubmitting(false));

      return;
    }

    axios
      .post(`${API_BASE}/auth/verify-otp`, { name, phone, otp })
      .then((res) => {
        const user = res.data.user || {};
        const userName = user.name || name.trim() || phone;
        const userPhone = user.phone || phone;
        const localDetails = getSavedManufacturerDetails(userName, userPhone);
        const mergedUser = mergeProfileDetails(
          { ...user, name: userName, phone: userPhone },
          localDetails
        );

        saveUserProfileLocally(mergedUser);
        if (hasProfileBackfill(user, mergedUser)) {
          axios.put(`${API_BASE}/auth/profile`, mergedUser).catch((err) => {
            console.error("Could not migrate local profile to MongoDB", err);
          });
        }
        onLogin(mergedUser.name || userName);
        window.history.pushState({}, "", "/home");
      })
      .catch((err) => {
        setStatus(err.response?.data?.message || "Could not verify OTP.");
      })
      .finally(() => setIsSubmitting(false));
  };

  return (
    <main className="auth-shell">
      <section className="login-card">
        <div>
          <BrandLockup />
          <h1>Sign in</h1>
          <p className="login-copy">
            Verify your phone number and continue to your secure label workspace.
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vendor name"
              disabled={step === "otp"}
              autoFocus
              required
            />
          </label>

          <label className="field">
            <span>Phone Number</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              inputMode="tel"
              disabled={step === "otp"}
              required
            />
          </label>

          {step === "otp" && (
            <label className="field">
              <span>OTP</span>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 digit OTP"
                inputMode="numeric"
                maxLength="6"
                required
              />
            </label>
          )}

          {status && <p className="login-status">{status}</p>}
          {devOtp && <p className="login-status">Development OTP: {devOtp}</p>}

          <div className="login-actions">
            {step === "otp" && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setDevOtp("");
                  setStatus("");
                  setFirebaseConfirmation(null);
                }}
              >
                Change Number
              </button>
            )}
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Please wait..." : step === "phone" ? "Send OTP" : "Verify OTP"}
            </button>
          </div>
          <div id="firebase-recaptcha" />
        </form>
      </section>
      <AppFooter />
    </main>
  );
}

function ProfilePage({ userName, onUserUpdate, onLogout }) {
  const [name, setName] = useState(userName);
  const [phone, setPhone] = useState(getSavedPhone);
  const [manufacturerDetails, setManufacturerDetails] = useState(() =>
    getSavedManufacturerDetails(userName)
  );
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const manufacturer = manufacturerDetails.manufacturer;

  const handleManufacturerChange = (field, value) => {
    setManufacturerDetails((details) => ({ ...details, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextName = name.trim() || "Vendor";
    const nextPhone = phone.trim();
    const nextManufacturer = manufacturer.trim() || nextName;
    const payload = {
      phone: nextPhone,
      name: nextName,
      manufacturer: nextManufacturer,
      manufacturerAddress: manufacturerDetails.manufacturerAddress.trim(),
      manufacturerWebsite: manufacturerDetails.manufacturerWebsite.trim(),
      manufacturerEmail: manufacturerDetails.manufacturerEmail.trim(),
      manufacturerPhone: manufacturerDetails.manufacturerPhone.trim() || nextPhone,
      manufacturerLogo: manufacturerDetails.manufacturerLogo,
    };

    setIsSaving(true);
    setStatus("");

    try {
      const res = await axios.put(`${API_BASE}/auth/profile`, payload);
      const savedUser = res.data.user || payload;

      saveUserProfileLocally(savedUser);
      setName(savedUser.name || nextName);
      setPhone(savedUser.phone || nextPhone);
      setManufacturerDetails(getSavedManufacturerDetails(savedUser.name || nextName, savedUser.phone || nextPhone));
      onUserUpdate(savedUser.name || nextName);
      setStatus("Profile saved.");
    } catch (err) {
      console.error(err);
      saveUserProfileLocally(payload);
      onUserUpdate(nextName);
      setStatus("Profile saved on this device. Server save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("Please choose an image file for the logo.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      handleManufacturerChange("manufacturerLogo", reader.result || "");
      setStatus("Logo selected. Save profile to keep it.");
    };
    reader.onerror = () => setStatus("Could not read this logo file.");
    reader.readAsDataURL(file);
  };

  return (
    <main className="page-shell">
      <AppNav currentUser={userName} onLogout={onLogout} />
      <header className="app-topbar">
        <div>
          <h1>Profile</h1>
          <p className="header-copy">Manage the manufacturer details printed on every label.</p>
        </div>
      </header>

      <section className="profile-card">
        <div className="profile-summary">
          <div className="profile-avatar" aria-hidden="true">
            {manufacturerDetails.manufacturerLogo ? (
              <img src={manufacturerDetails.manufacturerLogo} alt="" />
            ) : (
              (name.trim() || "V").slice(0, 1).toUpperCase()
            )}
          </div>
          <div>
            <p className="eyebrow">Vendor Profile</p>
            <h2>{name.trim() || "Vendor"}</h2>
            <p>{phone || "No phone number saved"}</p>
            <p>Manufacturer: {manufacturer.trim() || name.trim() || "Vendor"}</p>
          </div>
        </div>

        <form className="profile-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Phone Number</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              required
            />
          </label>
          <label className="field">
            <span>Manufacturer Name</span>
            <input
              value={manufacturer}
              onChange={(e) => handleManufacturerChange("manufacturer", e.target.value)}
              placeholder={name.trim() || "Manufacturer name"}
              required
            />
          </label>
          <label className="field">
            <span>Manufacturer Logo</span>
            <input type="file" accept="image/*" onChange={handleLogoUpload} />
            <small>Upload PNG or JPG. It will appear on the PDF manufacturer block.</small>
          </label>
          {manufacturerDetails.manufacturerLogo && (
            <div className="logo-preview">
              <img src={manufacturerDetails.manufacturerLogo} alt="Manufacturer logo preview" />
              <button
                className="secondary-button"
                type="button"
                onClick={() => handleManufacturerChange("manufacturerLogo", "")}
              >
                Remove Logo
              </button>
            </div>
          )}
          <label className="field">
            <span>Manufacturer Address</span>
            <textarea
              value={manufacturerDetails.manufacturerAddress}
              onChange={(e) =>
                handleManufacturerChange("manufacturerAddress", e.target.value)
              }
              placeholder="B/6-9, Roshan Bagh Industrial Estate, Rampur-244901, (U.P.) India"
              rows="3"
            />
          </label>
          <label className="field">
            <span>Website</span>
            <input
              value={manufacturerDetails.manufacturerWebsite}
              onChange={(e) =>
                handleManufacturerChange("manufacturerWebsite", e.target.value)
              }
              placeholder="www.example.com"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              value={manufacturerDetails.manufacturerEmail}
              onChange={(e) =>
                handleManufacturerChange("manufacturerEmail", e.target.value)
              }
              placeholder="email@example.com"
            />
          </label>
          <label className="field">
            <span>Cell / Phone</span>
            <input
              value={manufacturerDetails.manufacturerPhone}
              onChange={(e) =>
                handleManufacturerChange("manufacturerPhone", e.target.value)
              }
              placeholder="+91-9876543210"
            />
          </label>
          {status && <p className="login-status">{status}</p>}
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Profile"}
          </button>
        </form>
      </section>
    </main>
  );
}

function HomePage({ userName, onLogout }) {
  const [labels, setLabels] = useState([]);

  useEffect(() => {
    let active = true;

    axios
      .get(labelsApiUrl())
      .then((res) => {
        if (active) {
          setLabels(res.data);
        }
      })
      .catch(() => {
        if (active) {
          setLabels([]);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const recentLabels = labels.slice(0, 4);
  const latestLabel = labels[0];

  return (
    <main className="page-shell">
      <AppNav currentUser={userName} onLogout={onLogout} />
      <header className="app-topbar">
        <div>
          <h1>Dashboard</h1>
          <p className="header-copy">A quick view of your latest BatchMark activity.</p>
        </div>
      </header>

      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Welcome, {userName}</p>
          <h2>Manage drum labels in one place.</h2>
          <p>
            Create batch PDFs, keep manufacturer details ready, and find old labels without
            digging through downloads.
          </p>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span>Total Labels</span>
          <strong>{labels.length}</strong>
        </div>
        <div className="stat-card">
          <span>Latest Drum</span>
          <strong>{latestLabel?.drumNo || "-"}</strong>
        </div>
        <div className="stat-card">
          <span>Latest Lot</span>
          <strong>{latestLabel?.lotNo || "-"}</strong>
        </div>
      </section>

      <section className="history-card home-history">
        <div className="history-toolbar">
          <div>
            <h2>Recent labels</h2>
            <p>{labels.length} saved label record(s)</p>
          </div>
        </div>

        {recentLabels.length === 0 ? (
          <p className="empty-state">No labels created yet.</p>
        ) : (
          <div className="history-list">
            {recentLabels.map((label) => (
              <article className="history-row compact-history-row" key={label._id}>
                <div>
                  <p className="history-title">{label.commodity || "Untitled Label"}</p>
                  <p className="history-meta">
                    Drum {label.drumNo || "-"} · Lot {label.lotNo || "-"}
                  </p>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatHistoryDate(label.createdAt)}</dd>
                </div>
                <div className="row-actions">
                  <a className="button-link row-action secondary-link" href={`/label/${label._id}`}>
                    View
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <AppFooter />
    </main>
  );
}

function HistoryPage({ currentUser, onLogout }) {
  const [labels, setLabels] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("loading");
  const [downloadingId, setDownloadingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [labelToDelete, setLabelToDelete] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState("");
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState([]);

  useEffect(() => {
    let active = true;

    axios
      .get(labelsApiUrl())
      .then((res) => {
        if (active) {
          setLabels(res.data);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredLabels = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) {
      return labels;
    }

    return labels.filter((label) =>
      [
        label.drumNo,
        label.commodity,
        label.lotNo,
        label.poNo,
        label.customerName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [labels, query]);
  const historyGroups = useMemo(() => groupHistoryLabels(filteredLabels), [filteredLabels]);
  const historySections = useMemo(() => groupHistoryByDay(historyGroups), [historyGroups]);
  const selectedLabels = useMemo(
    () => labels.filter((label) => selectedIds.includes(label._id)),
    [labels, selectedIds]
  );
  const visibleIds = useMemo(() => filteredLabels.map((label) => label._id), [filteredLabels]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleSelected = (id) => {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  };

  const toggleGroupExpanded = (key) => {
    setExpandedGroupKeys((keys) =>
      keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
    );
  };

  const toggleGroupSelection = (group) => {
    const groupIds = group.labels.map((label) => label._id);
    const groupSelected = groupIds.every((id) => selectedIds.includes(id));

    setSelectedIds((ids) => {
      if (groupSelected) {
        return ids.filter((id) => !groupIds.includes(id));
      }

      return Array.from(new Set([...ids, ...groupIds]));
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((ids) => {
      if (allVisibleSelected) {
        return ids.filter((id) => !visibleIds.includes(id));
      }

      return Array.from(new Set([...ids, ...visibleIds]));
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const handleHistoryDownload = async (label) => {
    setDownloadingId(label._id);

    try {
      await downloadLabelPdf(label);
    } catch (err) {
      console.error(err);
      alert("Could not download this label.");
    } finally {
      setDownloadingId("");
    }
  };

  const handleGroupDownload = async (group) => {
    setBulkAction(`download:${group.key}`);

    try {
      await downloadLabelBatchPdf(
        group.labels,
        `batch-${safeFilePart(group.commodity)}-${safeFilePart(group.lotNo)}.pdf`
      );
    } catch (err) {
      console.error(err);
      alert("Could not download this batch.");
    } finally {
      setBulkAction("");
    }
  };

  const handleGroupDeleteRequest = (group) => {
    setSelectedIds(group.labels.map((label) => label._id));
    setShowBulkDeleteDialog(true);
  };

  const confirmHistoryDelete = async () => {
    if (!labelToDelete) {
      return;
    }

    setDeletingId(labelToDelete._id);

    try {
      await axios.delete(labelDeleteUrl(labelToDelete._id));
      setLabels((items) => items.filter((item) => item._id !== labelToDelete._id));
      setLabelToDelete(null);
    } catch (err) {
      console.error(err);
      alert("Could not delete this label.");
    } finally {
      setDeletingId("");
    }
  };

  const handleBulkDownload = async () => {
    if (!selectedLabels.length) {
      return;
    }

    setBulkAction("download");

    try {
      await downloadLabelBatchPdf(selectedLabels, `batchmark-${selectedLabels.length}-labels.pdf`);
    } catch (err) {
      console.error(err);
      alert("Could not download all selected labels.");
    } finally {
      setBulkAction("");
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedLabels.length) {
      return;
    }

    setBulkAction("delete");

    try {
      await Promise.all(selectedLabels.map((label) => axios.delete(labelDeleteUrl(label._id))));
      setLabels((items) => items.filter((item) => !selectedIds.includes(item._id)));
      clearSelection();
      setShowBulkDeleteDialog(false);
    } catch (err) {
      console.error(err);
      alert("Could not delete all selected labels.");
    } finally {
      setBulkAction("");
    }
  };

  return (
    <main className="page-shell">
      <AppNav currentUser={currentUser} onLogout={onLogout} />
      <header className="site-header">
        <div>
          <h1>Created Labels</h1>
          <p className="header-copy">Grouped by batch so old PDF labels stay easy to find.</p>
        </div>
      </header>

      <section className="history-card">
        <div className="history-toolbar">
          <div>
            <h2>Batch archive</h2>
            <p>
              {pluralize(labels.length, "label")} · {pluralize(historyGroups.length, "batch")}
            </p>
          </div>
          <label className="search-field">
            <span>Search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Drum, lot, PO, customer..."
            />
          </label>
        </div>

        {status === "ready" && filteredLabels.length > 0 && (
          <div className="bulk-toolbar">
            <label className="select-all-control">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleVisibleSelection}
              />
              <span>Select visible</span>
            </label>
            <p>
              {pluralize(historyGroups.length, "batch")} visible · {selectedIds.length} selected
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={handleBulkDownload}
              disabled={!selectedIds.length || Boolean(bulkAction)}
            >
              {bulkAction === "download" ? "Downloading..." : "Download"}
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={!selectedIds.length || Boolean(bulkAction)}
            >
              {bulkAction === "delete" ? "Deleting..." : "Delete"}
            </button>
            {selectedIds.length > 0 && (
              <button
                className="secondary-button"
                type="button"
                onClick={clearSelection}
                disabled={Boolean(bulkAction)}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {status === "loading" && <p className="empty-state">Loading history...</p>}
        {status === "error" && (
          <p className="empty-state">Could not load history. Check the backend server.</p>
        )}
        {status === "ready" && filteredLabels.length === 0 && (
          <p className="empty-state">No labels found.</p>
        )}

        {status === "ready" && filteredLabels.length > 0 && (
          <div className="history-archive">
            {historySections.map((section) => (
              <section className="history-day-section" key={section.day}>
                <div className="history-day-heading">
                  <div>
                    <p className="eyebrow">Created</p>
                    <h2>{section.day}</h2>
                  </div>
                  <span>
                    {pluralize(section.groups.length, "batch")} ·{" "}
                    {pluralize(section.labelCount, "label")}
                  </span>
                </div>

                <div className="history-groups">
                  {section.groups.map((group) => {
              const isExpanded =
                expandedGroupKeys.includes(group.key) ||
                (query.trim() && historyGroups.length <= 3);
              const groupIds = group.labels.map((label) => label._id);
              const groupSelected = groupIds.every((id) => selectedIds.includes(id));
              const someGroupSelected = groupIds.some((id) => selectedIds.includes(id));

              return (
                <article className="history-group" key={group.key}>
                  <div className="history-group-main">
                    <label className="row-select" aria-label={`Select ${group.commodity}`}>
                      <input
                        type="checkbox"
                        checked={groupSelected}
                        ref={(input) => {
                          if (input) {
                            input.indeterminate = someGroupSelected && !groupSelected;
                          }
                        }}
                        onChange={() => toggleGroupSelection(group)}
                      />
                    </label>
                    <button
                      className="group-toggle"
                      type="button"
                      onClick={() => toggleGroupExpanded(group.key)}
                      aria-expanded={isExpanded}
                    >
                      <span aria-hidden="true">{isExpanded ? "−" : "+"}</span>
                    </button>
                    <div className="history-group-title">
                      <p className="history-title">{group.commodity}</p>
                      <div className="history-chips" aria-label="Batch details">
                        <span>Lot {group.lotNo}</span>
                        <span>P.O. {group.poNo}</span>
                        <span>{pluralize(group.labels.length, "label")}</span>
                        <span>{group.customerName}</span>
                      </div>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{getHistoryTime(group.createdAt)}</dd>
                    </div>
                    <div className="row-actions">
                      <button
                        className="row-action secondary-button"
                        type="button"
                        onClick={() => handleGroupDownload(group)}
                        disabled={Boolean(bulkAction)}
                      >
                        {bulkAction === `download:${group.key}` ? "Downloading..." : "PDF"}
                      </button>
                      <button
                        className="row-action danger-button"
                        type="button"
                        onClick={() => handleGroupDeleteRequest(group)}
                        disabled={Boolean(bulkAction)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="history-group-items">
                      {group.labels.map((label) => (
                        <article className="history-row selectable-history-row" key={label._id}>
                          <label className="row-select" aria-label={`Select ${getLabelName(label)}`}>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(label._id)}
                              onChange={() => toggleSelected(label._id)}
                            />
                          </label>
                          <div>
                            <p className="history-title">Drum {label.drumNo || "-"}</p>
                            <p className="history-meta">
                              {label.netWt || "-"} net · {label.grossWt || "-"} gross
                            </p>
                          </div>
                          <div>
                            <dt>Lot</dt>
                            <dd>{label.lotNo || "-"}</dd>
                          </div>
                          <div>
                            <dt>Created</dt>
                            <dd>{formatHistoryDate(label.createdAt)}</dd>
                          </div>
                          <div className="row-actions">
                            <a className="button-link row-action secondary-link" href={`/label/${label._id}`}>
                              View
                            </a>
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => handleHistoryDownload(label)}
                              disabled={downloadingId === label._id || deletingId === label._id}
                            >
                              {downloadingId === label._id ? "Downloading..." : "PDF"}
                            </button>
                            <button
                              className="row-action danger-button"
                              type="button"
                              onClick={() => setLabelToDelete(label)}
                              disabled={deletingId === label._id || downloadingId === label._id}
                            >
                              {deletingId === label._id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </article>
              );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {labelToDelete && (
        <DeleteConfirmDialog
          labelName={getLabelName(labelToDelete)}
          onCancel={() => setLabelToDelete(null)}
          onConfirm={confirmHistoryDelete}
          busy={deletingId === labelToDelete._id}
        />
      )}
      {showBulkDeleteDialog && (
        <DeleteConfirmDialog
          labelName={`${selectedLabels.length} selected label(s)`}
          onCancel={() => setShowBulkDeleteDialog(false)}
          onConfirm={handleBulkDelete}
          busy={bulkAction === "delete"}
        />
      )}
      <AppFooter />
    </main>
  );
}

function TemplatesPage({ currentUser, onLogout }) {
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(emptyTemplateDraft);
  const [editingId, setEditingId] = useState("");
  const [status, setStatus] = useState("loading");
  const [isSaving, setIsSaving] = useState(false);

  const loadTemplates = () => {
    setStatus("loading");
    axios
      .get(templatesApiUrl())
      .then((res) => {
        setTemplates(res.data || []);
        setStatus("ready");
      })
      .catch((err) => {
        console.error(err);
        setStatus("error");
      });
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const updateDraftField = (field, value) => {
    setDraft((values) => ({ ...values, [field]: value }));
  };

  const updateDraftDefault = (field, value) => {
    setDraft((values) => ({
      ...values,
      defaults: { ...values.defaults, [field]: value },
    }));
  };

  const updateFieldSetting = (key, field, value) => {
    setDraft((values) => ({
      ...values,
      fieldSettings: values.fieldSettings.map((setting) =>
        setting.key === key ? { ...setting, [field]: value } : setting
      ),
    }));
  };

  const handleTemplateLogoUpload = (key, file) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("Please choose an image file for the template logo.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      updateFieldSetting(key, "defaultValue", reader.result || "");
      setStatus("Template logo selected. Save the template to keep it.");
    };
    reader.onerror = () => setStatus("Could not read this template logo file.");
    reader.readAsDataURL(file);
  };

  const updateCustomField = (id, field, value) => {
    setDraft((values) => ({
      ...values,
      customFields: values.customFields.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addCustomField = () => {
    setDraft((values) => ({
      ...values,
      customFields: [...values.customFields, emptyTemplateField()],
    }));
  };

  const removeCustomField = (id) => {
    setDraft((values) => ({
      ...values,
      customFields:
        values.customFields.length === 1
          ? [emptyTemplateField()]
          : values.customFields.filter((field) => field.id !== id),
    }));
  };

  const resetDraft = () => {
    setDraft(emptyTemplateDraft());
    setEditingId("");
  };

  const editTemplate = (template) => {
    setDraft(templateToDraft(template));
    setEditingId(template._id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTemplate = async (e) => {
    e.preventDefault();
    const payload = buildTemplatePayload(draft);

    if (!payload.name) {
      setStatus("Template name is required.");
      return;
    }

    setIsSaving(true);

    try {
      if (editingId) {
        await axios.put(templateApiUrl(editingId), payload);
      } else {
        await axios.post(templatesApiUrl(), payload);
      }
      resetDraft();
      loadTemplates();
    } catch (err) {
      console.error(err);
      setStatus(err.response?.data?.message || "Could not save this template.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTemplate = async (template) => {
    if (!window.confirm(`Delete ${template.name}?`)) {
      return;
    }

    try {
      await axios.delete(templateApiUrl(template._id), {
        data: { ownerPhone: getSavedPhone() },
      });
      setTemplates((items) => items.filter((item) => item._id !== template._id));
      if (editingId === template._id) {
        resetDraft();
      }
    } catch (err) {
      console.error(err);
      setStatus("Could not delete this template.");
    }
  };

  return (
    <main className="page-shell">
      <AppNav currentUser={currentUser} onLogout={onLogout} />
      <header className="site-header">
        <div>
          <h1>Product Templates</h1>
          <p className="header-copy">
            Save product-wise label fields so every vendor can reuse their own format.
          </p>
        </div>
      </header>

      <div className="template-layout">
        <section className="template-form-card">
          <div className="section-heading section-heading-with-action">
            <div>
              <h2>{editingId ? "Edit Template" : "New Template"}</h2>
              <p>Defaults fill the create-label form. Custom fields print on the PDF.</p>
            </div>
            {editingId && (
              <button className="secondary-button" type="button" onClick={resetDraft}>
                New
              </button>
            )}
          </div>

          <form className="template-form" onSubmit={saveTemplate}>
            <div className="form-grid">
              <label className="field">
                <span>Template Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => updateDraftField("name", e.target.value)}
                  placeholder="L-Carnitine Export Label"
                  required
                />
              </label>
              <label className="field">
                <span>Product / Commodity</span>
                <input
                  value={draft.productName}
                  onChange={(e) => {
                    updateDraftField("productName", e.target.value);
                    updateDraftDefault("commodity", e.target.value);
                  }}
                  placeholder="L-CARNITINE BASE"
                />
              </label>
              <label className="field">
                <span>Format No</span>
                <input
                  value={draft.defaults.formatNo}
                  onChange={(e) => updateDraftDefault("formatNo", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Best Before Gap</span>
                <select
                  value={draft.defaults.bestBeforeGap}
                  onChange={(e) => updateDraftDefault("bestBeforeGap", e.target.value)}
                >
                  {fieldsByName.bestBeforeGap.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Warning Text</span>
                <input
                  value={draft.defaults.warningText}
                  onChange={(e) => updateDraftDefault("warningText", e.target.value)}
                  placeholder='"NOT FOR MEDICINAL USE"'
                />
              </label>
              <label className="field">
                <span>Storage Condition</span>
                <input
                  value={draft.defaults.storage}
                  onChange={(e) => updateDraftDefault("storage", e.target.value)}
                  placeholder="Cool and dry place"
                />
              </label>
              <label className="field">
                <span>License Number</span>
                <input
                  value={draft.defaults.license}
                  onChange={(e) => updateDraftDefault("license", e.target.value)}
                />
              </label>
            </div>

            <div className="custom-field-builder custom-field-builder-primary">
              <div className="section-heading section-heading-with-action">
                <div>
                  <h3>Custom Fields</h3>
                  <p>Add only the extra fields this product needs.</p>
                </div>
                <button className="secondary-button" type="button" onClick={addCustomField}>
                  Add Field
                </button>
              </div>

              {draft.customFields.map((field) => (
                <div className="custom-field-row" key={field.id}>
                  <label>
                    <span>Field Name</span>
                    <input
                      value={field.label}
                      onChange={(e) => updateCustomField(field.id, "label", e.target.value)}
                      placeholder="Assay / Grade / CAS No."
                    />
                  </label>
                  <label>
                    <span>Type</span>
                    <select
                      value={field.type}
                      onChange={(e) => updateCustomField(field.id, "type", e.target.value)}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="textarea">Long text</option>
                    </select>
                  </label>
                  <label>
                    <span>Default Value</span>
                    <input
                      value={field.defaultValue}
                      onChange={(e) =>
                        updateCustomField(field.id, "defaultValue", e.target.value)
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    <span>Position</span>
                    <select
                      value={field.position}
                      onChange={(e) => updateCustomField(field.id, "position", e.target.value)}
                    >
                      {templateLayoutPositions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Order</span>
                    <input
                      type="number"
                      min="1"
                      value={field.order}
                      onChange={(e) => updateCustomField(field.id, "order", e.target.value)}
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateCustomField(field.id, "required", e.target.checked)
                      }
                    />
                    <span>Required</span>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => removeCustomField(field.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <details className="template-advanced">
              <summary>
                <span>Advanced field controls</span>
                <small>Rename, hide, prefill fields, or override the manufacturer logo.</small>
              </summary>
              <div className="template-field-grid">
                {draft.fieldSettings.map((setting) => {
                  const templateField = customizableTemplateFields.find(
                    (field) => field.key === setting.key
                  );

                  return (
                    <div className="template-field-row" key={setting.key}>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={setting.visible !== false}
                          onChange={(e) =>
                            updateFieldSetting(setting.key, "visible", e.target.checked)
                          }
                        />
                        <span>Show</span>
                      </label>
                      <div>
                        <p className="history-title">{templateField?.label || setting.key}</p>
                        <p className="history-meta">{templateField?.group || "Field"}</p>
                      </div>
                      <label>
                        <span>Display Name</span>
                        <input
                          value={setting.label}
                          onChange={(e) =>
                            updateFieldSetting(setting.key, "label", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>Position</span>
                        <select
                          value={setting.position}
                          onChange={(e) =>
                            updateFieldSetting(setting.key, "position", e.target.value)
                          }
                        >
                          {templateLayoutPositions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Order</span>
                        <input
                          type="number"
                          min="1"
                          value={setting.order}
                          onChange={(e) =>
                            updateFieldSetting(setting.key, "order", e.target.value)
                          }
                        />
                      </label>
                      {setting.key === "manufacturerLogo" ? (
                        <div className="template-logo-control">
                          <label>
                            <span>Logo Override</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) =>
                                handleTemplateLogoUpload(setting.key, e.target.files?.[0])
                              }
                            />
                          </label>
                          <small>Leave empty to use the profile logo for this template.</small>
                          {setting.defaultValue && (
                            <div className="logo-preview template-logo-preview">
                              <img src={setting.defaultValue} alt="Template logo preview" />
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() =>
                                  updateFieldSetting(setting.key, "defaultValue", "")
                                }
                              >
                                Use Profile Logo
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <label>
                          <span>Default Value</span>
                          <input
                            value={setting.defaultValue}
                            onChange={(e) =>
                              updateFieldSetting(setting.key, "defaultValue", e.target.value)
                            }
                            placeholder="Optional"
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>

            <TemplateLayoutPreview
              template={buildTemplatePayload(draft, currentUser?.phone || getSavedPhone())}
              title="Live Layout Preview"
            />

            {typeof status === "string" && !["loading", "ready", "error"].includes(status) && (
              <p className="status-message">{status}</p>
            )}

            <div className="template-actions">
              <button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : editingId ? "Update Template" : "Save Template"}
              </button>
              <a className="button-link secondary-link" href="/create">
                Use in Label
              </a>
            </div>
          </form>
        </section>

        <aside className="template-list-card">
          <h2>Saved Templates</h2>
          {status === "loading" && <p className="empty-state">Loading templates...</p>}
          {status === "error" && <p className="empty-state">Could not load templates.</p>}
          {status === "ready" && templates.length === 0 && (
            <p className="empty-state">No templates saved yet.</p>
          )}
          <div className="template-list">
            {templates.map((template) => (
              <article className="template-card" key={template._id}>
                <div>
                  <p className="history-title">{template.name}</p>
                  <p className="history-meta">
                    {template.productName || template.defaults?.commodity || "No product"} ·{" "}
                    {pluralize(template.customFields?.length || 0, "custom field")}
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    className="secondary-button row-action"
                    type="button"
                    onClick={() => editTemplate(template)}
                  >
                    Edit
                  </button>
                  <button
                    className="danger-button row-action"
                    type="button"
                    onClick={() => deleteTemplate(template)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
      <AppFooter />
    </main>
  );
}

function LabelDetails({ id }) {
  const [label, setLabel] = useState(null);
  const [status, setStatus] = useState("loading");
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let active = true;

    axios
      .get(`${API_BASE}/labels/${id}`)
      .then((res) => {
        if (active) {
          setLabel(res.data);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (status === "loading") {
    return <main className="page-shell page-status">Loading label...</main>;
  }

  if (status === "error") {
    return (
      <main className="page-shell page-status">
        <div className="status-card">
          <h1>Label not found</h1>
          <a className="button-link" href="/create">Create a new label</a>
        </div>
      </main>
    );
  }

  const handleDetailDownload = async () => {
    setIsDownloading(true);

    try {
      await downloadLabelPdf(label);
    } catch (err) {
      console.error(err);
      alert("Could not download this label.");
    } finally {
      setIsDownloading(false);
    }
  };

  const fieldLabels = label.fieldLabels || {};
  const hiddenFields = Array.isArray(label.hiddenFields) ? label.hiddenFields : [];
  const visibleField = (key) => !hiddenFields.includes(key);
  const displayFieldLabel = (key, fallback) => fieldLabels[key] || fallback;
  const visibleItems = (items) => items.filter((item) => visibleField(item.key));
  const verificationItems = visibleItems([
    { key: "commodity", label: displayFieldLabel("commodity", "Commodity"), value: label.commodity },
    { key: "lotNo", label: displayFieldLabel("lotNo", "Lot No"), value: label.lotNo },
    { key: "drumNo", label: displayFieldLabel("drumNo", "Drum No"), value: label.drumNo },
    { key: "poNo", label: displayFieldLabel("poNo", "P.O. No"), value: label.poNo },
    { key: "mfgDate", label: displayFieldLabel("mfgDate", "Mfg. Date"), value: label.mfgDate },
    { key: "bestBefore", label: displayFieldLabel("bestBefore", "Best Before"), value: label.bestBefore },
  ]);

  const weightItems = visibleItems([
    { key: "netWt", label: displayFieldLabel("netWt", "Net Wt."), value: label.netWt },
    { key: "tareWt", label: displayFieldLabel("tareWt", "Tare Wt."), value: label.tareWt },
    { key: "grossWt", label: displayFieldLabel("grossWt", "Gross Wt."), value: label.grossWt },
  ]);

  const manufacturerItems = visibleItems([
    {
      key: "manufacturer",
      label: displayFieldLabel("manufacturer", "Manufacturer"),
      value: label.manufacturer,
    },
    {
      key: "manufacturerAddress",
      label: displayFieldLabel("manufacturerAddress", "Address"),
      value: label.manufacturerAddress,
    },
  ]);
  const customerItems = visibleItems([
    {
      key: "customerName",
      label: displayFieldLabel("customerName", "Name"),
      value: label.customerName,
    },
    {
      key: "customerAddress",
      label: displayFieldLabel("customerAddress", "Address"),
      value: label.customerAddress,
    },
  ]);
  const complianceItems = visibleItems([
    {
      key: "warningText",
      label: displayFieldLabel("warningText", "Warning"),
      value: label.warningText,
    },
    {
      key: "storage",
      label: displayFieldLabel("storage", "Storage Condition"),
      value: label.storage,
    },
    {
      key: "license",
      label: displayFieldLabel("license", "License Number"),
      value: label.license,
    },
    {
      key: "formatNo",
      label: displayFieldLabel("formatNo", "Format No"),
      value: label.formatNo,
    },
  ]);
  const customItems = Array.isArray(label.customFields)
    ? label.customFields.filter((field) => field.value)
    : [];

  return (
    <main className="page-shell public-label-shell">
      <section className="label-preview public-label-card">
        <div className="public-verify-hero">
          <div>
            <BrandLockup compact />
            <p className="verify-badge">Verified Label Record</p>
            <h1>{label.commodity || "Generated Label"}</h1>
            <p>
              This QR code is linked to a saved BatchMark label record. Use the
              details below to verify the drum and batch information.
            </p>
          </div>
          <div className="verify-stamp" aria-hidden="true">
            <span>✓</span>
            Verified
          </div>
        </div>

        <div className="public-label-summary">
          {verificationItems.map((item) => (
            <div className="public-data-tile" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value || "-"}</dd>
            </div>
          ))}
        </div>

        <div className="public-label-sections">
          <section>
            <div className="section-heading">
              <h2>Weight Details</h2>
            </div>
            <dl className="mini-details-grid">
              {weightItems.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value || "-"}</dd>
                </div>
              ))}
            </dl>
          </section>

          {customerItems.length > 0 && (
          <section>
            <div className="section-heading">
              <h2>Customer</h2>
            </div>
            <dl className="mini-details-grid">
              {customerItems.map((item) => (
                <div key={item.key}>
                  <dt>{item.label}</dt>
                  <dd>{item.value || "-"}</dd>
                </div>
              ))}
            </dl>
          </section>
          )}
        </div>

        {manufacturerItems.length > 0 && (
        <section className="public-manufacturer-panel">
          <div className="section-heading">
            <h2>Manufacturer Details</h2>
            <p>Manufacturer information saved by the label owner.</p>
          </div>
          <dl className="details-grid">
            {manufacturerItems.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value || "-"}</dd>
              </div>
            ))}
          </dl>
        </section>
        )}

        {customItems.length > 0 && (
          <section className="public-manufacturer-panel">
            <div className="section-heading">
              <h2>Product Details</h2>
            </div>
            <dl className="details-grid">
              {customItems.map((item) => (
                <div key={item.key || item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {complianceItems.length > 0 && (
          <section className="public-manufacturer-panel">
            <div className="section-heading">
              <h2>Compliance</h2>
            </div>
            <dl className="details-grid">
              {complianceItems.map((item) => (
                <div key={item.key}>
                  <dt>{item.label}</dt>
                  <dd>{item.value || "-"}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <div className="detail-actions">
          <button type="button" onClick={handleDetailDownload} disabled={isDownloading}>
            {isDownloading ? "Downloading..." : "Download PDF"}
          </button>
        </div>
      </section>
    </main>
  );
}

function InfoPage({ page, currentUser, onLogout }) {
  const pages = {
    about: {
      eyebrow: "About BatchMark",
      title: "A simple label system for batch drum work.",
      copy:
        "BatchMark helps vendors generate QR-enabled drum labels, keep label history, and manage manufacturer details from one clean web workspace.",
      cards: [
        ["Built for vendors", "Designed around real drum labels, lot numbers, PO numbers, weights, dates, and manufacturer information."],
        ["Public QR records", "Each QR code opens a public verification page without exposing the vendor's private profile or dashboard."],
        ["Fast daily workflow", "Create many drum labels at once, download PDFs, and return later through the history archive."],
      ],
    },
    features: {
      eyebrow: "Features",
      title: "Everything needed for practical label generation.",
      copy:
        "The software focuses on the core flow: login, profile setup, batch entry, PDF generation, QR verification, and history management.",
      cards: [
        ["Batch PDF labels", "Generate labels for one drum or hundreds of drums with automatic drum sequencing."],
        ["Smart weights", "Net and tare weights create gross weight automatically, with KGS. formatting handled for PDFs."],
        ["History archive", "Search, group, download, and delete old labels without digging through local files."],
        ["Vendor profile", "Manufacturer name, address, phone, email, website, and logo are saved per logged-in vendor."],
      ],
    },
    contact: {
      eyebrow: "Contact",
      title: "Need help setting up BatchMark?",
      copy:
        "Use this page as the product contact area for vendors, clients, or support requests.",
      cards: [
        ["Email support", `Write to ${SUPPORT_EMAIL} for setup, profile, QR, PDF, or account help.`],
        ["Business use", "BatchMark can be configured for each vendor's manufacturer details and label format."],
        ["Deployment", "The current live deployment is hosted on Render with Firebase as the database."],
      ],
    },
  };
  const content = pages[page] || pages.about;

  return (
    <main className="page-shell">
      <AppNav currentUser={currentUser} onLogout={onLogout} />
      <section className="info-hero">
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p>{content.copy}</p>
      </section>
      <section className="info-grid">
        {content.cards.map(([title, copy]) => (
          <article className="info-card" key={title}>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>
      {page === "contact" && (
        <section className="contact-card">
          <p className="eyebrow">Official support email</p>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <p>Use this address for vendor onboarding, support requests, and product questions.</p>
        </section>
      )}
      <AppFooter />
    </main>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState(getSavedUser);
  const [form, setForm] = useState(() => applyUserDefaults(emptyForm));
  const [drumItems, setDrumItems] = useState([emptyDrumItem()]);
  const [visibleDrumCount, setVisibleDrumCount] = useState(DRUM_ROWS_BATCH_SIZE);
  const [bulkDrumText, setBulkDrumText] = useState("");
  const [quickDrumSetup, setQuickDrumSetup] = useState({
    count: "",
    netWt: "",
    tareWt: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [generationProgress, setGenerationProgress] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState({});
  const currentManufacturerDetails = getSavedManufacturerDetails(currentUser);
  const currentManufacturer = currentManufacturerDetails.manufacturer || currentUser;
  const currentPath = window.location.pathname;
  const isLandingPage = currentPath === "/";
  const isLoginPage = currentPath === "/login";
  const isHistoryPage = currentPath === "/history";
  const isHomePage = currentPath === "/home";
  const isProfilePage = currentPath === "/profile";
  const isTemplatesPage = currentPath === "/templates";
  const infoPage = currentPath.match(/^\/(about|features|contact)$/)?.[1];

  const labelId = useMemo(() => {
    const match = window.location.pathname.match(/^\/label\/([^/]+)$/);
    return match ? match[1] : null;
  }, []);
  const validDrumItems = useMemo(
    () => drumItems.filter((item) => item.drumNo.trim()),
    [drumItems]
  );
  const visibleDrumItems = useMemo(
    () => drumItems.slice(0, visibleDrumCount),
    [drumItems, visibleDrumCount]
  );
  const hiddenDrumCount = Math.max(drumItems.length - visibleDrumItems.length, 0);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template._id === selectedTemplateId),
    [templates, selectedTemplateId]
  );

  useEffect(() => {
    if (currentUser) {
      setForm((values) => applyUserDefaults(values, currentUser));
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setTemplates([]);
      return;
    }

    axios
      .get(templatesApiUrl())
      .then((res) => setTemplates(res.data || []))
      .catch((err) => {
        console.error(err);
        setTemplates([]);
      });
  }, [currentUser]);

  const handleChange = (e) => {
    setStatusMessage("");
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleMfgDateChange = (e) => {
    const { value } = e.target;
    const nextForm = {
      ...form,
      mfgDate: value,
      bestBefore: toInputDate(calculateBestBefore(value, form.bestBeforeGap)),
    };

    setStatusMessage("");
    setForm(nextForm);
  };

  const handleBestBeforeGapChange = (e) => {
    const { value } = e.target;

    setStatusMessage("");
    setForm({
      ...form,
      bestBeforeGap: value,
      bestBefore: toInputDate(calculateBestBefore(form.mfgDate, value)),
    });
  };

  const handleTemplateSelect = (e) => {
    const templateId = e.target.value;
    const template = templates.find((item) => item._id === templateId);

    setSelectedTemplateId(templateId);
    setStatusMessage("");

    if (!template) {
      setCustomFieldValues({});
      return;
    }

    const defaults = template.defaults || {};
    const nextGap = defaults.bestBeforeGap || form.bestBeforeGap;
    setForm((values) => ({
      ...values,
      ...customizableTemplateFields.reduce((items, field) => {
        const defaultValue = templateFieldDefault(template, field.key);

        if (defaultValue && values[field.key] !== undefined) {
          items[field.key] = defaultValue;
        }

        return items;
      }, {}),
      formatNo: templateFieldDefault(template, "formatNo") || defaults.formatNo || values.formatNo,
      commodity:
        templateFieldDefault(template, "commodity") ||
        defaults.commodity ||
        template.productName ||
        values.commodity,
      warningText:
        templateFieldDefault(template, "warningText") || defaults.warningText || values.warningText,
      storage: templateFieldDefault(template, "storage") || defaults.storage || values.storage,
      license: templateFieldDefault(template, "license") || defaults.license || values.license,
      bestBeforeGap: nextGap,
      bestBefore: toInputDate(calculateBestBefore(values.mfgDate, nextGap)) || values.bestBefore,
    }));
    setCustomFieldValues(
      (template.customFields || []).reduce((values, field) => {
        values[field.key] = field.defaultValue || "";
        return values;
      }, {})
    );
  };

  const handleCustomFieldValueChange = (key, value) => {
    setStatusMessage("");
    setCustomFieldValues((values) => ({ ...values, [key]: value }));
  };

  const handleReset = () => {
    setForm(applyUserDefaults(emptyForm, currentUser));
    setDrumItems([emptyDrumItem()]);
    setVisibleDrumCount(DRUM_ROWS_BATCH_SIZE);
    setBulkDrumText("");
    setQuickDrumSetup({ count: "", netWt: "", tareWt: "" });
    setSelectedTemplateId("");
    setCustomFieldValues({});
    setStatusMessage("");
  };

  const handleDrumItemChange = (id, field, value) => {
    setStatusMessage("");
    setDrumItems((items) =>
      items.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const nextItem = {
          ...item,
          [field]: value,
        };

        if (field === "netWt" || field === "tareWt") {
          nextItem.grossWt = calculateGrossWeight(nextItem.netWt, nextItem.tareWt);
        }

        return nextItem;
      })
    );
  };

  const addDrumItem = () => {
    setDrumItems((items) => {
      const lastDrumNo = [...items].reverse().find((item) => item.drumNo.trim())?.drumNo;

      return [...items, emptyDrumItem(getNextDrumNo(lastDrumNo))];
    });
    setVisibleDrumCount((count) => count + 1);
  };

  const removeDrumItem = (id) => {
    setStatusMessage("");
    setDrumItems((items) =>
      items.length === 1 ? [emptyDrumItem()] : items.filter((item) => item.id !== id)
    );
    setVisibleDrumCount((count) => Math.max(DRUM_ROWS_BATCH_SIZE, count - 1));
  };

  const applyPastedDrumWeights = () => {
    const nextItems = parseBulkDrumRows(bulkDrumText);

    setStatusMessage("");

    if (!nextItems.length) {
      setStatusMessage("Paste one drum per line, for example: 25, 3.640");
      return;
    }

    setDrumItems(nextItems);
    setVisibleDrumCount(DRUM_ROWS_BATCH_SIZE);
    setStatusMessage(`${nextItems.length} drum row(s) prepared from the pasted weights.`);
  };

  const downloadWeightSample = () => {
    const sampleRows = [
      ["Drum No", "Net Wt.", "Tare Wt."],
      ["1", "25.000", "3.640"],
      ["2", "24.950", "3.640"],
      ["3", "25.100", "3.640"],
    ];
    const csv = sampleRows.map((row) => row.join(",")).join("\n");

    downloadPdfBlob(csv, "batchmark-weight-sample.csv");
  };

  const handleWeightSheetUpload = async (e) => {
    const file = e.target.files?.[0];

    setStatusMessage("");

    if (!file) {
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array", cellDates: false });
      const sheetName = workbook.SheetNames[0];
      const sheet = sheetName ? workbook.Sheets[sheetName] : null;

      if (!sheet) {
        setStatusMessage("This sheet does not contain any readable data.");
        return;
      }

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      const nextItems = parseSpreadsheetDrumRows(rows);

      if (!nextItems.length) {
        setStatusMessage("Could not find weight rows. Use columns: Drum No, Net Wt., Tare Wt.");
        return;
      }

      setDrumItems(nextItems);
      setVisibleDrumCount(DRUM_ROWS_BATCH_SIZE);
      setBulkDrumText(
        nextItems.map((item) => `${item.drumNo}, ${item.netWt}, ${item.tareWt}`).join("\n")
      );
      setStatusMessage(`${nextItems.length} drum row(s) imported from ${file.name}.`);
    } catch (err) {
      console.error(err);
      setStatusMessage("Could not read this sheet. Upload an Excel or CSV file.");
    } finally {
      e.target.value = "";
    }
  };

  const handleQuickDrumSetupChange = (field, value) => {
    setStatusMessage("");
    setQuickDrumSetup((values) => ({ ...values, [field]: value }));
  };

  const generateQuickDrumRows = () => {
    const count = Number.parseInt(quickDrumSetup.count, 10);

    setStatusMessage("");

    if (!Number.isFinite(count) || count < 1) {
      setStatusMessage("Enter how many drums you want to generate.");
      return;
    }

    const limitedCount = Math.min(count, 500);
    const nextItems = Array.from({ length: limitedCount }, (_, index) =>
      emptyDrumItem(String(index + 1), quickDrumSetup.netWt, quickDrumSetup.tareWt)
    );

    setDrumItems(nextItems);
    setVisibleDrumCount(DRUM_ROWS_BATCH_SIZE);
    setStatusMessage(
      `${limitedCount} drum row(s) generated. You can edit any row that has a different weight.`
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    const totalLabels = Math.max(validDrumItems.length, 1);
    let progressTimer;

    setGenerationProgress({ current: 1, total: totalLabels });
    setStatusMessage(`Generating label 1 of ${totalLabels}...`);

    if (totalLabels > 1) {
      progressTimer = window.setInterval(() => {
        setGenerationProgress((progress) => {
          if (!progress) {
            return progress;
          }

          const nextCurrent = Math.min(progress.current + 1, progress.total);
          setStatusMessage(`Generating label ${nextCurrent} of ${progress.total}...`);

          return { ...progress, current: nextCurrent };
        });
      }, 1200);
    }

    try {
      const payload = {
        ...form,
        ...currentManufacturerDetails,
        ownerPhone: getSavedPhone(),
        manufacturer: currentManufacturer,
        ...customizableTemplateFields.reduce((items, field) => {
          const defaultValue = templateFieldDefault(selectedTemplate, field.key);

          if (defaultValue) {
            items[field.key] = defaultValue;
          }

          return items;
        }, {}),
        templateId: selectedTemplate?._id || "",
        templateName: selectedTemplate?.name || "",
        fieldLabels: templateFieldLabelsPayload(selectedTemplate),
        fieldSettings: selectedTemplate?.fieldSettings || [],
        hiddenFields: templateHiddenFieldsPayload(selectedTemplate),
        customFields: selectedTemplate
          ? (selectedTemplate.customFields || []).map((field) => ({
              key: field.key,
              label: field.label,
              type: field.type,
              position: field.position,
              order: field.order,
              value: customFieldValues[field.key] || "",
            }))
          : [],
        drumItems: validDrumItems.map(({ netWt, tareWt, grossWt }, index) => ({
          drumNo: formatDrumSequence(index, validDrumItems.length),
          netWt: formatWeight(netWt),
          tareWt: formatWeight(tareWt),
          grossWt: grossWt || calculateGrossWeight(netWt, tareWt),
        })),
        drumNo: validDrumItems
          .map((_, index) => formatDrumSequence(index, validDrumItems.length))
          .join("\n"),
        mfgDate: normalizeDateValue(form.mfgDate),
        bestBefore:
          normalizeDateValue(form.bestBefore) ||
          calculateBestBefore(form.mfgDate, form.bestBeforeGap),
      };

      const res = await axios.post(
        `${API_BASE}/generate`,
        payload,
        { responseType: "blob" }
      );

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = validDrumItems.length > 1 ? "labels.pdf" : "label.pdf";
      a.click();
      window.URL.revokeObjectURL(url);
      setStatusMessage(
        validDrumItems.length > 1
          ? `${validDrumItems.length} labels generated successfully.`
          : "PDF generated successfully."
      );

    } catch (err) {
      console.error(err);
      setStatusMessage("Could not generate the PDF. Check the server and try again.");
    } finally {
      if (progressTimer) {
        window.clearInterval(progressTimer);
      }
      setGenerationProgress(null);
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem("labelUserName");
    window.localStorage.removeItem("labelUserPhone");
    setCurrentUser("");
    window.history.pushState({}, "", "/login");
  };

  if (labelId) {
    return <LabelDetails id={labelId} />;
  }

  if (infoPage) {
    return (
      <InfoPage page={infoPage} currentUser={currentUser} onLogout={handleLogout} />
    );
  }

  if (isLandingPage) {
    return <LandingPage currentUser={currentUser} onLogout={handleLogout} />;
  }

  if (isLoginPage && currentUser) {
    window.history.replaceState({}, "", "/home");
    return <HomePage userName={currentUser} onLogout={handleLogout} />;
  }

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }

  if (isHomePage) {
    return <HomePage userName={currentUser} onLogout={handleLogout} />;
  }

  if (isProfilePage) {
    return (
      <ProfilePage
        userName={currentUser}
        onUserUpdate={setCurrentUser}
        onLogout={handleLogout}
      />
    );
  }

  if (isTemplatesPage) {
    return <TemplatesPage currentUser={currentUser} onLogout={handleLogout} />;
  }

  if (isHistoryPage) {
    return <HistoryPage currentUser={currentUser} onLogout={handleLogout} />;
  }

  return (
    <main className="page-shell">
      <AppNav currentUser={currentUser} onLogout={handleLogout} />
      <header className="site-header">
        <div>
          <h1>Label Generator</h1>
          <p className="header-copy">Enter batch details once, then generate one PDF per drum.</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={handleReset}>
            Clear
          </button>
          <button form="label-form" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Generating..." : "Generate PDF"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <form id="label-form" className="label-form" onSubmit={handleSubmit}>
          <section className="form-section form-step template-picker-section">
            <div className="section-heading section-heading-with-action">
              <div>
                <p className="step-label">Step 1</p>
                <h2>Choose Product Template</h2>
                <p>Select a saved product format, or continue with the standard label fields.</p>
              </div>
              <a className="button-link secondary-link" href="/templates">
                Manage Templates
              </a>
            </div>
            <label className="field">
              <span>Template</span>
              <select value={selectedTemplateId} onChange={handleTemplateSelect}>
                <option value="">No template selected</option>
                {templates.map((template) => (
                  <option key={template._id} value={template._id}>
                    {template.name}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <small>
                  {pluralize(selectedTemplate.customFields?.length || 0, "custom field")} will
                  be included for this product.
                </small>
              )}
            </label>
            {selectedTemplate && (
              <TemplateLayoutPreview
                template={selectedTemplate}
                values={{
                  ...form,
                  manufacturer: currentManufacturer,
                  manufacturerAddress: currentManufacturerDetails.manufacturerAddress,
                  manufacturerWebsite: currentManufacturerDetails.manufacturerWebsite,
                  manufacturerEmail: currentManufacturerDetails.manufacturerEmail,
                  manufacturerPhone: currentManufacturerDetails.manufacturerPhone,
                  ...customFieldValues,
                }}
                title="Saved Template Preview"
              />
            )}
          </section>

          {fieldGroups.map((group) => (
            <div className="form-group-block" key={group.title}>
              <section className="form-section form-step">
                <div className="section-heading">
                  <p className="step-label">
                    {group.title === "Batch Details" ? "Step 2" : "Step 4"}
                  </p>
                  <h2>{group.title}</h2>
                </div>

                <div className="form-grid">
                  {group.fields
                    .filter((fieldName) => templateFieldVisible(selectedTemplate, fieldName))
                    .map((fieldName) => {
                    const field = fieldsByName[fieldName];
                    const isManufacturerField = field.name === "manufacturer";
                    const fieldValue = isManufacturerField
                      ? currentManufacturer
                      : form[field.name];
                    const displayLabel = templateFieldLabel(
                      selectedTemplate,
                      field.name,
                      field.label
                    );

                    return (
                      <label
                        key={field.name}
                        className={field.multiline ? "field field-wide" : "field"}
                      >
                        <span>{displayLabel}</span>
                        {field.type === "select" ? (
                          <select
                            name={field.name}
                            value={fieldValue}
                            onChange={
                              field.name === "bestBeforeGap"
                                ? handleBestBeforeGapChange
                                : handleChange
                            }
                            required={field.required}
                          >
                            {field.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : field.multiline ? (
                          <textarea
                            name={field.name}
                            value={fieldValue}
                            placeholder={field.placeholder}
                            onChange={isManufacturerField ? undefined : handleChange}
                            readOnly={isManufacturerField}
                            required={field.required}
                            rows="3"
                          />
                        ) : (
                          <input
                            name={field.name}
                            type={field.type || "text"}
                            value={fieldValue}
                            placeholder={field.placeholder}
                            onChange={
                              isManufacturerField
                                ? undefined
                                : field.name === "mfgDate"
                                  ? handleMfgDateChange
                                  : handleChange
                            }
                            readOnly={isManufacturerField}
                            required={field.required}
                          />
                        )}
                        {isManufacturerField && (
                          <small>Controlled from Profile for this logged-in user.</small>
                        )}
                        {!isManufacturerField && field.helper && <small>{field.helper}</small>}
                      </label>
                    );
                  })}
                </div>
              </section>

              {group.title === "Batch Details" && (
                <section className="form-section form-step">
            <div className="section-heading section-heading-with-action">
              <div>
                <p className="step-label">Step 3</p>
                <h2>Drum Weights</h2>
                <p>Each row generates one label with its own weight values.</p>
              </div>
              <button className="secondary-button" type="button" onClick={addDrumItem}>
                Add Drum
              </button>
            </div>

            <div className="bulk-drum-import">
              <div className="bulk-drum-title">
                <strong>Quick setup</strong>
                <span>Use this when all drums have the same net and tare weight.</span>
              </div>
              <div className="quick-drum-grid">
                <label>
                  <span>Total Drums</span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={quickDrumSetup.count}
                    onChange={(e) => handleQuickDrumSetupChange("count", e.target.value)}
                    placeholder="100"
                  />
                </label>
                <label>
                  <span>Same Net Wt.</span>
                  <input
                    value={quickDrumSetup.netWt}
                    onChange={(e) => handleQuickDrumSetupChange("netWt", e.target.value)}
                    placeholder="25.000"
                  />
                </label>
                <label>
                  <span>Same Tare Wt.</span>
                  <input
                    value={quickDrumSetup.tareWt}
                    onChange={(e) => handleQuickDrumSetupChange("tareWt", e.target.value)}
                    placeholder="3.640"
                  />
                </label>
                <button className="secondary-button" type="button" onClick={generateQuickDrumRows}>
                  Generate Rows
                </button>
              </div>
              <div className="weight-import-panel">
                <div className="weight-import-heading">
                  <div>
                    <strong>Different weights</strong>
                    <span>Paste rows or upload a sheet when each drum has its own weight.</span>
                  </div>
                  <button className="secondary-button compact-button" type="button" onClick={downloadWeightSample}>
                    Download Sample
                  </button>
                </div>
                <div className="weight-import-grid">
                  <label className="weight-paste-card">
                    <span>Paste Weight Rows</span>
                    <textarea
                      value={bulkDrumText}
                      onChange={(e) => setBulkDrumText(e.target.value)}
                      placeholder={"1, 25.000, 3.640\n2, 24.950, 3.640\n3, 25.100, 3.640"}
                      rows="5"
                    />
                    <small>Format: Drum No, Net Wt., Tare Wt. Drum No is optional.</small>
                  </label>
                  <label className="sheet-upload">
                    <span>Upload Excel / CSV File</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.tsv"
                      onChange={handleWeightSheetUpload}
                    />
                    <small>Accepted columns: Drum No, Net Wt., Tare Wt.</small>
                  </label>
                </div>
                <div className="bulk-drum-actions">
                  <small>Gross Wt. is calculated automatically after import.</small>
                  <button className="secondary-button" type="button" onClick={applyPastedDrumWeights}>
                    Apply Pasted Rows
                  </button>
                </div>
              </div>
            </div>

            <div className="drum-table">
              <div className="drum-table-head">
                <span>Drum No</span>
                <span>Net Wt.</span>
                <span>Tare Wt.</span>
                <span>Gross Wt.</span>
                <span></span>
              </div>

              {visibleDrumItems.map((item, index) => (
                <div className="drum-row" key={item.id}>
                  <label>
                    <span>Drum No</span>
                    <input
                      value={item.drumNo}
                      onChange={(e) =>
                        handleDrumItemChange(item.id, "drumNo", e.target.value)
                      }
                      placeholder={index === 0 ? "1/8" : "2/8"}
                      required={index === 0}
                    />
                  </label>
                  <label>
                    <span>Net Wt.</span>
                    <input
                      value={item.netWt}
                      onChange={(e) =>
                        handleDrumItemChange(item.id, "netWt", e.target.value)
                      }
                      placeholder="25.000 KGS."
                    />
                  </label>
                  <label>
                    <span>Tare Wt.</span>
                    <input
                      value={item.tareWt}
                      onChange={(e) =>
                        handleDrumItemChange(item.id, "tareWt", e.target.value)
                      }
                      placeholder="3.640 KGS."
                    />
                  </label>
                  <label>
                    <span>Gross Wt.</span>
                    <input
                      value={item.grossWt}
                      readOnly
                      placeholder="28.640 KGS."
                    />
                  </label>
                  <button
                    className="secondary-button icon-button"
                    type="button"
                    onClick={() => removeDrumItem(item.id)}
                    aria-label="Remove drum row"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {drumItems.length > DRUM_ROWS_BATCH_SIZE && (
              <div className="drum-load-more">
                <span>
                  Showing {visibleDrumItems.length} of {drumItems.length} drum rows
                </span>
                {hiddenDrumCount > 0 ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      setVisibleDrumCount((count) =>
                        Math.min(count + DRUM_ROWS_BATCH_SIZE, drumItems.length)
                      )
                    }
                  >
                    Load More
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setVisibleDrumCount(DRUM_ROWS_BATCH_SIZE)}
                  >
                    Show Less
                  </button>
                )}
              </div>
            )}
                </section>
              )}
            </div>
          ))}

          {selectedTemplate?.customFields?.length > 0 && (
            <section className="form-section form-step">
              <div className="section-heading">
                <p className="step-label">Step 5</p>
                <h2>Custom Product Fields</h2>
                <p>These fields come from the selected product template.</p>
              </div>
              <div className="form-grid">
                {selectedTemplate.customFields.map((field) => (
                  <label
                    className={field.type === "textarea" ? "field field-wide" : "field"}
                    key={field.key}
                  >
                    <span>{field.label}</span>
                    {field.type === "textarea" ? (
                      <textarea
                        value={customFieldValues[field.key] || ""}
                        onChange={(e) =>
                          handleCustomFieldValueChange(field.key, e.target.value)
                        }
                        rows="3"
                        required={field.required}
                      />
                    ) : (
                      <input
                        type={field.type === "number" || field.type === "date" ? field.type : "text"}
                        value={customFieldValues[field.key] || ""}
                        onChange={(e) =>
                          handleCustomFieldValueChange(field.key, e.target.value)
                        }
                        required={field.required}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>
          )}

          <div className="mobile-actions">
            <a className="button-link secondary-link" href="/home">
              Home
            </a>
            <a className="button-link secondary-link" href="/templates">
              Templates
            </a>
            <a className="button-link secondary-link" href="/history">
              History
            </a>
            <a className="button-link secondary-link" href="/profile">
              Profile
            </a>
            <button className="secondary-button" type="button" onClick={handleReset}>
              Clear
            </button>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Generating..." : "Generate PDF"}
            </button>
          </div>
        </form>

        <aside className="summary-panel">
          <div className="summary-card">
            <p className="eyebrow">Current Label</p>
            <h2>{form.commodity || "New Label"}</h2>
            <dl>
              <div>
                <dt>Drums</dt>
                <dd>{validDrumItems.length ? `${validDrumItems.length} label(s)` : "-"}</dd>
              </div>
              <div>
                <dt>Lot No</dt>
                <dd>{form.lotNo || "-"}</dd>
              </div>
              <div>
                <dt>Mfg. Date</dt>
                <dd>{normalizeDateValue(form.mfgDate) || "-"}</dd>
              </div>
              <div>
                <dt>Best Before</dt>
                <dd>{normalizeDateValue(form.bestBefore) || "-"}</dd>
              </div>
              <div>
                <dt>Manufacturer</dt>
                <dd>{currentManufacturer || "-"}</dd>
              </div>
            </dl>
            {generationProgress && (
              <div className="generation-progress" aria-live="polite">
                <div>
                  <span>
                    Generating label {generationProgress.current} of {generationProgress.total}
                  </span>
                  <strong>
                    {Math.round((generationProgress.current / generationProgress.total) * 100)}%
                  </strong>
                </div>
                <progress value={generationProgress.current} max={generationProgress.total} />
              </div>
            )}
            {statusMessage && <p className="status-message">{statusMessage}</p>}
          </div>
        </aside>
      </div>
      <AppFooter />
    </main>
  );
}

export default App;

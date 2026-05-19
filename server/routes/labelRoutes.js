const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { labelStore, templateStore } = require("../services/dataStore");
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const PUBLIC_API_ORIGIN = process.env.PUBLIC_API_ORIGIN || "http://localhost:5050";

if (process.env.NODE_ENV === "production" && !process.env.PUPPETEER_CACHE_DIR) {
  process.env.PUPPETEER_CACHE_DIR = "/opt/render/.cache/puppeteer";
}

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const fillTemplate = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || "");

const getDrumNumbers = (value = "") =>
  String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizePhone = (phone = "") => String(phone).replace(/[^\d+]/g, "").trim();

const PDF_LAYOUTS = new Set(["single", "two-per-page"]);
const normalizePdfLayout = (value = "") =>
  PDF_LAYOUTS.has(String(value).trim()) ? String(value).trim() : "single";

const parseWeight = (value = "") => {
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);

  if (!match) {
    return null;
  }

  return {
    amountText: match[1],
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

  return `${parsed.amountText} ${parsed.unit || "KGS."}`;
};

const calculateGrossWeight = (netWt, tareWt) => {
  const net = parseWeight(netWt);
  const tare = parseWeight(tareWt);

  if (!net || !tare) {
    return "";
  }

  const decimals = Math.max(net.decimals, tare.decimals);
  const unit = net.unit || tare.unit || "KGS.";

  return `${(net.amount + tare.amount).toFixed(decimals)} ${unit}`;
};

const formatDrumSequence = (index, total) => `${index + 1}/${Math.max(total, 1)}`;

const getDrumItems = (data) => {
  if (Array.isArray(data.drumItems)) {
    const items = data.drumItems.filter((item) => String(item.drumNo || "").trim());
    const total = items.length;

    return items
      .map((item, index) => ({
        drumNo: formatDrumSequence(index, total),
        netWt: formatWeight(item.netWt || data.netWt),
        tareWt: formatWeight(item.tareWt || data.tareWt),
        grossWt:
          formatWeight(item.grossWt || data.grossWt) ||
          calculateGrossWeight(item.netWt || data.netWt, item.tareWt || data.tareWt),
      }));
  }

  const drumNumbers = getDrumNumbers(data.drumNo);
  const total = drumNumbers.length;

  return drumNumbers.map((_, index) => ({
    drumNo: formatDrumSequence(index, total),
    netWt: formatWeight(data.netWt),
    tareWt: formatWeight(data.tareWt),
    grossWt: formatWeight(data.grossWt) || calculateGrossWeight(data.netWt, data.tareWt),
  }));
};

const requestOrigin = (req) => {
  if (PUBLIC_API_ORIGIN && !PUBLIC_API_ORIGIN.includes("localhost")) {
    return PUBLIC_API_ORIGIN.replace(/\/$/, "");
  }

  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";

  return `${protocol}://${req.get("host")}`;
};

const labelPublicUrl = (req, id) => `${requestOrigin(req)}/label/${id}`;

const chromeInstallErrorPattern = /could not find chrome|browser was not found|executable.*not found|enoent/i;
let browserPromise = null;

const installChrome = () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/installChrome.js")], {
    env: {
      ...process.env,
      INSTALL_PUPPETEER_CHROME: "1",
    },
    stdio: "inherit",
  });

  return result.status === 0;
};

const launchBrowser = async () => {
  try {
    return await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (err) {
    const message = String(err?.message || err);

    if (!chromeInstallErrorPattern.test(message)) {
      throw err;
    }

    console.warn("Chrome is unavailable for PDF generation. Installing and retrying...");

    if (!installChrome()) {
      throw err;
    }

    return puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
};

const getBrowser = async () => {
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }

  try {
    const browser = await browserPromise;

    if (!browser.isConnected()) {
      browserPromise = launchBrowser();
      return await browserPromise;
    }

    return browser;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
};

const closeSharedBrowser = async () => {
  if (!browserPromise) {
    return;
  }

  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (err) {
    console.error("Could not close shared browser:", err.message);
  } finally {
    browserPromise = null;
  }
};

const warmPdfBrowser = () => {
  getBrowser()
    .then(() => console.log("PDF browser ready"))
    .catch((err) => console.warn("PDF browser warmup failed:", err.message));
};

setTimeout(warmPdfBrowser, 1500);

process.once("SIGINT", () => {
  closeSharedBrowser().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  closeSharedBrowser().finally(() => process.exit(0));
});

const formatDate = (value = "") => {
  const text = String(value).trim();

  if (!text) {
    return "";
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (slashMatch) {
    const day = slashMatch[1].padStart(2, "0");
    const month = slashMatch[2].padStart(2, "0");
    return `${day}/${month}/${slashMatch[3]}`;
  }

  return text;
};

const normalizeLabelData = (data) => ({
  ...data,
  ownerPhone: normalizePhone(data.ownerPhone),
  pdfLayout: normalizePdfLayout(data.pdfLayout),
  mfgDate: formatDate(data.mfgDate),
  bestBefore: formatDate(data.bestBefore),
});

const imageDataUrl = (fileName, mimeType) => {
  const filePath = path.join(__dirname, "../utils", fileName);

  if (!fs.existsSync(filePath)) {
    return "";
  }

  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
};

const getManufacturerLogo = (value = "") =>
  String(value).trim().startsWith("data:image/") ? String(value).trim() : "";

const joinContactParts = (...parts) =>
  parts
    .filter((part) => String(part.value || "").trim())
    .map((part) => `${part.label}: ${part.value}`)
    .join("  •  ");

const STANDARD_FIELD_LABELS = {
  formatNo: "Format No",
  drumNo: "DRUM NO.",
  commodity: "COMMODITY",
  lotNo: "LOT NO.",
  poNo: "P.O. NO.",
  mfgDate: "MFG. DATE",
  bestBefore: "BEST BEFORE",
  netWt: "NET WT.",
  tareWt: "TARE WT.",
  grossWt: "GROSS WT.",
  customerName: "Customer Name",
  customerAddress: "Customer Address",
  warningText: "Warning",
  storage: "STORAGE CONDITION",
  license: "LICENSE NUMBER",
  manufacturer: "MANUFACTURER",
  manufacturerAddress: "Address",
  manufacturerWebsite: "WEBSITE",
  manufacturerEmail: "EMAIL",
  manufacturerPhone: "CELL",
  manufacturerLogo: "Manufacturer Logo",
};

const STANDARD_FIELD_KEYS = Object.keys(STANDARD_FIELD_LABELS);
const TEMPLATE_POSITIONS = new Set(["left", "right", "center", "bottom", "hidden"]);
const normalizeTemplatePosition = (position, fallback = "left") =>
  TEMPLATE_POSITIONS.has(position) ? position : fallback;

const normalizeFieldSettings = (settings = []) =>
  (Array.isArray(settings) ? settings : [])
    .map((setting) => ({
      key: String(setting.key || "").trim(),
      label: String(setting.label || "").trim(),
      visible: setting.visible !== false,
      defaultValue: String(setting.defaultValue || "").trim(),
      position: normalizeTemplatePosition(setting.position, "left"),
      order: Number(setting.order) || 0,
    }))
    .filter((setting) => STANDARD_FIELD_KEYS.includes(setting.key));

const fieldSettingsMap = (settings = []) =>
  normalizeFieldSettings(settings).reduce((items, setting) => {
    items[setting.key] = setting;
    return items;
  }, {});

const fieldLabel = (data = {}, key) =>
  data.fieldLabels?.[key] ||
  fieldSettingsMap(data.fieldSettings)[key]?.label ||
  STANDARD_FIELD_LABELS[key] ||
  key;

const isFieldHidden = (data = {}, key) =>
  Array.isArray(data.hiddenFields) && data.hiddenFields.includes(key);

const hideClass = (data, key) => (isFieldHidden(data, key) ? "is-hidden" : "");

const templateLayoutActive = (data = {}) =>
  Array.isArray(data.fieldSettings) && data.fieldSettings.length > 0;

const defaultFieldPosition = (key) => {
  if (["warningText", "storage", "license"].includes(key)) {
    return "center";
  }

  if (
    [
      "manufacturer",
      "manufacturerAddress",
      "manufacturerWebsite",
      "manufacturerEmail",
      "manufacturerPhone",
      "manufacturerLogo",
    ].includes(key)
  ) {
    return "bottom";
  }

  if (key === "formatNo") {
    return "right";
  }

  return "left";
};

const fieldPosition = (data = {}, key) =>
  normalizeTemplatePosition(
    fieldSettingsMap(data.fieldSettings)[key]?.position,
    defaultFieldPosition(key)
  );

const fieldOrder = (data = {}, key, fallback = 0) => {
  const order = Number(fieldSettingsMap(data.fieldSettings)[key]?.order);
  return Number.isFinite(order) ? order : fallback;
};

const labelRowHtml = (data, key, value) =>
  isFieldHidden(data, key)
    ? ""
    : `
      <div class="row">
        <div class="label-name">${escapeHtml(fieldLabel(data, key))}</div>
        <div>:</div>
        <div class="value">${escapeHtml(value || "")}</div>
      </div>`;

const mainFieldsHtml = (data = {}) =>
  [
    ["drumNo", data.drumNo],
    ["commodity", data.commodity],
    ["lotNo", data.lotNo],
    ["poNo", data.poNo],
    ["mfgDate", data.mfgDate],
    ["bestBefore", data.bestBefore],
    ["netWt", data.netWt],
    ["tareWt", data.tareWt],
    ["grossWt", data.grossWt],
  ]
    .map(([key, value]) => labelRowHtml(data, key, value))
    .join("");

const standardLayoutFieldValues = (data = {}) => [
  ["formatNo", data.formatNo],
  ["drumNo", data.drumNo],
  ["commodity", data.commodity],
  ["lotNo", data.lotNo],
  ["poNo", data.poNo],
  ["mfgDate", data.mfgDate],
  ["bestBefore", data.bestBefore],
  ["netWt", data.netWt],
  ["tareWt", data.tareWt],
  ["grossWt", data.grossWt],
  ["customerName", data.customerName],
  ["customerAddress", data.customerAddress],
  ["warningText", data.warningText],
  ["storage", data.storage],
  ["license", data.license],
  ["manufacturer", data.manufacturer],
  ["manufacturerAddress", data.manufacturerAddress],
  ["manufacturerWebsite", data.manufacturerWebsite],
  ["manufacturerEmail", data.manufacturerEmail],
  ["manufacturerPhone", data.manufacturerPhone],
  ["manufacturerLogo", getManufacturerLogo(data.manufacturerLogo)],
];

const layoutRowHtml = (label, value, key) =>
  key === "manufacturerLogo"
    ? `
      <div class="row">
        <div class="label-name">${escapeHtml(label)}</div>
        <div>:</div>
        <div class="value"><img class="manufacturer-logo" src="${escapeHtml(value || "")}" /></div>
      </div>`
    : `
      <div class="row">
        <div class="label-name">${escapeHtml(label)}</div>
        <div>:</div>
        <div class="value">${escapeHtml(value || "")}</div>
      </div>`;

const layoutFieldsHtml = (data = {}, position) => {
  const standardItems = standardLayoutFieldValues(data)
    .map(([key, value], index) => ({
      key,
      label: fieldLabel(data, key),
      value,
      position: fieldPosition(data, key),
      order: fieldOrder(data, key, index),
    }))
    .filter(
      (item) =>
        item.position === position &&
        !isFieldHidden(data, item.key) &&
        String(item.value || "").trim()
    );

  const customItems = normalizeCustomFields(data.customFields)
    .filter(
      (field) =>
        field.position === position &&
        !isFieldHidden(data, field.key) &&
        String(field.value || "").trim()
    )
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      position: field.position,
      order: field.order,
    }));

  return [...standardItems, ...customItems]
    .sort((a, b) => a.order - b.order)
    .map((item) => layoutRowHtml(item.label, item.value, item.key))
    .join("");
};

const contactParts = (data = {}) =>
  [
    { key: "manufacturerWebsite", value: data.manufacturerWebsite },
    { key: "manufacturerEmail", value: data.manufacturerEmail },
    { key: "manufacturerPhone", value: data.manufacturerPhone },
  ]
    .filter((part) => !isFieldHidden(data, part.key) && String(part.value || "").trim())
    .map((part) => `${fieldLabel(data, part.key)}: ${part.value}`)
    .join("  •  ");

const serializeLabel = (label) => {
  const normalized = normalizeLabelData(label);
  const createdAt = label.createdAt || label._id?.getTimestamp?.();

  return {
    ...normalized,
    _id: String(label._id || label.id || ""),
    createdAt,
  };
};

const normalizeCustomFields = (fields = []) =>
  (Array.isArray(fields) ? fields : [])
    .map((field, index) => ({
      key:
        String(field.key || field.label || `field_${index + 1}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || `field_${index + 1}`,
      label: String(field.label || "").trim(),
      type: ["text", "number", "date", "textarea"].includes(field.type) ? field.type : "text",
      required: Boolean(field.required),
      defaultValue: String(field.defaultValue || "").trim(),
      value: String(field.value || "").trim(),
      position: normalizeTemplatePosition(field.position, "bottom"),
      order: Number(field.order) || index + 100,
    }))
    .filter((field) => field.label);

const normalizeTemplateData = (body = {}) => ({
  ownerPhone: normalizePhone(body.ownerPhone),
  name: String(body.name || body.productName || "").trim(),
  productName: String(body.productName || body.name || "").trim(),
  defaults: {
    formatNo: String(body.defaults?.formatNo || "").trim(),
    commodity: String(body.defaults?.commodity || body.productName || "").trim(),
    warningText: String(body.defaults?.warningText || "").trim(),
    storage: String(body.defaults?.storage || "").trim(),
    license: String(body.defaults?.license || "").trim(),
    bestBeforeGap: String(body.defaults?.bestBeforeGap || "").trim(),
  },
  fieldSettings: normalizeFieldSettings(body.fieldSettings),
  customFields: normalizeCustomFields(body.customFields),
});

const serializeTemplate = (template = {}) => ({
  ...template,
  _id: String(template._id || template.id || ""),
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

const customFieldsHtml = (fields = []) =>
  normalizeCustomFields(fields)
    .filter((field) => field.value)
    .map(
      (field) => `
      <div class="row custom-field-row">
        <div class="label-name">${escapeHtml(field.label)}</div>
        <div>:</div>
        <div class="value">${escapeHtml(field.value)}</div>
      </div>`
    )
    .join("");

const templateValues = (data, qr) => {
  const manufacturerLogoValue = getManufacturerLogo(data.manufacturerLogo);
  const useCustomLayout = templateLayoutActive(data);
  const hideManufacturerLogo =
    isFieldHidden(data, "manufacturerLogo") || !manufacturerLogoValue;
  const hideManufacturerBlock =
    [
      "manufacturer",
      "manufacturerAddress",
      "manufacturerWebsite",
      "manufacturerEmail",
      "manufacturerPhone",
    ].every((key) => isFieldHidden(data, key)) && hideManufacturerLogo;

  return {
    labelFormatNo: escapeHtml(fieldLabel(data, "formatNo")),
    formatNo: escapeHtml(data.formatNo),
    hideFormatNo: useCustomLayout ? "layout-hidden" : hideClass(data, "formatNo"),
    mainFieldsHtml: mainFieldsHtml(data),
    leftFieldsHtml: useCustomLayout
      ? layoutFieldsHtml(data, "left")
      : `${mainFieldsHtml(data)}${customFieldsHtml(data.customFields)}`,
    rightFieldsHtml: useCustomLayout ? layoutFieldsHtml(data, "right") : "",
    centerFieldsHtml: useCustomLayout ? layoutFieldsHtml(data, "center") : "",
    bottomFieldsHtml: useCustomLayout ? layoutFieldsHtml(data, "bottom") : "",
    drumNo: escapeHtml(data.drumNo),
    commodity: escapeHtml(data.commodity),
    lotNo: escapeHtml(data.lotNo),
    poNo: escapeHtml(data.poNo),
    mfgDate: escapeHtml(data.mfgDate),
    bestBefore: escapeHtml(data.bestBefore),
    netWt: escapeHtml(data.netWt),
    tareWt: escapeHtml(data.tareWt),
    grossWt: escapeHtml(data.grossWt),
    customerName: escapeHtml(data.customerName),
    customerAddress: escapeHtml(data.customerAddress),
    warningText: escapeHtml(data.warningText),
    storage: escapeHtml(data.storage),
    license: escapeHtml(data.license),
    manufacturer: escapeHtml(data.manufacturer),
    manufacturerAddress: escapeHtml(data.manufacturerAddress),
    manufacturerWebsite: escapeHtml(data.manufacturerWebsite),
    manufacturerEmail: escapeHtml(data.manufacturerEmail),
    manufacturerPhone: escapeHtml(data.manufacturerPhone),
    customFieldsHtml: customFieldsHtml(data.customFields),
    hideCustomerName: useCustomLayout ? "layout-hidden" : hideClass(data, "customerName"),
    hideCustomerAddress: useCustomLayout
      ? "layout-hidden"
      : hideClass(data, "customerAddress"),
    hideCustomerBlock:
      useCustomLayout ||
      (isFieldHidden(data, "customerName") && isFieldHidden(data, "customerAddress"))
        ? "is-hidden"
        : "",
    hideWarningText: useCustomLayout ? "layout-hidden" : hideClass(data, "warningText"),
    hideStorage: useCustomLayout ? "layout-hidden" : hideClass(data, "storage"),
    hideLicense: useCustomLayout ? "layout-hidden" : hideClass(data, "license"),
    hideManufacturerBlock: useCustomLayout || hideManufacturerBlock ? "is-hidden" : "",
    hideManufacturer: hideClass(data, "manufacturer"),
    hideManufacturerAddress: hideClass(data, "manufacturerAddress"),
    hideManufacturerLogo: hideManufacturerLogo ? "is-hidden" : "",
    manufacturerDetailsClass: hideManufacturerLogo ? "logo-hidden" : "",
    labelCustomerName: escapeHtml(fieldLabel(data, "customerName")),
    labelCustomerAddress: escapeHtml(fieldLabel(data, "customerAddress")),
    labelWarningText: escapeHtml(fieldLabel(data, "warningText")),
    labelStorage: escapeHtml(fieldLabel(data, "storage")),
    labelLicense: escapeHtml(fieldLabel(data, "license")),
    labelManufacturer: escapeHtml(fieldLabel(data, "manufacturer")),
    manufacturerContact: escapeHtml(contactParts(data)),
    manufacturerLogo: manufacturerLogoValue,
    qrCode: qr,
  };
};

const renderLabelsHtml = (template, labels, options = {}) => {
  const pdfLayout = normalizePdfLayout(options.layout);
  const labelStart = template.indexOf('<div class="label">');
  const labelEnd = template.lastIndexOf("</div>");

  if (labelStart === -1 || labelEnd === -1) {
    throw new Error("Label template wrapper not found");
  }

  const beforeLabel = template.slice(0, labelStart);
  const labelBlock = template.slice(labelStart, labelEnd + 6);
  const afterLabel = template.slice(labelEnd + 6);
  const filledLabels = labels
    .map(({ data, qr }) => {
      const filledLabel = fillTemplate(labelBlock, templateValues(data, qr));

      return pdfLayout === "two-per-page"
        ? `<div class="label-slot">${filledLabel}</div>`
        : filledLabel;
    })
    .join("\n");

  const layoutCss =
    pdfLayout === "two-per-page"
      ? "\n    @page { size: A4 portrait; margin: 0; }\n"
      : "";
  const renderedBeforeLabel = beforeLabel
    .replace("</style>", `${layoutCss}  </style>`)
    .replace("<body>", `<body class="layout-${pdfLayout}">`);

  return `${renderedBeforeLabel}${filledLabels}${afterLabel}`;
};

const createPdfBuffer = async (labels, options = {}) => {
  let page;
  const pdfLayout = normalizePdfLayout(options.layout);

  try {
    const template = fs.readFileSync(
      path.join(__dirname, "../utils/template.html"),
      "utf-8"
    );
    const renderedTemplate = renderLabelsHtml(template, labels, { layout: pdfLayout });

    const browser = await getBrowser();
    page = await browser.newPage();
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);

    await page.setContent(renderedTemplate, {
      waitUntil: "domcontentloaded",
      timeout: 0,
    });

    await page.evaluate(
      () =>
        Promise.race([
          Promise.all(
            Array.from(document.images)
              .filter((image) => !image.complete)
              .map(
                (image) =>
                  new Promise((resolve) => {
                    image.onload = resolve;
                    image.onerror = resolve;
                  })
              )
          ),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ])
    );

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: pdfLayout !== "two-per-page",
      preferCSSPageSize: true,
      printBackground: true,
    });

    await page.close();
    page = null;

    return pdfBuffer;
  } catch (err) {
    console.error("PDF generation failed:", err.stack || err.message || err);

    if (page) {
      await page.close().catch(() => {});
    }

    throw err;
  }
};

const sendPdf = (res, pdfBuffer, fileName) => {
  const pdfBody = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  const safeFileName = String(fileName || "label.pdf")
    .replace(/[^\w.\-() ]+/g, "-")
    .replace(/-+/g, "-");

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${safeFileName || "label.pdf"}"`,
    "Content-Length": pdfBody.length,
    "Cache-Control": "no-store",
  });
  res.send(pdfBody);
};

const mapWithConcurrency = async (items, limit, task) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

router.get("/labels", async (req, res) => {
  try {
    const labels = await labelStore.list(normalizePhone(req.query.ownerPhone));

    res.json(labels.map(serializeLabel));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not load label history" });
  }
});

router.get("/templates", async (req, res) => {
  try {
    const templates = await templateStore.list(normalizePhone(req.query.ownerPhone));
    res.json(templates.map(serializeTemplate));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not load product templates" });
  }
});

router.post("/templates", async (req, res) => {
  try {
    const data = normalizeTemplateData(req.body);

    if (!data.ownerPhone) {
      return res.status(400).json({ message: "Owner phone is required" });
    }

    if (!data.name) {
      return res.status(400).json({ message: "Template name is required" });
    }

    const template = await templateStore.create(data);
    res.status(201).json(serializeTemplate(template));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not save product template" });
  }
});

router.put("/templates/:id", async (req, res) => {
  try {
    const existingTemplate = await templateStore.getById(req.params.id);

    if (!existingTemplate) {
      return res.status(404).json({ message: "Template not found" });
    }

    const requestOwnerPhone = normalizePhone(req.body?.ownerPhone || req.query.ownerPhone);
    const templateOwnerPhone = normalizePhone(existingTemplate.ownerPhone);

    if (!requestOwnerPhone || (templateOwnerPhone && requestOwnerPhone !== templateOwnerPhone)) {
      return res.status(403).json({ message: "Only the template owner can update it" });
    }

    const data = normalizeTemplateData(req.body);
    const template = await templateStore.updateById(req.params.id, data);

    res.json(serializeTemplate(template));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not update product template" });
  }
});

router.delete("/templates/:id", async (req, res) => {
  try {
    const existingTemplate = await templateStore.getById(req.params.id);

    if (!existingTemplate) {
      return res.status(404).json({ message: "Template not found" });
    }

    const requestOwnerPhone = normalizePhone(req.query.ownerPhone || req.body?.ownerPhone);
    const templateOwnerPhone = normalizePhone(existingTemplate.ownerPhone);

    if (!requestOwnerPhone || (templateOwnerPhone && requestOwnerPhone !== templateOwnerPhone)) {
      return res.status(403).json({ message: "Only the template owner can delete it" });
    }

    await templateStore.deleteById(req.params.id);
    res.json({ message: "Template deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not delete product template" });
  }
});

router.post("/labels/batch/pdf", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    if (!ids.length) {
      return res.status(400).send("At least one label id is required");
    }

    const requestOwnerPhone = normalizePhone(req.body?.ownerPhone || req.query.ownerPhone);
    const labels = (await Promise.all(ids.map((id) => labelStore.getById(id)))).filter(Boolean);

    if (!labels.length) {
      return res.status(404).send("Labels not found");
    }

    if (requestOwnerPhone) {
      const hasOtherOwner = labels.some((label) => {
        const labelOwnerPhone = normalizePhone(label.ownerPhone);
        return labelOwnerPhone && labelOwnerPhone !== requestOwnerPhone;
      });

      if (hasOtherOwner) {
        return res.status(403).send("Only the label owner can download this batch");
      }
    }

    const pdfLayout = normalizePdfLayout(req.body?.pdfLayout || labels[0]?.pdfLayout);
    const pdfBuffer = await createPdfBuffer(
      await Promise.all(
        labels.map(async (label) => ({
          data: serializeLabel(label),
          qr: await QRCode.toDataURL(labelPublicUrl(req, label._id)),
        }))
      ),
      { layout: pdfLayout }
    );

    sendPdf(res, pdfBuffer, labels.length > 1 ? "batch-labels.pdf" : "label.pdf");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating batch PDF");
  }
});

router.get("/labels/:id/pdf", async (req, res) => {
  try {
    const label = await labelStore.getById(req.params.id);

    if (!label) {
      return res.status(404).send("Label not found");
    }

    const data = serializeLabel(label);
    const qr = await QRCode.toDataURL(labelPublicUrl(req, label._id));
    const pdfBuffer = await createPdfBuffer([{ data, qr }], { layout: data.pdfLayout });

    sendPdf(res, pdfBuffer, `label-${data.drumNo || label._id}.pdf`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating label PDF");
  }
});

router.get("/labels/:id", async (req, res) => {
  try {
    const label = await labelStore.getById(req.params.id);

    if (!label) {
      return res.status(404).json({ message: "Label not found" });
    }

    res.json(serializeLabel(label));
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Invalid label id" });
  }
});

router.delete("/labels/:id", async (req, res) => {
  try {
    const existingLabel = await labelStore.getById(req.params.id);

    if (!existingLabel) {
      return res.status(404).json({ message: "Label not found" });
    }

    const requestOwnerPhone = normalizePhone(req.query.ownerPhone || req.body?.ownerPhone);
    const labelOwnerPhone = normalizePhone(existingLabel.ownerPhone);

    if (!requestOwnerPhone || (labelOwnerPhone && requestOwnerPhone !== labelOwnerPhone)) {
      return res.status(403).json({ message: "Only the label owner can delete this record" });
    }

    const label = await labelStore.deleteById(req.params.id);

    res.json({ message: "Label deleted" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Invalid label id" });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const data = normalizeLabelData(req.body);
    const drumItems = getDrumItems(data);
    const pdfLayout = normalizePdfLayout(data.pdfLayout);

    if (!drumItems.length) {
      return res.status(400).send("At least one drum number is required");
    }

    const savedLabels = await mapWithConcurrency(
      drumItems,
      10,
      async (drumItem) => {
        const labelData = {
          ...data,
          pdfLayout,
          drumNo: drumItem.drumNo,
          netWt: drumItem.netWt,
          tareWt: drumItem.tareWt,
          grossWt: drumItem.grossWt,
        };
        const saved = await labelStore.create(labelData);

        return {
          data: labelData,
          id: saved._id,
        };
      }
    );

    const labels = await Promise.all(
      savedLabels.map(async (label) => ({
        data: label.data,
        qr: await QRCode.toDataURL(labelPublicUrl(req, label.id)),
      }))
    );

    const pdfBuffer = await createPdfBuffer(
      labels.map((label) => ({
        data: label.data,
        qr: label.qr,
      })),
      { layout: pdfLayout }
    );

    sendPdf(res, pdfBuffer, labels.length > 1 ? "labels.pdf" : "label.pdf");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating label");
  }
});

module.exports = router;

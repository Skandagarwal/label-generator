const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { labelStore } = require("../services/dataStore");
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

const manufacturerLogo = imageDataUrl("logoAgEx.png", "image/png");

const getManufacturerLogo = (value = "") =>
  String(value).startsWith("data:image/") ? value : manufacturerLogo;

const joinContactParts = (...parts) =>
  parts
    .filter((part) => String(part.value || "").trim())
    .map((part) => `${part.label}: ${part.value}`)
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

const templateValues = (data, qr) => ({
  formatNo: escapeHtml(data.formatNo),
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
  manufacturerContact: escapeHtml(
    joinContactParts(
      { label: "WEBSITE", value: data.manufacturerWebsite },
      { label: "EMAIL", value: data.manufacturerEmail },
      { label: "CELL", value: data.manufacturerPhone }
    )
  ),
  manufacturerLogo: getManufacturerLogo(data.manufacturerLogo),
  qrCode: qr,
});

const renderLabelsHtml = (template, labels) => {
  const labelStart = template.indexOf('<div class="label">');
  const labelEnd = template.lastIndexOf("</div>");

  if (labelStart === -1 || labelEnd === -1) {
    throw new Error("Label template wrapper not found");
  }

  const beforeLabel = template.slice(0, labelStart);
  const labelBlock = template.slice(labelStart, labelEnd + 6);
  const afterLabel = template.slice(labelEnd + 6);
  const filledLabels = labels
    .map(({ data, qr }) => fillTemplate(labelBlock, templateValues(data, qr)))
    .join("\n");

  return `${beforeLabel}${filledLabels}${afterLabel}`;
};

const createPdf = async (labels) => {
  let browser;
  let pdfPath;

  try {
    const template = fs.readFileSync(
      path.join(__dirname, "../utils/template.html"),
      "utf-8"
    );
    const renderedTemplate = renderLabelsHtml(template, labels);

    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    const page = await browser.newPage();
    await page.setContent(renderedTemplate, {
      waitUntil: "domcontentloaded",
      timeout: 0,
    });

    await page.evaluate(() =>
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
      )
    );

    pdfPath = path.join(os.tmpdir(), `labels-${Date.now()}.pdf`);

    await page.pdf({
      path: pdfPath,
      format: "A4",
      landscape: true,
      preferCSSPageSize: true,
      printBackground: true,
    });

    await browser.close();
    browser = null;

    return pdfPath;
  } catch (err) {
    console.error("PDF generation failed:", err.stack || err.message || err);

    if (browser) {
      await browser.close();
    }

    if (pdfPath) {
      fs.unlink(pdfPath, () => {});
    }

    throw err;
  }
};

const downloadPdf = (res, pdfPath, fileName) => {
  res.download(pdfPath, fileName, (downloadErr) => {
    fs.unlink(pdfPath, (unlinkErr) => {
      if (unlinkErr) {
        console.error("Could not delete temporary PDF:", unlinkErr.message);
      }
    });

    if (downloadErr && !res.headersSent) {
      res.status(500).send("Error downloading label");
    }
  });
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

router.get("/labels/:id/pdf", async (req, res) => {
  try {
    const label = await labelStore.getById(req.params.id);

    if (!label) {
      return res.status(404).send("Label not found");
    }

    const data = serializeLabel(label);
    const qr = await QRCode.toDataURL(labelPublicUrl(req, label._id));
    const pdfPath = await createPdf([{ data, qr }]);

    downloadPdf(res, pdfPath, `label-${data.drumNo || label._id}.pdf`);
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

    if (!drumItems.length) {
      return res.status(400).send("At least one drum number is required");
    }

    const labels = [];

    for (const drumItem of drumItems) {
      const labelData = {
        ...data,
        drumNo: drumItem.drumNo,
        netWt: drumItem.netWt,
        tareWt: drumItem.tareWt,
        grossWt: drumItem.grossWt,
      };
      const saved = await labelStore.create(labelData);
      const qr = await QRCode.toDataURL(labelPublicUrl(req, saved._id));

      labels.push({
        data: labelData,
        qr,
        id: saved._id,
      });
    }

    const pdfPath = await createPdf(
      labels.map((label) => ({
        data: label.data,
        qr: label.qr,
      }))
    );

    downloadPdf(res, pdfPath, labels.length > 1 ? "labels.pdf" : "label.pdf");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating label");
  }
});

module.exports = router;

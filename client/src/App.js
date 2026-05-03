import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { hasFirebaseWebConfig, sendFirebaseOtp } from "./firebaseAuth";
import "./App.css";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (window.location.hostname === "localhost" && window.location.port === "3000"
    ? "http://localhost:5050/api"
    : "/api");
const DRUM_ROWS_BATCH_SIZE = 10;

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

const downloadLabelPdf = async (label) => {
  const res = await axios.get(`${API_BASE}/labels/${label._id}/pdf`, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");

  a.href = url;
  a.download = `label-${safeFilePart(label.drumNo || label._id)}.pdf`;
  a.click();
  window.URL.revokeObjectURL(url);
};

const labelsApiUrl = () => {
  const ownerPhone = getSavedPhone();
  const params = ownerPhone ? `?ownerPhone=${encodeURIComponent(ownerPhone)}` : "";

  return `${API_BASE}/labels${params}`;
};

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
      <span className="brand-mark" aria-hidden="true">BM</span>
      <div>
        <p>BatchMark</p>
        {!compact && <span>Batch Label System</span>}
      </div>
    </div>
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

    if (firebaseConfirmation) {
      firebaseConfirmation
        .confirm(otp)
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
          setStatus("Could not verify OTP.");
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
          <p className="login-copy">Enter your name and phone number, verify the OTP, and continue to the label workspace.</p>
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
                onChange={(e) => setOtp(e.target.value)}
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
      <header className="app-topbar">
        <div>
          <BrandLockup compact />
          <h1>Profile</h1>
        </div>
        <nav className="topbar-actions">
          <a className="button-link secondary-link" href="/home">Home</a>
          <a className="button-link secondary-link" href="/create">Create Label</a>
          <button className="secondary-button" type="button" onClick={onLogout}>
            Logout
          </button>
        </nav>
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
  const [downloadingId, setDownloadingId] = useState("");

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

  const handleDownload = async (label) => {
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

  return (
    <main className="page-shell">
      <header className="app-topbar">
        <div>
          <BrandLockup compact />
          <h1>Dashboard</h1>
        </div>
        <nav className="topbar-actions">
          <a className="button-link" href="/create">Create Label</a>
          <a className="button-link secondary-link" href="/history">History</a>
          <a className="button-link secondary-link" href="/profile">Profile</a>
          <button className="secondary-button" type="button" onClick={onLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Welcome, {userName}</p>
          <h2>Manage drum labels in one place.</h2>
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
          <a className="button-link secondary-link" href="/history">
            View All
          </a>
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
                  <button
                    className="row-action"
                    type="button"
                    onClick={() => handleDownload(label)}
                    disabled={downloadingId === label._id}
                  >
                    {downloadingId === label._id ? "Downloading..." : "Download"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function HistoryPage() {
  const [labels, setLabels] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("loading");
  const [downloadingId, setDownloadingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [labelToDelete, setLabelToDelete] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState("");
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

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

  const confirmHistoryDelete = async () => {
    if (!labelToDelete) {
      return;
    }

    setDeletingId(labelToDelete._id);

    try {
      await axios.delete(`${API_BASE}/labels/${labelToDelete._id}`);
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
      for (const label of selectedLabels) {
        await downloadLabelPdf(label);
      }
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
      await Promise.all(selectedLabels.map((label) => axios.delete(`${API_BASE}/labels/${label._id}`)));
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
      <header className="site-header">
        <div>
          <BrandLockup compact />
          <h1>Created Labels</h1>
        </div>
        <div className="header-actions history-header-actions">
          <a className="button-link secondary-link" href="/create">
            New Label
          </a>
        </div>
      </header>

      <section className="history-card">
        <div className="history-toolbar">
          <div>
            <h2>All labels</h2>
            <p>{labels.length} saved label record(s)</p>
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
            <p>{selectedIds.length} selected</p>
            <button
              className="secondary-button"
              type="button"
              onClick={handleBulkDownload}
              disabled={!selectedIds.length || Boolean(bulkAction)}
            >
              {bulkAction === "download" ? "Downloading..." : "Download Selected"}
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={!selectedIds.length || Boolean(bulkAction)}
            >
              {bulkAction === "delete" ? "Deleting..." : "Delete Selected"}
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
          <div className="history-list">
            {filteredLabels.map((label) => (
              <article className="history-row selectable-history-row" key={label._id}>
                <label className="row-select" aria-label={`Select ${getLabelName(label)}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(label._id)}
                    onChange={() => toggleSelected(label._id)}
                  />
                </label>
                <div>
                  <p className="history-title">{label.commodity || "Untitled Label"}</p>
                  <p className="history-meta">
                    Drum {label.drumNo || "-"} · Lot {label.lotNo || "-"}
                  </p>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{label.customerName || "-"}</dd>
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
                    {downloadingId === label._id ? "Downloading..." : "Download"}
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
    </main>
  );
}

function LabelDetails({ id }) {
  const [label, setLabel] = useState(null);
  const [status, setStatus] = useState("loading");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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

  const handleDetailDelete = async () => {
    setIsDeleting(true);

    try {
      await axios.delete(`${API_BASE}/labels/${label._id}`);
      window.location.href = "/history";
    } catch (err) {
      console.error(err);
      alert("Could not delete this label.");
      setIsDeleting(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="label-preview">
        <div className="preview-header">
          <h1>{label.commodity || "Generated Label"}</h1>
          <span className="eyebrow">Format No: {label.formatNo || "-"}</span>
        </div>

        <dl className="details-grid">
          {fields
            .filter((field) => field.name !== "formatNo")
            .map((field) => (
              <div key={field.name}>
                <dt>{field.label}</dt>
                <dd>{label[field.name] || "-"}</dd>
              </div>
            ))}
        </dl>

        <div className="detail-actions">
          <button type="button" onClick={handleDetailDownload} disabled={isDownloading || isDeleting}>
            {isDownloading ? "Downloading..." : "Download PDF"}
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            disabled={isDeleting || isDownloading}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
          <a className="button-link" href="/create">Create another label</a>
          <a className="button-link secondary-link" href="/history">History</a>
        </div>
      </section>

      {showDeleteDialog && (
        <DeleteConfirmDialog
          labelName={getLabelName(label)}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={handleDetailDelete}
          busy={isDeleting}
        />
      )}
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
  const currentManufacturerDetails = getSavedManufacturerDetails(currentUser);
  const currentManufacturer = currentManufacturerDetails.manufacturer || currentUser;
  const currentPath = window.location.pathname;
  const isHistoryPage = currentPath === "/history";
  const isHomePage = currentPath === "/" || currentPath === "/home";
  const isProfilePage = currentPath === "/profile";

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

  useEffect(() => {
    if (currentUser) {
      setForm((values) => applyUserDefaults(values, currentUser));
    }
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

  const handleReset = () => {
    setForm(applyUserDefaults(emptyForm, currentUser));
    setDrumItems([emptyDrumItem()]);
    setVisibleDrumCount(DRUM_ROWS_BATCH_SIZE);
    setBulkDrumText("");
    setQuickDrumSetup({ count: "", netWt: "", tareWt: "" });
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

    try {
      const payload = {
        ...form,
        ...currentManufacturerDetails,
        ownerPhone: getSavedPhone(),
        manufacturer: currentManufacturer,
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
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem("labelUserName");
    window.localStorage.removeItem("labelUserPhone");
    setCurrentUser("");
    window.history.pushState({}, "", "/login");
  };

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }

  if (labelId) {
    return <LabelDetails id={labelId} />;
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

  if (isHistoryPage) {
    return <HistoryPage />;
  }

  return (
    <main className="page-shell">
      <header className="site-header">
        <div>
          <BrandLockup compact />
          <h1>Label Generator</h1>
        </div>
        <div className="header-actions">
          <a className="button-link secondary-link" href="/home">
            Home
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
          <button form="label-form" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Generating..." : "Generate PDF"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <form id="label-form" className="label-form" onSubmit={handleSubmit}>
          {fieldGroups.map((group) => (
            <div className="form-group-block" key={group.title}>
              <section className="form-section">
                <div className="section-heading">
                  <h2>{group.title}</h2>
                </div>

                <div className="form-grid">
                  {group.fields.map((fieldName) => {
                    const field = fieldsByName[fieldName];
                    const isManufacturerField = field.name === "manufacturer";
                    const fieldValue = isManufacturerField
                      ? currentManufacturer
                      : form[field.name];

                    return (
                      <label
                        key={field.name}
                        className={field.multiline ? "field field-wide" : "field"}
                      >
                        <span>{field.label}</span>
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
                <section className="form-section">
            <div className="section-heading section-heading-with-action">
              <div>
                <h2>Drum Weights</h2>
                <p>Each row generates one label with its own weight values.</p>
              </div>
              <button className="secondary-button" type="button" onClick={addDrumItem}>
                Add Drum
              </button>
            </div>

            <div className="bulk-drum-import">
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
              <label>
                <span>Paste Different Weights</span>
                <textarea
                  value={bulkDrumText}
                  onChange={(e) => setBulkDrumText(e.target.value)}
                  placeholder={"25, 3.640\n24.950, 3.640\n25.100, 3.640"}
                  rows="4"
                />
              </label>
              <div className="bulk-drum-actions">
                <small>Use one line per drum: Net Wt., Tare Wt. Gross Wt. is calculated automatically.</small>
                <button className="secondary-button" type="button" onClick={applyPastedDrumWeights}>
                  Apply Weight List
                </button>
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

          <div className="mobile-actions">
            <a className="button-link secondary-link" href="/home">
              Home
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
            {statusMessage && <p className="status-message">{statusMessage}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;

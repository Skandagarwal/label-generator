import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (window.location.hostname === "localhost" && window.location.port === "3000"
    ? "http://localhost:5050/api"
    : "/api");

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
  { name: "license", label: "License Number" },
  { name: "manufacturer", label: "Manufacturer", multiline: true },
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
      "bestBefore",
    ],
  },
  {
    title: "Customer And Compliance",
    fields: ["customerName", "customerAddress", "storage", "license", "manufacturer"],
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

const emptyDrumItem = (drumNo = "") => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  drumNo,
  netWt: "",
  tareWt: "",
  grossWt: "",
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
  const match = String(drumNo).trim().match(/^(.*?)(\d+)(\/\d+)?([^0-9]*)$/);

  if (!match) {
    return "";
  }

  const nextNumber = String(Number(match[2]) + 1).padStart(match[2].length, "0");

  return `${match[1]}${nextNumber}${match[3] || ""}${match[4] || ""}`;
};

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

const calculateBestBefore = (mfgDate) => {
  const parsed = parseDate(mfgDate);

  if (!parsed) {
    return "";
  }

  const bestBefore = new Date(parsed);
  bestBefore.setFullYear(bestBefore.getFullYear() + 2);
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

const getSavedUser = () =>
  window.localStorage.getItem("labelUserName") ||
  window.localStorage.getItem("labelUserPhone") ||
  "";
const getSavedPhone = () => window.localStorage.getItem("labelUserPhone") || "";

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

function LoginPage({ onLogin }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("phone");
  const [devOtp, setDevOtp] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    if (step === "phone") {
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

    axios
      .post(`${API_BASE}/auth/verify-otp`, { name, phone, otp })
      .then((res) => {
        const userName = name.trim() || res.data.user?.name || phone;

        window.localStorage.setItem("labelUserName", userName);
        window.localStorage.setItem("labelUserPhone", phone);
        onLogin(userName);
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
          <p className="eyebrow">PDF Label Tool</p>
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
                }}
              >
                Change Number
              </button>
            )}
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Please wait..." : step === "phone" ? "Send OTP" : "Verify OTP"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function ProfilePage({ userName, onUserUpdate, onLogout }) {
  const [name, setName] = useState(userName);
  const [phone, setPhone] = useState(getSavedPhone);
  const [status, setStatus] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextName = name.trim() || "Vendor";
    const nextPhone = phone.trim();

    window.localStorage.setItem("labelUserName", nextName);
    window.localStorage.setItem("labelUserPhone", nextPhone);
    onUserUpdate(nextName);
    setStatus("Profile updated.");
  };

  return (
    <main className="page-shell">
      <header className="app-topbar">
        <div>
          <p className="eyebrow">Account</p>
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
            {(name.trim() || "V").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="eyebrow">Vendor Profile</p>
            <h2>{name.trim() || "Vendor"}</h2>
            <p>{phone || "No phone number saved"}</p>
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
          {status && <p className="login-status">{status}</p>}
          <button type="submit">Save Profile</button>
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
      .get(`${API_BASE}/labels`)
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
          <p className="eyebrow">PDF Label Tool</p>
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

  useEffect(() => {
    let active = true;

    axios
      .get(`${API_BASE}/labels`)
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

  return (
    <main className="page-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Label History</p>
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
              <article className="history-row" key={label._id}>
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
          <button type="button" onClick={handleDetailDownload} disabled={isDownloading}>
            {isDownloading ? "Downloading..." : "Download PDF"}
          </button>
          <a className="button-link" href="/create">Create another label</a>
          <a className="button-link secondary-link" href="/history">History</a>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState(getSavedUser);
  const [form, setForm] = useState(emptyForm);
  const [drumItems, setDrumItems] = useState([emptyDrumItem()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
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

  const handleChange = (e) => {
    setStatusMessage("");
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleMfgDateChange = (e) => {
    const { value } = e.target;
    const nextForm = {
      ...form,
      mfgDate: value,
    };

    if (!form.bestBefore.trim()) {
      nextForm.bestBefore = toInputDate(calculateBestBefore(value));
    }

    setStatusMessage("");
    setForm(nextForm);
  };

  const handleReset = () => {
    setForm(emptyForm);
    setDrumItems([emptyDrumItem()]);
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
  };

  const removeDrumItem = (id) => {
    setStatusMessage("");
    setDrumItems((items) =>
      items.length === 1 ? [emptyDrumItem()] : items.filter((item) => item.id !== id)
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const payload = {
        ...form,
        drumItems: validDrumItems.map(({ drumNo, netWt, tareWt, grossWt }) => ({
          drumNo,
          netWt: formatWeight(netWt),
          tareWt: formatWeight(tareWt),
          grossWt: grossWt || calculateGrossWeight(netWt, tareWt),
        })),
        drumNo: validDrumItems.map((item) => item.drumNo).join("\n"),
        mfgDate: normalizeDateValue(form.mfgDate),
        bestBefore:
          normalizeDateValue(form.bestBefore) ||
          calculateBestBefore(form.mfgDate),
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
          <p className="eyebrow">PDF Label Tool</p>
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

                    return (
                      <label
                        key={field.name}
                        className={field.multiline ? "field field-wide" : "field"}
                      >
                        <span>{field.label}</span>
                        {field.multiline ? (
                          <textarea
                            name={field.name}
                            value={form[field.name]}
                            placeholder={field.placeholder}
                            onChange={handleChange}
                            required={field.required}
                            rows="3"
                          />
                        ) : (
                          <input
                            name={field.name}
                            type={field.type || "text"}
                            value={form[field.name]}
                            placeholder={field.placeholder}
                            onChange={
                              field.name === "mfgDate"
                                ? handleMfgDateChange
                                : handleChange
                            }
                            required={field.required}
                          />
                        )}
                        {field.helper && <small>{field.helper}</small>}
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

            <div className="drum-table">
              <div className="drum-table-head">
                <span>Drum No</span>
                <span>Net Wt.</span>
                <span>Tare Wt.</span>
                <span>Gross Wt.</span>
                <span></span>
              </div>

              {drumItems.map((item, index) => (
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
            </dl>
            {statusMessage && <p className="status-message">{statusMessage}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;

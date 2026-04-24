import { auth, db, firebaseConfig, storage } from "./firebase-config.js";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getDownloadURL, ref } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const PAGE_SIZE = 20;
const appState = {
  page: document.body.dataset.page,
  user: null,
  profile: null,
  sites: [],
  selectedSite: "all",
  siteMap: new Map(),
  liveUnsubs: {},
  charts: {},
  activityBuckets: {
    attendance: [],
    dpr: [],
    images: []
  },
  attendance: {
    pageIndex: 0,
    cursors: [null],
    lastVisible: null,
    docs: [],
    filteredRows: []
  },
  dpr: {
    docs: []
  },
  images: {
    docs: []
  },
  users: {
    docs: []
  }
};

const toDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateTime = (value) => {
  const date = normalizeToDate(value);
  if (!date) return "-";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const formatDateOnly = (value) => {
  const date = normalizeToDate(value);
  if (!date) return "-";
  return date.toLocaleDateString();
};

const normalizeToDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getElement = (id) => document.getElementById(id);

const showLoader = (label = "Loading...") => {
  const loader = getElement("globalLoader");
  if (!loader) return;
  const paragraph = loader.querySelector("p");
  if (paragraph) paragraph.textContent = label;
  loader.classList.remove("hidden");
};

const hideLoader = () => {
  const loader = getElement("globalLoader");
  if (loader) loader.classList.add("hidden");
};

const showToast = (message, variant = "info") => {
  const root = getElement("toastRoot");
  if (!root) return;
  const node = document.createElement("div");
  node.className = `toast ${variant === "error" ? "error" : ""}`.trim();
  node.textContent = message;
  root.appendChild(node);
  window.setTimeout(() => {
    node.remove();
  }, 3600);
};

const clearLiveListeners = () => {
  Object.values(appState.liveUnsubs).forEach((unsub) => {
    if (typeof unsub === "function") unsub();
  });
  appState.liveUnsubs = {};
};

const setLiveListener = (key, unsub) => {
  if (appState.liveUnsubs[key]) appState.liveUnsubs[key]();
  appState.liveUnsubs[key] = unsub;
};

const clearCharts = () => {
  Object.values(appState.charts).forEach((chart) => {
    if (chart?.destroy) chart.destroy();
  });
  appState.charts = {};
};

const isSuperAdmin = () => appState.profile?.role === "super_admin";
const hasAdminPanelAccess = () => ["super_admin", "admin"].includes(appState.profile?.role);

const guardFirebaseConfig = () => {
  const missing = [
    "REPLACE_WITH_API_KEY",
    "REPLACE_WITH_AUTH_DOMAIN",
    "REPLACE_WITH_PROJECT_ID",
    "REPLACE_WITH_STORAGE_BUCKET",
    "REPLACE_WITH_MESSAGING_SENDER_ID",
    "REPLACE_WITH_APP_ID"
  ];

  const configText = JSON.stringify(firebaseConfig || {});
  if (missing.some((token) => configText.includes(token))) {
    showToast("Firebase config is not set. Update js/firebase-config.js.", "error");
  }
};

const fetchUserProfile = async (uid) => {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
};

const loadAccessibleSites = async () => {
  appState.siteMap = new Map();

  if (isSuperAdmin()) {
    const q = query(collection(db, "sites"), orderBy("name"), limit(300));
    const snap = await getDocs(q);
    const sites = snap.docs.map((siteDoc) => {
      const data = siteDoc.data();
      return {
        id: siteDoc.id,
        name: data.name || data.siteName || siteDoc.id,
        isActive: data.isActive !== false
      };
    });

    sites.forEach((site) => appState.siteMap.set(site.id, site.name));
    return sites;
  }

  const siteIds = Array.isArray(appState.profile?.sites)
    ? appState.profile.sites
    : Array.isArray(appState.profile?.siteIds)
      ? appState.profile.siteIds
      : [];

  const siteDocs = await Promise.all(siteIds.map((id) => getDoc(doc(db, "sites", id))));
  const sites = siteDocs.map((siteSnap, index) => {
    if (siteSnap.exists()) {
      const data = siteSnap.data();
      return {
        id: siteSnap.id,
        name: data.name || data.siteName || siteSnap.id,
        isActive: data.isActive !== false
      };
    }

    return {
      id: siteIds[index],
      name: siteIds[index],
      isActive: true
    };
  });

  sites.forEach((site) => appState.siteMap.set(site.id, site.name));
  return sites;
};

const renderSiteSelector = () => {
  const selector = getElement("siteSelector");
  if (!selector) return;

  selector.innerHTML = "";

  if (isSuperAdmin()) {
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Sites";
    selector.appendChild(allOption);
  }

  appState.sites.forEach((site) => {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.name;
    selector.appendChild(option);
  });

  if (!appState.selectedSite || (!isSuperAdmin() && appState.selectedSite === "all")) {
    appState.selectedSite = isSuperAdmin() ? "all" : appState.sites[0]?.id || "all";
  }

  if (appState.selectedSite !== "all" && !appState.sites.some((site) => site.id === appState.selectedSite)) {
    appState.selectedSite = isSuperAdmin() ? "all" : appState.sites[0]?.id || "all";
  }

  selector.value = appState.selectedSite;
};

const applyRoleUi = () => {
  const badge = getElement("userBadge");
  if (badge) badge.textContent = (appState.profile?.role || "-").replace("_", " ");

  const superOnlyLinks = document.querySelectorAll("[data-requires-super='true']");
  superOnlyLinks.forEach((node) => {
    node.classList.toggle("hidden", !isSuperAdmin());
  });
};

const bindCommonEvents = () => {
  const logoutButton = getElement("logoutBtn");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "index.html";
    });
  }

  const selector = getElement("siteSelector");
  if (selector) {
    selector.addEventListener("change", () => {
      appState.selectedSite = selector.value;
      bootstrapPageData();
    });
  }
};

const redirectIfUnauthorized = () => {
  if (!hasAdminPanelAccess()) {
    showToast("Unauthorized access.", "error");
    signOut(auth).finally(() => {
      window.location.href = "index.html";
    });
    return true;
  }

  if (appState.page === "users" && !isSuperAdmin()) {
    showToast("Only super admins can access user management.", "error");
    window.location.href = "dashboard.html";
    return true;
  }

  return false;
};

const bootstrapPageData = () => {
  clearLiveListeners();
  clearCharts();

  switch (appState.page) {
    case "dashboard":
      initDashboardPage();
      break;
    case "attendance":
      initAttendancePage();
      break;
    case "dpr":
      initDprPage();
      break;
    case "images":
      initImagesPage();
      break;
    case "users":
      initUsersPage();
      break;
    default:
      break;
  }
};

const initLoginPage = async () => {
  await setPersistence(auth, browserLocalPersistence);

  const form = getElement("loginForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = getElement("email")?.value?.trim();
    const password = getElement("password")?.value;

    if (!email || !password) {
      showToast("Email and password are required.", "error");
      return;
    }

    showLoader("Signing in...");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Login successful.");
    } catch (error) {
      showToast(error.message || "Sign-in failed.", "error");
    } finally {
      hideLoader();
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const profile = await fetchUserProfile(user.uid);
      if (["admin", "super_admin"].includes(profile?.role)) {
        window.location.href = "dashboard.html";
      }
    } catch (error) {
      showToast("Failed to resolve user role.", "error");
    }
  });
};

const initProtectedApp = async () => {
  await setPersistence(auth, browserLocalPersistence);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    showLoader("Loading admin panel...");
    try {
      appState.user = user;
      appState.profile = await fetchUserProfile(user.uid);

      if (!appState.profile) {
        showToast("User record is missing in Firestore users collection.", "error");
        await signOut(auth);
        window.location.href = "index.html";
        return;
      }

      if (redirectIfUnauthorized()) return;

      appState.sites = await loadAccessibleSites();
      renderSiteSelector();
      applyRoleUi();
      bindCommonEvents();
      bootstrapPageData();
    } catch (error) {
      showToast(error.message || "Failed to load app data.", "error");
    } finally {
      hideLoader();
    }
  });
};

const selectedSiteConstraint = () => (appState.selectedSite !== "all" ? [where("siteId", "==", appState.selectedSite)] : []);

const updateKpi = (id, value) => {
  const el = getElement(id);
  if (el) el.textContent = `${value ?? 0}`;
};

const buildLast7DayKeys = () => {
  const keys = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    keys.push(toDateKey(date));
  }
  return keys;
};

const createOrUpdateChart = (key, canvasId, type, labels, datasets, options = {}) => {
  const canvas = getElement(canvasId);
  if (!canvas || typeof Chart === "undefined") return;

  if (appState.charts[key]) {
    appState.charts[key].destroy();
  }

  appState.charts[key] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#d8e9ff" } }
      },
      scales: {
        x: { ticks: { color: "#b6cae6" }, grid: { color: "rgba(157,177,204,0.12)" } },
        y: { ticks: { color: "#b6cae6" }, grid: { color: "rgba(157,177,204,0.12)" }, beginAtZero: true }
      },
      ...options
    }
  });
};

const initDashboardPage = () => {
  const today = toDateKey();

  const workersQuery = query(
    collection(db, "users"),
    where("role", "==", "worker"),
    ...(appState.selectedSite !== "all" ? [where("sites", "array-contains", appState.selectedSite)] : []),
    limit(500)
  );
  setLiveListener("kpi-workers", onSnapshot(workersQuery, (snap) => updateKpi("kpiTotalWorkers", snap.size)));

  const attendanceQuery = query(
    collection(db, "attendance"),
    where("dateKey", "==", today),
    ...selectedSiteConstraint(),
    limit(600)
  );
  setLiveListener(
    "kpi-attendance",
    onSnapshot(attendanceQuery, (snap) => {
      const rows = snap.docs.map((item) => item.data());
      const present = rows.filter((row) => ["present", "working", "checked_in"].includes((row.status || "").toLowerCase())).length;
      const absent = rows.filter((row) => (row.status || "").toLowerCase() === "absent").length;
      updateKpi("kpiPresentToday", present);
      updateKpi("kpiAbsentToday", absent);
    })
  );

  if (appState.selectedSite === "all") {
    const activeSitesQuery = query(collection(db, "sites"), where("isActive", "==", true), limit(500));
    setLiveListener("kpi-sites", onSnapshot(activeSitesQuery, (snap) => updateKpi("kpiActiveSites", snap.size)));
  } else {
    updateKpi("kpiActiveSites", 1);
  }

  const projectsQuery = query(collection(db, "projects"), ...selectedSiteConstraint(), limit(500));
  setLiveListener("kpi-projects", onSnapshot(projectsQuery, (snap) => updateKpi("kpiTotalProjects", snap.size)));

  const keys = buildLast7DayKeys();
  const startKey = keys[0];

  const attendanceTrendQuery = query(
    collection(db, "attendance"),
    where("dateKey", ">=", startKey),
    ...selectedSiteConstraint(),
    orderBy("dateKey", "asc"),
    limit(900)
  );
  setLiveListener(
    "chart-attendance",
    onSnapshot(attendanceTrendQuery, (snap) => {
      const buckets = Object.fromEntries(keys.map((key) => [key, 0]));
      snap.docs.forEach((record) => {
        const data = record.data();
        const status = (data.status || "").toLowerCase();
        if (["present", "working", "checked_in"].includes(status) && buckets[data.dateKey] !== undefined) {
          buckets[data.dateKey] += 1;
        }
      });

      createOrUpdateChart(
        "attendanceTrend",
        "attendanceTrendChart",
        "line",
        keys,
        [
          {
            label: "Present",
            data: keys.map((key) => buckets[key]),
            borderColor: "#20d6ba",
            backgroundColor: "rgba(32,214,186,0.2)",
            tension: 0.25,
            fill: true
          }
        ]
      );
    })
  );

  const dprProgressQuery = query(
    collection(db, "dpr"),
    where("dateKey", ">=", startKey),
    ...selectedSiteConstraint(),
    orderBy("dateKey", "asc"),
    limit(900)
  );
  setLiveListener(
    "chart-progress",
    onSnapshot(dprProgressQuery, (snap) => {
      const buckets = Object.fromEntries(keys.map((key) => [key, 0]));
      snap.docs.forEach((record) => {
        const data = record.data();
        if (buckets[data.dateKey] !== undefined) {
          const quantity = Number(data.quantity) || 0;
          buckets[data.dateKey] += quantity;
        }
      });

      createOrUpdateChart(
        "workProgress",
        "workProgressChart",
        "bar",
        keys,
        [
          {
            label: "Progress Quantity",
            data: keys.map((key) => Number(buckets[key].toFixed(2))),
            backgroundColor: "rgba(52,185,255,0.45)",
            borderColor: "#34b9ff",
            borderWidth: 1
          }
        ]
      );
    })
  );

  const materialQuery = query(
    collection(db, "materialLogs"),
    where("dateKey", ">=", startKey),
    ...selectedSiteConstraint(),
    orderBy("dateKey", "asc"),
    limit(900)
  );
  setLiveListener(
    "chart-materials",
    onSnapshot(materialQuery, (snap) => {
      const usage = {};
      snap.docs.forEach((record) => {
        const data = record.data();
        const key = data.materialName || data.material || "Unknown";
        usage[key] = (usage[key] || 0) + (Number(data.quantityUsed ?? data.quantity) || 0);
      });

      const labels = Object.keys(usage).slice(0, 8);
      const values = labels.map((label) => Number(usage[label].toFixed(2)));

      createOrUpdateChart(
        "materials",
        "materialUsageChart",
        "doughnut",
        labels.length ? labels : ["No Data"],
        [
          {
            label: "Material Usage",
            data: labels.length ? values : [1],
            backgroundColor: [
              "rgba(32,214,186,0.85)",
              "rgba(52,185,255,0.8)",
              "rgba(255,182,71,0.8)",
              "rgba(255,111,127,0.8)",
              "rgba(115,173,255,0.82)",
              "rgba(126,224,196,0.8)",
              "rgba(255,227,140,0.83)",
              "rgba(255,151,164,0.8)"
            ]
          }
        ],
        {
          scales: undefined
        }
      );
    })
  );

  const renderActivity = () => {
    const feed = getElement("activityFeed");
    const empty = getElement("activityEmpty");
    if (!feed || !empty) return;

    const merged = [
      ...appState.activityBuckets.attendance,
      ...appState.activityBuckets.dpr,
      ...appState.activityBuckets.images
    ]
      .sort((a, b) => (b.ts?.getTime?.() || 0) - (a.ts?.getTime?.() || 0))
      .slice(0, 16);

    feed.innerHTML = "";
    if (!merged.length) {
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    merged.forEach((item) => {
      const li = document.createElement("li");
      li.className = "activity-item";
      li.innerHTML = `<p>${item.title}</p><p class="activity-meta">${item.meta} • ${formatDateTime(item.ts)}</p>`;
      feed.appendChild(li);
    });
  };

  const attendanceActivityQuery = query(
    collection(db, "attendance"),
    ...selectedSiteConstraint(),
    orderBy("checkIn", "desc"),
    limit(8)
  );
  setLiveListener(
    "activity-attendance",
    onSnapshot(attendanceActivityQuery, (snap) => {
      appState.activityBuckets.attendance = snap.docs.map((record) => {
        const data = record.data();
        const name = data.workerName || data.name || "Worker";
        return {
          title: `${name} attendance updated`,
          meta: data.siteName || appState.siteMap.get(data.siteId) || data.siteId || "Site",
          ts: normalizeToDate(data.checkIn || data.updatedAt || data.createdAt)
        };
      });
      renderActivity();
    })
  );

  const dprActivityQuery = query(
    collection(db, "dpr"),
    ...selectedSiteConstraint(),
    orderBy("createdAt", "desc"),
    limit(8)
  );
  setLiveListener(
    "activity-dpr",
    onSnapshot(dprActivityQuery, (snap) => {
      appState.activityBuckets.dpr = snap.docs.map((record) => {
        const data = record.data();
        return {
          title: "New DPR entry submitted",
          meta: data.siteName || appState.siteMap.get(data.siteId) || data.siteId || "Site",
          ts: normalizeToDate(data.createdAt || data.updatedAt)
        };
      });
      renderActivity();
    })
  );

  const imageActivityQuery = query(
    collection(db, "imageMeta"),
    ...selectedSiteConstraint(),
    orderBy("uploadedAt", "desc"),
    limit(8)
  );
  setLiveListener(
    "activity-images",
    onSnapshot(imageActivityQuery, (snap) => {
      appState.activityBuckets.images = snap.docs.map((record) => {
        const data = record.data();
        return {
          title: "Image upload captured",
          meta: data.siteName || appState.siteMap.get(data.siteId) || data.siteId || "Site",
          ts: normalizeToDate(data.uploadedAt || data.createdAt)
        };
      });
      renderActivity();
    })
  );

  const reportButton = getElement("downloadDashboardReport");
  if (reportButton) {
    reportButton.addEventListener("click", () => {
      const report = {
        generatedAt: new Date().toISOString(),
        site: appState.selectedSite,
        kpis: {
          totalWorkers: getElement("kpiTotalWorkers")?.textContent || "0",
          presentToday: getElement("kpiPresentToday")?.textContent || "0",
          absentToday: getElement("kpiAbsentToday")?.textContent || "0",
          activeSites: getElement("kpiActiveSites")?.textContent || "0",
          totalProjects: getElement("kpiTotalProjects")?.textContent || "0"
        }
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard-report-${toDateKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
};

const attendanceStatusClass = (status) => {
  const normalized = (status || "").toLowerCase();
  if (normalized === "absent") return "absent";
  if (normalized === "working") return "working";
  return "present";
};

const applyAttendanceSearch = () => {
  const search = (getElement("attendanceSearch")?.value || "").trim().toLowerCase();
  appState.attendance.filteredRows = appState.attendance.docs.filter((row) => {
    if (!search) return true;
    const name = (row.workerName || row.name || "").toLowerCase();
    const role = (row.role || "").toLowerCase();
    return name.includes(search) || role.includes(search);
  });
  renderAttendanceTable();
};

const renderAttendanceTable = () => {
  const tbody = getElement("attendanceTableBody");
  const empty = getElement("attendanceEmpty");
  if (!tbody || !empty) return;

  const rows = appState.attendance.filteredRows;
  tbody.innerHTML = "";

  if (!rows.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const status = row.status || "Present";
      tr.innerHTML = `
        <td>${row.workerName || row.name || "-"}</td>
        <td>${row.role || "-"}</td>
        <td>${formatDateTime(row.checkIn)}</td>
        <td>${formatDateTime(row.checkOut)}</td>
        <td><span class="status-pill ${attendanceStatusClass(status)}">${status}</span></td>
        <td>${row.siteName || appState.siteMap.get(row.siteId) || row.siteId || "-"}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const pageInfo = getElement("attendancePageInfo");
  if (pageInfo) pageInfo.textContent = `Page ${appState.attendance.pageIndex + 1}`;

  const prevButton = getElement("attendancePrev");
  const nextButton = getElement("attendanceNext");

  if (prevButton) prevButton.disabled = appState.attendance.pageIndex === 0;
  if (nextButton) nextButton.disabled = appState.attendance.docs.length < PAGE_SIZE;
};

const subscribeAttendancePage = () => {
  const date = getElement("attendanceDate")?.value;
  const role = getElement("attendanceRole")?.value;

  const constraints = [];
  if (date) constraints.push(where("dateKey", "==", date));
  constraints.push(...selectedSiteConstraint());
  if (role) constraints.push(where("role", "==", role));
  constraints.push(orderBy("checkIn", "desc"));
  constraints.push(limit(PAGE_SIZE));

  const cursor = appState.attendance.cursors[appState.attendance.pageIndex];
  if (cursor) constraints.push(startAfter(cursor));

  const attendanceQuery = query(collection(db, "attendance"), ...constraints);

  setLiveListener(
    "attendance-page",
    onSnapshot(
      attendanceQuery,
      (snap) => {
        appState.attendance.docs = snap.docs.map((record) => ({ id: record.id, ...record.data() }));
        appState.attendance.lastVisible = snap.docs[snap.docs.length - 1] || null;
        applyAttendanceSearch();
      },
      (error) => showToast(error.message || "Attendance stream failed.", "error")
    )
  );
};

const resetAttendancePagination = () => {
  appState.attendance.pageIndex = 0;
  appState.attendance.cursors = [null];
  appState.attendance.lastVisible = null;
  subscribeAttendancePage();
};

const exportAttendanceCsv = () => {
  const rows = appState.attendance.filteredRows;
  if (!rows.length) {
    showToast("No records to export.", "error");
    return;
  }

  const header = ["Worker Name", "Role", "Check-in", "Check-out", "Status", "Site"];
  const csvRows = rows.map((row) => [
    row.workerName || row.name || "",
    row.role || "",
    formatDateTime(row.checkIn),
    formatDateTime(row.checkOut),
    row.status || "",
    row.siteName || appState.siteMap.get(row.siteId) || row.siteId || ""
  ]);

  const csv = [header, ...csvRows]
    .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${toDateKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const initAttendancePage = () => {
  const dateInput = getElement("attendanceDate");
  if (dateInput && !dateInput.value) dateInput.value = toDateKey();

  appState.attendance.pageIndex = 0;
  appState.attendance.cursors = [null];
  appState.attendance.lastVisible = null;
  appState.attendance.docs = [];
  appState.attendance.filteredRows = [];

  const roleInput = getElement("attendanceRole");
  const searchInput = getElement("attendanceSearch");

  dateInput?.addEventListener("change", resetAttendancePagination);
  roleInput?.addEventListener("change", resetAttendancePagination);
  searchInput?.addEventListener("input", applyAttendanceSearch);

  getElement("attendancePrev")?.addEventListener("click", () => {
    if (appState.attendance.pageIndex === 0) return;
    appState.attendance.pageIndex -= 1;
    subscribeAttendancePage();
  });

  getElement("attendanceNext")?.addEventListener("click", () => {
    if (appState.attendance.docs.length < PAGE_SIZE || !appState.attendance.lastVisible) return;
    appState.attendance.pageIndex += 1;
    appState.attendance.cursors[appState.attendance.pageIndex] = appState.attendance.lastVisible;
    subscribeAttendancePage();
  });

  getElement("attendanceExport")?.addEventListener("click", exportAttendanceCsv);

  subscribeAttendancePage();
};

const renderDprTable = () => {
  const tbody = getElement("dprTableBody");
  const empty = getElement("dprEmpty");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";
  if (!appState.dpr.docs.length) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  appState.dpr.docs.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${entry.dateKey || formatDateOnly(entry.date)}</td>
      <td>${entry.siteName || appState.siteMap.get(entry.siteId) || entry.siteId || "-"}</td>
      <td>${entry.workDescription || entry.description || "-"}</td>
      <td>${entry.quantity ?? "-"}</td>
      <td>${entry.remarks || "-"}</td>
    `;
    tbody.appendChild(tr);
  });
};

const subscribeDpr = () => {
  const date = getElement("dprDate")?.value;

  const constraints = [...selectedSiteConstraint()];
  if (date) constraints.push(where("dateKey", "==", date));

  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(120));

  const dprQuery = query(collection(db, "dpr"), ...constraints);

  setLiveListener(
    "dpr-stream",
    onSnapshot(
      dprQuery,
      (snap) => {
        appState.dpr.docs = snap.docs.map((record) => ({ id: record.id, ...record.data() }));
        renderDprTable();
      },
      (error) => showToast(error.message || "DPR stream failed.", "error")
    )
  );
};

const initDprPage = () => {
  const dateInput = getElement("dprDate");
  dateInput?.addEventListener("change", subscribeDpr);

  getElement("dprClearFilters")?.addEventListener("click", () => {
    if (dateInput) dateInput.value = "";
    subscribeDpr();
  });

  subscribeDpr();
};

const enrichImage = async (docSnap) => {
  const data = docSnap.data();
  let downloadURL = data.downloadURL || "";

  if (!downloadURL && data.storagePath) {
    try {
      downloadURL = await getDownloadURL(ref(storage, data.storagePath));
    } catch (error) {
      downloadURL = "";
    }
  }

  return {
    id: docSnap.id,
    ...data,
    downloadURL
  };
};

const renderImageGrid = () => {
  const grid = getElement("imageGrid");
  const empty = getElement("imageEmpty");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  if (!appState.images.docs.length) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  appState.images.docs.forEach((image, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = "image-card";

    wrapper.innerHTML = `
      <button type="button" data-image-index="${index}">
        <img src="${image.downloadURL || "https://via.placeholder.com/640x420?text=No+Preview"}" alt="Site upload" loading="lazy" />
        <div class="meta">
          <strong>${image.siteName || appState.siteMap.get(image.siteId) || image.siteId || "Site"}</strong>
          <span>${formatDateTime(image.uploadedAt || image.createdAt)}</span>
          <span>By: ${image.uploaderName || image.uploader || "-"}</span>
        </div>
      </button>
    `;

    grid.appendChild(wrapper);
  });
};

const openImageModal = (image) => {
  const modal = getElement("imageModal");
  if (!modal) return;

  getElement("modalImage").src = image.downloadURL || "https://via.placeholder.com/640x420?text=No+Preview";
  getElement("modalSite").textContent = image.siteName || appState.siteMap.get(image.siteId) || image.siteId || "-";
  getElement("modalDate").textContent = formatDateTime(image.uploadedAt || image.createdAt);
  getElement("modalUploader").textContent = image.uploaderName || image.uploader || "-";

  modal.classList.remove("hidden");
};

const initImagesPage = () => {
  const constraints = [...selectedSiteConstraint(), orderBy("uploadedAt", "desc"), limit(40)];
  const imageQuery = query(collection(db, "imageMeta"), ...constraints);

  setLiveListener(
    "images-stream",
    onSnapshot(
      imageQuery,
      async (snap) => {
        const docs = await Promise.all(snap.docs.map(enrichImage));
        appState.images.docs = docs;
        renderImageGrid();
      },
      (error) => showToast(error.message || "Image stream failed.", "error")
    )
  );

  getElement("imageGrid")?.addEventListener("click", (event) => {
    const trigger = event.target.closest("button[data-image-index]");
    if (!trigger) return;
    const index = Number(trigger.dataset.imageIndex);
    const image = appState.images.docs[index];
    if (image) openImageModal(image);
  });

  getElement("closeImageModal")?.addEventListener("click", () => {
    getElement("imageModal")?.classList.add("hidden");
  });

  getElement("imageModal")?.addEventListener("click", (event) => {
    if (event.target.id === "imageModal") {
      getElement("imageModal")?.classList.add("hidden");
    }
  });
};

const populateUserSitesSelect = () => {
  const select = getElement("userSites");
  if (!select) return;
  select.innerHTML = "";

  appState.sites.forEach((site) => {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.name;
    select.appendChild(option);
  });
};

const fillUserForm = (user) => {
  getElement("userUid").value = user.uid || "";
  getElement("userName").value = user.name || "";
  getElement("userEmail").value = user.email || "";
  getElement("userRole").value = user.role || "worker";

  const select = getElement("userSites");
  if (!select) return;
  const assigned = Array.isArray(user.sites) ? user.sites : [];
  Array.from(select.options).forEach((option) => {
    option.selected = assigned.includes(option.value);
  });
};

const renderUsersTable = () => {
  const tbody = getElement("usersTableBody");
  const empty = getElement("usersEmpty");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";
  if (!appState.users.docs.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  appState.users.docs.forEach((user) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${user.name || "-"}</td>
      <td>${user.email || "-"}</td>
      <td>${user.role || "-"}</td>
      <td>${Array.isArray(user.sites) ? user.sites.join(", ") : "-"}</td>
      <td>
        <div class="action-row">
          <button class="btn btn-secondary" data-action="edit" data-uid="${user.uid}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-uid="${user.uid}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
};

const subscribeUsers = () => {
  const usersQuery = query(collection(db, "users"), orderBy("role", "asc"), limit(400));
  setLiveListener(
    "users-stream",
    onSnapshot(
      usersQuery,
      (snap) => {
        appState.users.docs = snap.docs.map((record) => ({ uid: record.id, ...record.data() }));
        renderUsersTable();
      },
      (error) => showToast(error.message || "User stream failed.", "error")
    )
  );
};

const initUsersPage = () => {
  populateUserSitesSelect();
  subscribeUsers();

  const form = getElement("userForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const uid = getElement("userUid").value.trim();
    const name = getElement("userName").value.trim();
    const email = getElement("userEmail").value.trim();
    const role = getElement("userRole").value;
    const siteSelect = getElement("userSites");
    const sites = Array.from(siteSelect.selectedOptions).map((option) => option.value);

    if (!uid || !name || !email) {
      showToast("UID, name, and email are required.", "error");
      return;
    }

    try {
      await setDoc(
        doc(db, "users", uid),
        {
          name,
          email,
          role,
          sites,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      showToast("User saved successfully.");
      form.reset();
      populateUserSitesSelect();
    } catch (error) {
      showToast(error.message || "Failed to save user.", "error");
    }
  });

  getElement("userFormReset")?.addEventListener("click", () => {
    form?.reset();
    populateUserSitesSelect();
  });

  getElement("usersTableBody")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const uid = button.dataset.uid;
    const action = button.dataset.action;
    const user = appState.users.docs.find((entry) => entry.uid === uid);
    if (!user) return;

    if (action === "edit") {
      fillUserForm(user);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (action === "delete") {
      if (user.role === "super_admin") {
        showToast("Super admin records cannot be deleted here.", "error");
        return;
      }
      const ok = window.confirm("Delete this user profile from Firestore?");
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "users", uid));
        showToast("User deleted.");
      } catch (error) {
        showToast(error.message || "Delete failed.", "error");
      }
    }
  });
};

const startApp = () => {
  guardFirebaseConfig();

  if (appState.page === "login") {
    initLoginPage();
  } else {
    initProtectedApp();
  }
};

startApp();

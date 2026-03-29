const root = document.getElementById("app");

const ROLE_LABELS = {
  member: "Mitglied",
  moderator: "Moderator",
  planner: "Leitung",
  admin: "Admin"
};

const REQUEST_STATUSES = [
  { value: "offen", label: "Offen" },
  { value: "in_planung", label: "In Planung" },
  { value: "beruecksichtigt", label: "Beruecksichtigt" }
];

const SHIFT_WINDOW_PRESETS = [
  { value: "12:00|16:00", label: "Kernschicht 12:00 - 16:00" },
  { value: "16:00|20:00", label: "Kernschicht 16:00 - 20:00" },
  { value: "20:00|00:00", label: "Kernschicht 20:00 - 00:00" },
  { value: "00:00|04:00", label: "Kernschicht 00:00 - 04:00" },
  { value: "04:00|08:00", label: "Kernschicht 04:00 - 08:00" },
  { value: "08:00|12:00", label: "Kernschicht 08:00 - 12:00" },
  { value: "10:00|14:00", label: "Zwischenschicht 10:00 - 14:00" },
  { value: "14:00|18:00", label: "Zwischenschicht 14:00 - 18:00" },
  { value: "18:00|22:00", label: "Zwischenschicht 18:00 - 22:00" },
  { value: "22:00|02:00", label: "Zwischenschicht 22:00 - 02:00" },
  { value: "02:00|06:00", label: "Zwischenschicht 02:00 - 06:00" },
  { value: "06:00|10:00", label: "Zwischenschicht 06:00 - 10:00" }
];
const CHAT_TRIM_OPTIONS = [20, 30, 40, 50];
const SONARA_ART_PATH = "/sonara-crest.png";
let portalRefreshTimer = 0;

const state = {
  session: null,
  data: null,
  publicData: null,
  vrchatOverview: null,
  vrchatLoading: false,
  discordStatus: null,
  discordLoading: false,
  ui: {
    editingShiftId: "",
    flash: null,
    activeTab: "",
    liveChatConnected: false,
    notificationPermission: "default",
    tabBarScrollLeft: 0,
    tabViewportScrollY: null,
    scrollToShiftId: "",
    plannerDraft: null
  }
};

root.addEventListener("submit", handleSubmit);
root.addEventListener("click", handleClick);
root.addEventListener("change", handleChange);

boot();

async function boot() {
  syncNotificationPermission();
  await refreshBootstrap();
  if (!state.session) {
    await refreshPublicData();
  }
  if (canManageUsers()) {
    await refreshDiscordStatus(false);
    await refreshVrchatOverview(false);
  }
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin",
    ...options
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || "Anfrage fehlgeschlagen.");
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function refreshBootstrap() {
  try {
    const payload = await api("/api/bootstrap");
    applyPayload(payload);
  } catch (error) {
    if (error.status === 401) {
      state.session = null;
      state.data = null;
      await refreshPublicData();
      return;
    }
    setFlash(error.message, "danger");
  }
}

async function refreshPublicData() {
  try {
    state.publicData = await api("/api/public");
  } catch (error) {
    setFlash(error.message, "danger");
  }
}

async function refreshVrchatOverview(showErrors = true) {
  if (!canManageUsers()) return;
  state.vrchatLoading = true;

  try {
    const payload = await api("/api/admin/vrchat/overview");
    state.vrchatOverview = payload.overview;
  } catch (error) {
    if (showErrors) setFlash(error.message, "danger");
  } finally {
    state.vrchatLoading = false;
    render();
  }
}

async function refreshDiscordStatus(showErrors = true) {
  if (!canManageUsers()) return;
  state.discordLoading = true;

  try {
    const payload = await api("/api/admin/discord/status");
    state.discordStatus = payload.status;
  } catch (error) {
    if (showErrors) setFlash(error.message, "danger");
  } finally {
    state.discordLoading = false;
    render();
  }
}

async function runDiscordTest() {
  state.discordLoading = true;
  render();

  try {
    const payload = await api("/api/admin/discord/test", {
      method: "POST",
      body: "{}"
    });
    state.discordStatus = payload.status;
    setFlash("Discord-Testnachricht wurde gesendet.", "success");
  } catch (error) {
    try {
      const statusPayload = await api("/api/admin/discord/status");
      state.discordStatus = statusPayload.status;
    } catch {}
    setFlash(error.message, "danger");
  } finally {
    state.discordLoading = false;
    render();
  }
}

async function runVrchatSync() {
  state.vrchatLoading = true;
  render();

  try {
    const payload = await api("/api/admin/vrchat/sync", {
      method: "POST",
      body: "{}"
    });
    state.vrchatOverview = payload.overview;
    setFlash(payload.message || "VRChat-Daten wurden synchronisiert.", payload.ok ? "success" : "info");
  } catch (error) {
    setFlash(error.message, "danger");
  } finally {
    state.vrchatLoading = false;
    render();
  }
}

async function submitVrchatSecurityCode(code) {
  state.vrchatLoading = true;
  render();

  try {
    const payload = await api("/api/admin/vrchat/verify-code", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    state.vrchatOverview = payload.overview;
    setFlash(payload.message || "VRChat-Sicherheitscode wurde bestätigt.", "success");
  } catch (error) {
    try {
      const payload = await api("/api/admin/vrchat/overview");
      state.vrchatOverview = payload.overview;
    } catch {}
    setFlash(error.message, "danger");
  } finally {
    state.vrchatLoading = false;
    render();
  }
}

function applyPayload(payload) {
  state.session = payload?.session || null;
  state.data = payload?.data || null;
  state.ui.activeTab = normalizeActiveTab(state.ui.activeTab);
  if (!canManageUsers()) {
    state.vrchatOverview = null;
    state.vrchatLoading = false;
    state.discordStatus = null;
    state.discordLoading = false;
  }
}

function renderSonaraHero({ eyebrow, title, intro, chips = [] }) {
  return `
    <header class="site-header sonara-header">
      <div class="sonara-copy">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="intro sonara-intro">${escapeHtml(intro)}</p>
        <div class="hero-chip-row">
          ${chips.map((chip) => `<span class="hero-chip">${escapeHtml(chip)}</span>`).join("")}
        </div>
      </div>
      <div class="sonara-art-card">
        <div class="sonara-art-glow"></div>
        <img src="${SONARA_ART_PATH}" alt="SONARA Wappen" class="sonara-art">
      </div>
    </header>
  `;
}

function render() {
  root.innerHTML = state.session ? renderDashboard() : renderPublicPortal();
  restoreTabBarState();
  restorePlannerFocus();
  syncChatStream();
  syncPortalRefreshLoop();
  syncNotificationPermission();
  emitBrowserNotifications();
}

function syncPortalRefreshLoop() {
  if (portalRefreshTimer) return;

  portalRefreshTimer = window.setInterval(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    if (state.session) {
      await refreshBootstrap();
    } else {
      await refreshPublicData();
    }

    render();
  }, 60000);
}

function restoreTabBarState() {
  const tabBar = root.querySelector(".tab-bar");
  if (!tabBar) return;

  tabBar.scrollLeft = Number(state.ui.tabBarScrollLeft || 0);
  tabBar.addEventListener(
    "scroll",
    () => {
      state.ui.tabBarScrollLeft = tabBar.scrollLeft;
    },
    { passive: true }
  );

  const activeChip = tabBar.querySelector(".tab-chip.active");
  if (activeChip) {
    activeChip.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  if (typeof state.ui.tabViewportScrollY === "number") {
    const restoreY = state.ui.tabViewportScrollY;
    state.ui.tabViewportScrollY = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top: restoreY, behavior: "auto" });
    });
  }
}

function rememberTabBarState(sourceElement = null) {
  const tabBar = sourceElement?.closest?.(".tab-bar") || root.querySelector(".tab-bar");
  if (!tabBar) return;

  state.ui.tabBarScrollLeft = tabBar.scrollLeft;
  state.ui.tabViewportScrollY = window.scrollY;
}

function restorePlannerFocus() {
  const shiftId = String(state.ui.scrollToShiftId || "").trim();
  if (!shiftId) return;

  state.ui.scrollToShiftId = "";
  requestAnimationFrame(() => {
    const target = document.getElementById(`shift-card-${shiftId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function performAction(callback, successMessage = "", successTone = "success") {
  try {
    const payload = await callback();
    if (payload?.session || payload?.data) applyPayload(payload);
    if (successMessage) setFlash(successMessage, successTone);
    if (state.session?.role === "admin" && !state.vrchatOverview) {
      void refreshVrchatOverview(false);
    }
  } catch (error) {
    if (error.status === 401) {
      state.session = null;
      state.data = null;
      setFlash("Bitte erneut anmelden.", "warning");
    } else {
      setFlash(error.message, "danger");
    }
  }

  render();
}

function renderPublicPortal() {
  const community = getCommunityData();
  const stats = community.stats || {};
  const eyebrow = "SONARA Community Portal";
  const title = "Community, News und Team an einem Ort";
  const intro = "Hier landet das Wichtigste aus SONARA: News, Events, Regeln, Community-Team und der Zugang fuer Mitglieder und Staff.";
  const chips = [
    `${stats.members || 0} Mitglieder`,
    `${stats.moderators || 0} Moderatoren`,
    `${(community.events || []).length} Events`
  ];

  return `
    <div class="app-shell">
      ${renderSonaraHero({ eyebrow, title, intro, chips })}

      ${renderFlash()}

      <div class="auth-layout public-grid">
        <section class="panel">
          <p class="eyebrow">Community Einstieg</p>
          <h2>Was du auf der Webseite findest</h2>
          <p class="auth-kicker">
            Die Webseite ist der zentrale Hub fuer die SONARA Community. Oeffentliche News, kommende Events,
            Regeln, Ansprechpartner und der Mitgliederbereich liegen an einem Ort, waehrend Moderation und
            Planung intern getrennt bleiben.
          </p>

          <div class="feature-grid">
            <article class="feature-card">
              <h3>Community News</h3>
              <p>Wichtige Hinweise, Event-Ankuendigungen und sichtbare Updates stehen direkt auf der Seite.</p>
            </article>
            <article class="feature-card">
              <h3>Events</h3>
              <p>Kommende Treffen, Welten und Hosts sind fuer jedes Mitglied schnell sichtbar.</p>
            </article>
            <article class="feature-card">
              <h3>Mitgliederbereich</h3>
              <p>Registrierte Mitglieder bekommen Profil, Feedback, News und Community-Chat.</p>
            </article>
            <article class="feature-card">
              <h3>Staff-Bereich</h3>
              <p>Moderatoren, Leitung und Admins arbeiten intern mit Schichten, Zeiten und Teamtools.</p>
            </article>
          </div>
        </section>

        <div class="auth-stack public-auth-stack">
          <form class="panel auth-card" data-form="login">
            <div>
              <p class="eyebrow">Login</p>
              <h3>Mitglied oder Staff einloggen</h3>
            </div>

            <div class="auth-fieldset">
              <div class="field">
                <label for="loginIdentifier">VRChat-Name oder Discord-Name</label>
                <input id="loginIdentifier" name="identifier" type="text" autocomplete="username" required>
              </div>
              <div class="field">
                <label for="loginPassword">Passwort</label>
                <input id="loginPassword" name="password" type="password" autocomplete="current-password" required>
              </div>
            </div>

            <button type="submit">Einloggen</button>
          </form>

          <form class="panel auth-card" data-form="register">
            <div>
              <p class="eyebrow">Registrierung</p>
              <h3>Neues Community-Konto anlegen</h3>
            </div>

            <div class="auth-fieldset">
              <div class="field">
                <label for="registerVrchatName">VRChat-Name</label>
                <input id="registerVrchatName" name="vrchatName" type="text" required>
              </div>
              <div class="field">
                <label for="registerDiscordName">Discord-Name</label>
                <input id="registerDiscordName" name="discordName" type="text" placeholder="z. B. name oder name#1234" required>
              </div>
              <div class="field">
                <label for="registerAvatarUrl">Profilbild-URL</label>
                <input id="registerAvatarUrl" name="avatarUrl" type="url" placeholder="https://...">
              </div>
              <div class="field">
                <label for="registerBio">Kurzprofil</label>
                <textarea id="registerBio" name="bio" placeholder="Wofuer du in SONARA bekannt sein willst"></textarea>
              </div>
              <div class="field">
                <label for="registerPassword">Passwort</label>
                <input id="registerPassword" name="password" type="password" required>
              </div>
              <div class="field">
                <label for="registerConfirmPassword">Passwort bestaetigen</label>
                <input id="registerConfirmPassword" name="confirmPassword" type="password" required>
              </div>
            </div>

            <p class="login-note">Neue Registrierungen werden automatisch als Community-Mitglied angelegt.</p>
            <button type="submit">Zugang erstellen</button>
          </form>

          <section class="panel demo-card">
            <div class="section-head">
              <div>
                <p class="eyebrow">Hinweis</p>
                <h3>Rollen auf der Seite</h3>
              </div>
            </div>

            <div class="demo-list">
              <div class="demo-item">
                <div>
                  <strong>Mitglied</strong>
                  <p class="subtle">Sieht Community-Bereiche, Profil, News, Events, Chat und Feedback.</p>
                </div>
                <code>Automatische Rolle bei Registrierung</code>
              </div>
              <div class="demo-item">
                <div>
                  <strong>Moderator</strong>
                  <p class="subtle">Bekommt zusaetzlich Staff-Bereiche wie Schichten, Zeiten und Tauschwunsch.</p>
                </div>
                <code>Wird von Leitung/Admin vergeben</code>
              </div>
              <div class="demo-item">
                <div>
                  <strong>Leitung und Admin</strong>
                  <p class="subtle">Verwalten News, Team, Planung, Rollen und spaeter Integrationen.</p>
                </div>
                <code>Nur intern</code>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="dashboard-grid">
        ${renderPublicCommunityOverview()}
        ${renderPublicEventsPanel()}
        ${renderPublicRulesPanel()}
        ${renderPublicTeamPanel()}
      </div>
    </div>
  `;
}

function renderDashboard() {
  const manager = canManagePortal();
  const user = state.session;
  const staff = canAccessStaffArea();
  const activeTab = normalizeActiveTab(state.ui.activeTab);
  const openRequests = (state.data?.requests || []).filter((entry) => entry.status === "offen").length;
  const liveEntries = (state.data?.timeEntries || []).filter((entry) => !entry.checkOutAt).length;
  const upcomingShifts = getSortedShifts(state.data?.shifts || []).slice(0, 1);
  const announcements = getAnnouncementFeed();
  const community = getCommunityData();

  let eyebrow = "SONARA Community";
  let title = "Dein Community-Bereich";
  let intro = "News, Events, Profil und Community-Funktionen liegen fuer dich an einem Ort.";
  let chips = [
    ROLE_LABELS[user.role] || user.role,
    `${announcements.length} News`,
    `${(community.events || []).length} Events`
  ];

  if (manager) {
    eyebrow = "SONARA Leitstand";
    title = "Community und Team steuern";
    intro = "Hier verwaltest du Community-News, Staff-Bereiche, Planung, Feedback und interne Organisation.";
    chips = [
      `${liveEntries} aktiv`,
      `${openRequests} offen`,
      upcomingShifts[0] ? `${formatDate(upcomingShifts[0].date)} | ${formatShiftWindow(upcomingShifts[0])}` : "Keine Schicht offen"
    ];
  } else if (staff) {
    eyebrow = "SONARA Staff";
    title = "Dein Staff-Bereich";
    intro = "Community-Bereich und Moderationsarbeit laufen hier zusammen, ohne dass die Seite unuebersichtlich wird.";
    chips = [
      ROLE_LABELS[user.role] || user.role,
      upcomingShifts[0] ? `${formatDate(upcomingShifts[0].date)} | ${formatShiftWindow(upcomingShifts[0])}` : "Noch kein Einsatz",
      `${(state.data?.notifications || []).length} Hinweise`
    ];
  }

  const toolbarCopy = manager
    ? "Du steuerst Community, Planung, Feedback und den internen Staff-Bereich."
    : staff
      ? "Du siehst Community, Staff-Chat, deine Schichten und deine Zeiten in einem Bereich."
      : "Du nutzt hier deinen Mitgliederbereich mit Profil, News, Events, Feedback und Community-Chat.";

  return `
    <div class="app-shell">
      ${renderSonaraHero({ eyebrow, title, intro, chips })}
      <div class="dashboard-shell">
        ${renderFlash()}
        <section class="panel toolbar">
          <div class="toolbar-user">
            ${renderUserAvatar(user, "toolbar-avatar")}
            <div>
              <p class="eyebrow">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
              <h2>${escapeHtml(getPrimaryDisplayName(user))}</h2>
              <p class="section-copy">${escapeHtml(toolbarCopy)}</p>
            </div>
          </div>

          <div class="toolbar-actions">
            ${canManageUsers() ? '<button type="button" class="ghost small" data-action="reset-demo">Demo wiederherstellen</button>' : ""}
            <button type="button" class="ghost small" data-action="logout">Abmelden</button>
          </div>
        </section>

        ${renderStatsStrip()}
        ${renderDashboardTabs(activeTab)}

        <div class="dashboard-grid focused-grid">
          ${manager ? renderManagerDashboard(activeTab) : staff ? renderModeratorDashboard(activeTab) : renderMemberDashboard(activeTab)}
        </div>
      </div>
    </div>
  `;
}

function renderDashboardTabs(activeTab) {
  let tabs = [];

  if (canManagePortal()) {
    tabs = [
      { id: "overview", label: "Dashboard" },
      { id: "community", label: "Community" },
      { id: "events", label: "Events" },
      { id: "news", label: "News" },
      { id: "feedback", label: "Feedback" },
      { id: "planning", label: "Planung" },
      { id: "team", label: "Team" },
      { id: "chat", label: "Chat" },
      { id: "time", label: "Zeiten" },
      { id: "profile", label: "Profil" },
      { id: "settings", label: "Einstellungen" }
    ];
  } else if (canAccessStaffArea()) {
    tabs = [
      { id: "overview", label: "Dashboard" },
      { id: "community", label: "Community" },
      { id: "events", label: "Events" },
      { id: "news", label: "News" },
      { id: "schedule", label: "Meine Schichten" },
      { id: "feedback", label: "Feedback" },
      { id: "chat", label: "Chat" },
      { id: "time", label: "Zeiten" },
      { id: "profile", label: "Profil" }
    ];
  } else {
    tabs = [
      { id: "overview", label: "Dashboard" },
      { id: "community", label: "Community" },
      { id: "events", label: "Events" },
      { id: "news", label: "News" },
      { id: "feedback", label: "Feedback" },
      { id: "chat", label: "Chat" },
      { id: "profile", label: "Profil" }
    ];
  }

  return `
    <nav class="panel tab-bar" aria-label="Hauptbereiche">
      ${tabs
        .map(
          (tab) => `
            <button
              type="button"
              class="tab-chip ${tab.id === activeTab ? "active" : ""}"
              data-action="set-tab"
              data-tab="${tab.id}"
            >
              ${escapeHtml(tab.label)}
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderStatsStrip() {
  if (canManagePortal()) {
    const memberCount = (state.data.users || []).filter((entry) => entry.role === "member").length;
    const moderatorCount = (state.data.users || []).filter((entry) => entry.role === "moderator").length;
    const liveEntries = (state.data.timeEntries || []).filter((entry) => !entry.checkOutAt).length;
    const openRequests = (state.data.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
    const nextWeekShifts = getSortedShifts(state.data.shifts || []).filter((entry) => daysBetween(getLocalDateKey(), entry.date) <= 7);

    return `
      <section class="stats-strip">
        ${renderStatCard("Mitglieder", memberCount, "Registrierte Community-Accounts", "teal")}
        ${renderStatCard("Moderatoren", moderatorCount, "Aktive Staff-Mitglieder", "amber")}
        ${renderStatCard("Schichten", nextWeekShifts.length, "Einsaetze in den naechsten 7 Tagen", "amber")}
        ${renderStatCard("Offenes Feedback", openRequests, "Rueckmeldungen warten auf Sichtung", "rose")}
        ${renderStatCard("Eingestempelt", liveEntries, "Aktuell aktive Moderatoren", "sky")}
      </section>
    `;
  }

  if (canAccessStaffArea()) {
    const myShifts = getSortedShifts(state.data.shifts || []);
    const nextShift = myShifts.find((entry) => entry.date >= getLocalDateKey());
    const openRequests = (state.data.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
    const activeEntry = getOpenEntryForViewer();
    const totalHours = (state.data.timeEntries || [])
      .filter((entry) => entry.checkOutAt)
      .reduce((total, entry) => total + Math.max(0, new Date(entry.checkOutAt) - new Date(entry.checkInAt)), 0);

    return `
      <section class="stats-strip">
        ${renderStatCard("Naechste Schicht", nextShift ? `${formatDate(nextShift.date)} | ${formatShiftWindow(nextShift)}` : "-", nextShift ? `${nextShift.shiftType} | ${nextShift.world}` : "Noch nichts geplant", "teal")}
        ${renderStatCard("Meine Einsaetze", myShifts.length, "Aktuell in deinem Plan", "amber")}
        ${renderStatCard("Offene Notizen", openRequests, "Rueckmeldungen mit offenem Status", "rose")}
        ${renderStatCard("Erfasste Zeit", formatDuration(totalHours), activeEntry ? "Gerade aktiv eingestempelt" : "Gesamt aus abgeschlossenen Schichten", "sky")}
      </section>
    `;
  }

  const community = getCommunityData();
  const stats = community.stats || {};
  const openRequests = (state.data.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;

  return `
    <section class="stats-strip">
      ${renderStatCard("Community News", getAnnouncementFeed().length, "Aktuelle sichtbare Updates", "teal")}
      ${renderStatCard("Events", (community.events || []).length, "Geplante Community-Termine", "amber")}
      ${renderStatCard("Feedback", openRequests, "Deine offenen Rueckmeldungen", "rose")}
      ${renderStatCard("Staff", (stats.moderators || 0) + (stats.planners || 0), "Moderation und Leitung im Portal", "sky")}
    </section>
  `;

  return `
    <section class="stats-strip">
      ${renderStatCard("Naechste Schicht", nextShift ? `${formatDate(nextShift.date)} · ${formatShiftWindow(nextShift)}` : "-", nextShift ? `${nextShift.shiftType} · ${nextShift.world}` : "Noch nichts geplant", "teal")}
      ${renderStatCard("Meine Einsaetze", myShifts.length, "Aktuell in deinem Plan", "amber")}
      ${renderStatCard("Offene Notizen", openRequests, "Rueckmeldungen mit offenem Status", "rose")}
      ${renderStatCard("Erfasste Zeit", formatDuration(totalHours), activeEntry ? "Gerade aktiv eingestempelt" : "Gesamt aus abgeschlossenen Schichten", "sky")}
    </section>
  `;
}

function renderStatCard(label, value, detail, tone) {
  return `
    <article class="stat-card ${tone}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderManagerDashboard(activeTab) {
  switch (activeTab) {
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "calendar":
      return renderShiftCalendarPanel();
    case "events":
      return renderEventsPanel();
    case "planning":
      return [renderPlannerPanel(), renderSwapPanel(true), renderRequestAdminPanel()].join("");
    case "team":
      return renderTeamPanelV2();
    case "news":
      return renderNewsPanel(true);
    case "feedback":
      return renderFeedbackAdminPanel();
    case "settings":
      return [renderSettingsPanel(), renderDiscordPanel(), renderVrchatAnalyticsPanel()].join("");
    case "time":
      return renderAttendancePanel(true);
    case "chat":
      return [renderAnnouncementsPanel(true), renderChatPanel("staff")].join("");
    case "profile":
      return renderProfilePanel(true);
    case "overview":
    default:
      return [
        renderNotificationsPanel(),
        renderDashboardGuidePanel("manager"),
        renderNewsSpotlightPanel(),
        renderCommunityOverviewPanel(),
        renderRequestAdminPanel()
      ].join("");
  }
}

function renderModeratorDashboard(activeTab) {
  switch (activeTab) {
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "calendar":
      return renderShiftCalendarPanel();
    case "events":
      return renderEventsPanel();
    case "schedule":
      return [renderMySchedulePanel(), renderSwapPanel(false)].join("");
    case "feedback":
      return renderFeedbackMemberPanel();
    case "news":
      return renderNewsPanel(false);
    case "time":
      return renderAttendancePanel(false);
    case "chat":
      return [renderAnnouncementsPanel(false), renderChatPanel("staff")].join("");
    case "profile":
      return renderProfilePanel(false);
    case "overview":
    default:
      return [
        renderNotificationsPanel(),
        renderDashboardGuidePanel("moderator"),
        renderNewsSpotlightPanel(),
        renderMySchedulePanel(),
        renderCommunityOverviewPanel()
      ].join("");
  }
}

function renderMemberDashboard(activeTab) {
  switch (activeTab) {
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "calendar":
      return renderShiftCalendarPanel();
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(false);
    case "feedback":
      return renderFeedbackMemberPanel();
    case "chat":
      return renderChatPanel("community");
    case "profile":
      return renderProfilePanel(false);
    case "overview":
    default:
      return [
        renderNotificationsPanel(),
        renderDashboardGuidePanel("member"),
        renderNewsSpotlightPanel(),
        renderCommunityOverviewPanel()
      ].join("");
  }
}

function renderDashboardGuidePanel(mode) {
  const items =
    mode === "manager"
      ? [
          { title: "Community", text: "Hier pflegst du oeffentliche Bereiche wie Teamvorstellung, Regeln und den Community-Eindruck." },
          { title: "Events", text: "Hier sehen Mitglieder die wichtigsten Termine, Welten und Hosts." },
          { title: "Planung", text: "Hier legst du Schichten, Welten und Aufgaben fuer das Team an." },
          { title: "Team", text: "Hier verwaltest du Rollen, Benutzer und den Ueberblick pro Moderator." },
          { title: "News", text: "Hier veroeffentlichst du sichtbare Community- und Team-News." },
          { title: "Zeiten", text: "Hier siehst du, wer aktiv eingestempelt ist und welche Einsaetze liefen." }
        ]
      : mode === "moderator"
        ? [
            { title: "Community", text: "Hier findest du die oeffentlichen SONARA-Bereiche wie Mitglieder sie sehen." },
            { title: "Meine Schichten", text: "Hier findest du nur deine eigenen Einsaetze mit Welt und Aufgabe." },
            { title: "Feedback", text: "Hier schickst du Feedback, Wuensche und Hinweise an die Leitung." },
            { title: "Chat", text: "Hier laufen Staff-Absprachen und schnelle Rueckfragen." },
            { title: "Zeiten", text: "Hier stempelst du ein und aus und siehst deine Einsatzzeiten." }
          ]
        : [
            { title: "Community", text: "Hier findest du Teamvorstellung, Regeln, FAQ und den Aufbau der Community." },
            { title: "Events", text: "Hier siehst du die kommenden Termine, Welten und Hosts." },
            { title: "News", text: "Hier stehen die aktuellsten Hinweise und Ankuendigungen aus SONARA." },
            { title: "Feedback", text: "Hier schickst du Fragen, Wuensche oder Rueckmeldungen an die Leitung." },
            { title: "Chat", text: "Hier kannst du dich direkt im Portal mit der Community austauschen." }
          ];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Schnellzugriff</p>
          <h2>${mode === "manager" ? "So ist das Portal aufgebaut" : "So findest du dich schnell zurecht"}</h2>
          <p class="section-copy">Jeder Bereich hat genau einen klaren Zweck, damit die Seite uebersichtlich bleibt.</p>
        </div>
      </div>
      <div class="card-list guide-grid">
        ${items
          .map(
            (item) => `
              <article class="mini-card guide-card">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.text)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderNewsSpotlightPanel() {
  const featured = (state.data.announcements || []).slice(0, 2);

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">SONARA News</p>
          <h2>Was gerade in der Community wichtig ist</h2>
          <p class="section-copy">News, Highlights und wichtige Hinweise werden hier direkt im Dashboard sichtbar.</p>
        </div>
      </div>
      <div class="card-list guide-grid">
        ${
          featured.length
            ? featured.map((entry) => renderAnnouncementCard(entry, false)).join("")
            : renderEmptyState("Noch keine News", "Sobald etwas fuer die Community wichtig ist, taucht es hier auf.")
        }
      </div>
    </section>
  `;
}

function renderNotificationsPanel() {
  const notifications = state.data.notifications || [];
  const browserSupport = typeof window !== "undefined" && "Notification" in window;

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Benachrichtigungen</p>
          <h2>Automatische Hinweise fuer Schichten und Team-Infos</h2>
          <p class="section-copy">Heute, morgen und bald anstehende Einsaetze werden hier automatisch zusammengefasst.</p>
        </div>
        ${
          browserSupport
            ? `
              <button
                type="button"
                class="ghost small"
                data-action="enable-browser-notifications"
                ${state.ui.notificationPermission === "granted" ? "disabled" : ""}
              >
                ${
                  state.ui.notificationPermission === "granted"
                    ? "Browser-Popups aktiv"
                    : "Browser-Popups aktivieren"
                }
              </button>
            `
            : '<span class="pill neutral">Browser-Popups nicht verfuegbar</span>'
        }
      </div>

      <div class="card-list notification-list">
        ${
          notifications.length
            ? notifications.map((entry) => renderNotificationCard(entry)).join("")
            : renderEmptyState("Keine neuen Hinweise", "Sobald neue Schichten oder Team-Infos anstehen, erscheinen sie hier.")
        }
      </div>
    </section>
  `;
}

function renderNotificationCard(entry) {
  const tone = entry.tone || "neutral";
  return `
    <article class="mini-card notification-card ${tone}">
      <div class="status-row">
        <span class="pill ${tone === "info" ? "neutral" : tone}">${escapeHtml(entry.category || "Hinweis")}</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
      </div>
      <div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.body)}</p>
      </div>
    </article>
  `;
}

function renderPlannerPanel() {
  const editingShift = (state.data.shifts || []).find((entry) => entry.id === state.ui.editingShiftId) || null;
  const plannerFormValues = getPlannerFormValues(editingShift);
  const users = getAssignableUsers();
  const shifts = getSortedShifts(state.data.shifts || []);
  const plannerGroups = buildPlannerOverviewGroups(shifts);
  const presetValue = getMatchingShiftPresetValue(plannerFormValues.startTime || "12:00", plannerFormValues.endTime || "16:00");
  const shiftsMarkup = renderPlannerGroupedShiftSections(plannerGroups);

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Schichtplanung</p>
          <h2>Welten, Aufgaben und Besetzung</h2>
          <p class="section-copy">Links siehst du direkt, wer schon wie oft eingetragen ist. Unten bleibt alles nach Person sortiert bearbeitbar.</p>
        </div>
        <span class="pill neutral">Auto-Save auf dem Server</span>
      </div>

      <div class="planner-layout">
        ${renderPlannerSidebar(plannerGroups)}

        <div class="planner-editor-stack">
          <form class="stack-form" data-form="shift">
            <div class="form-grid">
              <div class="field">
                <label for="shiftDate">Datum</label>
                <input id="shiftDate" name="date" type="date" value="${escapeHtml(plannerFormValues.date || getLocalDateKey())}" required>
              </div>
              <div class="field">
                <label for="shiftMember">Moderator</label>
                <select id="shiftMember" name="memberId" required>
                  ${buildUserOptions(users, plannerFormValues.memberId || "")}
                </select>
              </div>
              <div class="field">
                <label for="shiftPreset">Schichtfenster</label>
                <select id="shiftPreset" data-change="shift-preset">
                  ${renderShiftPresetOptions(presetValue)}
                </select>
              </div>
              <div class="field">
                <label for="shiftStartTime">Beginn</label>
                <input id="shiftStartTime" name="startTime" type="time" value="${escapeHtml(plannerFormValues.startTime || "12:00")}" required>
              </div>
              <div class="field">
                <label for="shiftEndTime">Ende</label>
                <input id="shiftEndTime" name="endTime" type="time" value="${escapeHtml(plannerFormValues.endTime || "16:00")}" required>
              </div>
              <div class="field">
                <label for="shiftType">Schichttyp</label>
                <input id="shiftType" name="shiftType" list="shiftTypeOptions" value="${escapeHtml(plannerFormValues.shiftType || state.data.settings.shiftTypes?.[0] || "")}" placeholder="z. B. Kernschicht oder Abloese" required>
              </div>
              <div class="field">
                <label for="shiftWorld">Welt</label>
                <input id="shiftWorld" name="world" list="worldOptions" value="${escapeHtml(plannerFormValues.world || state.data.settings.worlds?.[0] || "")}" placeholder="z. B. Community Hub" required>
              </div>
              <div class="field">
                <label for="shiftTask">Aufgabe</label>
                <input id="shiftTask" name="task" list="taskOptions" value="${escapeHtml(plannerFormValues.task || state.data.settings.tasks?.[0] || "")}" placeholder="z. B. Patrouille" required>
              </div>
              <div class="field checkbox-field">
                <label class="checkbox-row" for="shiftIsLead">
                  <input id="shiftIsLead" name="isLead" type="checkbox" ${plannerFormValues.isLead ? "checked" : ""}>
                  <span>Leitung in dieser Instanz</span>
                </label>
                <p class="helper-text">Wird im Kalender besonders hervorgehoben.</p>
              </div>
              <div class="field">
                <label for="shiftNotes">Interne Notiz</label>
                <textarea id="shiftNotes" name="notes" placeholder="Briefing, Besonderheiten oder Ansprechpartner">${escapeHtml(plannerFormValues.notes || "")}</textarea>
              </div>
            </div>

            <datalist id="shiftTypeOptions">${renderDatalistOptions(state.data.settings.shiftTypes)}</datalist>
            <datalist id="worldOptions">${renderDatalistOptions(state.data.settings.worlds)}</datalist>
            <datalist id="taskOptions">${renderDatalistOptions(state.data.settings.tasks)}</datalist>

            <div class="card-actions">
              <button type="submit">${editingShift ? "Aenderung speichern" : "Schicht speichern"}</button>
              ${editingShift ? '<button type="button" class="ghost small" data-action="cancel-shift-edit">Bearbeitung abbrechen</button>' : ""}
            </div>
            <p class="pill-note">Nach jedem neuen Speichern bleiben Moderator, Welt und Aufgabe stehen. Das Datum springt auf den naechsten Tag, damit du eine Woche am Stueck planen kannst.</p>
          </form>

          <div class="planner-hint">
            <h3>Team-Workflow</h3>
            <p>
              Lege hier fest, wer wann welche Welt moderiert und welche Aufgabe uebernimmt.
              Moderatoren sehen spaeter nur ihre eigenen Einsaetze, koennen Wuensche senden und ihre Zeiten erfassen.
            </p>
            <p>
              Die Kernschichten laufen ab 12 Uhr im 4-Stunden-Takt. Fuer Abloesen und Verstaerkung stehen Zwischenschichten bereit,
              und Beginn sowie Ende lassen sich jederzeit frei anpassen.
            </p>
            <p>
              Wenn die Datenbank-Verbindung aktiv ist, bleiben Schichten, Kataloge und Kalender auch nach GitHub-Updates und neuen Deploys erhalten.
            </p>

            <div class="inline-stats">
              <span>${escapeHtml(String(shifts.length))} Schichten gespeichert</span>
              <span>${escapeHtml(String((state.data.settings.worlds || []).length))} Welten im Katalog</span>
              <span>${escapeHtml(String((state.data.requests || []).filter((entry) => entry.status === "offen").length))} neue Rueckmeldungen</span>
            </div>
          </div>

          <form class="stack-form planner-bulk-form" data-form="shift-bulk">
            <div class="section-head">
              <div>
                <p class="eyebrow">Sammelplanung</p>
                <h3>Eine Woche in einem Rutsch planen</h3>
                <p class="section-copy">Ein Moderator = ganze Woche fuer eine Person. Mehrere Moderatoren = gleiche Schicht fuer alle ausgewaehlten Personen.</p>
              </div>
            </div>

            <div class="form-grid">
              <div class="field span-all">
                <label for="bulkMembers">Moderatoren auswaehlen</label>
                <select id="bulkMembers" name="memberIds" multiple size="${Math.min(Math.max(users.length, 4), 8)}" required>
                  ${users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(getPrimaryDisplayName(user))}</option>`).join("")}
                </select>
                <p class="helper-text">Mit Strg oder Cmd kannst du mehrere Moderatoren gleichzeitig auswaehlen. Ein Moderator = Wochenplanung fuer eine Person.</p>
              </div>
              <div class="field">
                <label for="bulkDateStart">Von</label>
                <input id="bulkDateStart" name="dateStart" type="date" value="${escapeHtml(plannerFormValues.date || getLocalDateKey())}" required>
              </div>
              <div class="field">
                <label for="bulkDateEnd">Bis</label>
                <input id="bulkDateEnd" name="dateEnd" type="date" value="${escapeHtml(getNextPlannerDateKey(plannerFormValues.date || getLocalDateKey()))}" required>
              </div>
              <div class="field">
                <label for="bulkStartTime">Beginn</label>
                <input id="bulkStartTime" name="startTime" type="time" value="${escapeHtml(plannerFormValues.startTime || "12:00")}" required>
              </div>
              <div class="field">
                <label for="bulkEndTime">Ende</label>
                <input id="bulkEndTime" name="endTime" type="time" value="${escapeHtml(plannerFormValues.endTime || "16:00")}" required>
              </div>
              <div class="field">
                <label for="bulkShiftType">Schichttyp</label>
                <input id="bulkShiftType" name="shiftType" list="shiftTypeOptions" value="${escapeHtml(plannerFormValues.shiftType || state.data.settings.shiftTypes?.[0] || "")}" required>
              </div>
              <div class="field">
                <label for="bulkWorld">Welt</label>
                <input id="bulkWorld" name="world" list="worldOptions" value="${escapeHtml(plannerFormValues.world || state.data.settings.worlds?.[0] || "")}" required>
              </div>
              <div class="field">
                <label for="bulkTask">Aufgabe</label>
                <input id="bulkTask" name="task" list="taskOptions" value="${escapeHtml(plannerFormValues.task || state.data.settings.tasks?.[0] || "")}" required>
              </div>
              <div class="field checkbox-field">
                <label class="checkbox-row" for="bulkIsLead">
                  <input id="bulkIsLead" name="isLead" type="checkbox" ${plannerFormValues.isLead ? "checked" : ""}>
                  <span>Leitung mitsetzen</span>
                </label>
              </div>
              <div class="field span-all">
                <label>Wochentage</label>
                <div class="weekday-grid">
                  ${renderPlannerWeekdayChecks()}
                </div>
              </div>
              <div class="field span-all">
                <label for="bulkNotes">Interne Notiz</label>
                <textarea id="bulkNotes" name="notes" placeholder="Gleiche Notiz fuer alle angelegten Schichten">${escapeHtml(plannerFormValues.notes || "")}</textarea>
              </div>
            </div>

            <button type="submit">Sammelplanung speichern</button>
          </form>
        </div>
      </div>

      <div class="planner-groups">
        ${shiftsMarkup || renderEmptyState("Noch keine Schichten", "Lege oben den ersten Einsatz an.")}
      </div>
    </section>
  `;
}

function getPlannerFormValues(editingShift) {
  if (editingShift) {
    return {
      date: editingShift.date || getLocalDateKey(),
      memberId: editingShift.memberId || "",
      startTime: editingShift.startTime || "12:00",
      endTime: editingShift.endTime || "16:00",
      shiftType: editingShift.shiftType || state.data.settings.shiftTypes?.[0] || "",
      world: editingShift.world || state.data.settings.worlds?.[0] || "",
      task: editingShift.task || state.data.settings.tasks?.[0] || "",
      notes: editingShift.notes || "",
      isLead: Boolean(editingShift.isLead)
    };
  }

  const draft = state.ui.plannerDraft || {};
  return {
    date: draft.date || getLocalDateKey(),
    memberId: draft.memberId || "",
    startTime: draft.startTime || "12:00",
    endTime: draft.endTime || "16:00",
    shiftType: draft.shiftType || state.data.settings.shiftTypes?.[0] || "",
    world: draft.world || state.data.settings.worlds?.[0] || "",
    task: draft.task || state.data.settings.tasks?.[0] || "",
    notes: draft.notes || "",
    isLead: Boolean(draft.isLead)
  };
}

function rememberPlannerDraft(payload, { advanceDate = false } = {}) {
  const nextDate = advanceDate ? getNextPlannerDateKey(payload.date) : payload.date;
  state.ui.plannerDraft = {
    date: nextDate || getLocalDateKey(),
    memberId: payload.memberId || "",
    startTime: payload.startTime || "12:00",
    endTime: payload.endTime || "16:00",
    shiftType: payload.shiftType || "",
    world: payload.world || "",
    task: payload.task || "",
    notes: payload.notes || "",
    isLead: Boolean(payload.isLead)
  };
}

function getNextPlannerDateKey(dateKey) {
  const normalized = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return getLocalDateKey();

  const [year, month, day] = normalized.split("-").map(Number);
  const nextDate = new Date(year, month - 1, day + 1, 12, 0, 0);
  return getLocalDateKey(nextDate);
}

function renderPlannerWeekdayChecks() {
  return [
    { value: "1", label: "Mo" },
    { value: "2", label: "Di" },
    { value: "3", label: "Mi" },
    { value: "4", label: "Do" },
    { value: "5", label: "Fr" },
    { value: "6", label: "Sa" },
    { value: "0", label: "So" }
  ]
    .map(
      (entry) => `
        <label class="weekday-check">
          <input type="checkbox" name="weekdays" value="${entry.value}" ${Number(entry.value) <= 5 ? "checked" : ""}>
          <span>${escapeHtml(entry.label)}</span>
        </label>
      `
    )
    .join("");
}

function buildBulkShiftEntries(formData) {
  const memberIds = formData
    .getAll("memberIds")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const weekdays = new Set(
    formData
      .getAll("weekdays")
      .map((entry) => Number.parseInt(String(entry || ""), 10))
      .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
  );
  const dateStart = String(formData.get("dateStart") || "").trim();
  const dateEnd = String(formData.get("dateEnd") || "").trim();
  const basePayload = {
    startTime: normalizeTimeValue(formData.get("startTime")),
    endTime: normalizeTimeValue(formData.get("endTime")),
    shiftType: String(formData.get("shiftType") || "").trim(),
    world: String(formData.get("world") || "").trim(),
    task: String(formData.get("task") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    isLead: formData.get("isLead") === "on"
  };

  if (!memberIds.length) {
    throw new Error("Bitte mindestens einen Moderator fuer die Sammelplanung auswaehlen.");
  }
  if (!dateStart || !dateEnd) {
    throw new Error("Bitte Start- und Enddatum fuer die Sammelplanung angeben.");
  }
  if (dateStart > dateEnd) {
    throw new Error("Das Enddatum muss nach dem Startdatum liegen.");
  }
  if (!weekdays.size) {
    throw new Error("Bitte mindestens einen Wochentag fuer die Sammelplanung auswaehlen.");
  }
  if (!basePayload.startTime || !basePayload.endTime || !basePayload.shiftType || !basePayload.world || !basePayload.task) {
    throw new Error("Bitte Beginn, Ende, Schichttyp, Welt und Aufgabe fuer die Sammelplanung ausfuellen.");
  }

  const entries = [];
  const cursor = parseDateKey(dateStart);
  const last = parseDateKey(dateEnd);

  while (cursor <= last) {
    if (weekdays.has(cursor.getDay())) {
      const dateKey = getLocalDateKey(cursor);
      for (const memberId of memberIds) {
        entries.push({
          date: dateKey,
          memberId,
          ...basePayload
        });
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  if (!entries.length) {
    throw new Error("Im gewaelten Zeitraum liegen keine passenden Wochentage.");
  }

  return entries;
}

function buildPlannerOverviewGroups(shifts) {
  const groups = new Map();

  for (const shift of shifts) {
    const groupKey = String(shift.memberId || "");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        memberId: groupKey,
        memberName: shift.memberName || "Unbekannt",
        memberRole: shift.memberRole || "",
        totalHours: 0,
        entries: []
      });
    }

    const group = groups.get(groupKey);
    group.entries.push(shift);
    group.totalHours += getShiftDurationHours(shift);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      shiftCount: group.entries.length,
      dayCount: new Set(group.entries.map((entry) => entry.date)).size,
      entries: group.entries.slice().sort((left, right) => compareShiftValues(left, right))
    }))
    .sort((left, right) => left.memberName.localeCompare(right.memberName, "de"));
}

function compareShiftValues(left, right) {
  if ((left.date || "") !== (right.date || "")) return String(left.date || "").localeCompare(String(right.date || ""));
  if ((left.startTime || "") !== (right.startTime || "")) return compareTimeValues(left.startTime || "", right.startTime || "");
  return String(left.world || "").localeCompare(String(right.world || ""), "de");
}

function renderPlannerSidebar(groups) {
  return `
    <aside class="planner-sidebar">
      <div class="planner-sidebar-head">
        <div>
          <p class="eyebrow">Wochenuebersicht</p>
          <h3>Wer hat was?</h3>
        </div>
        <span class="pill neutral">${escapeHtml(String(groups.length))} Personen</span>
      </div>
      <div class="planner-sidebar-list">
        ${
          groups.length
            ? groups.map((group) => renderPlannerSidebarGroup(group)).join("")
            : renderEmptyState("Noch keine Personen im Plan", "Sobald du Schichten speicherst, erscheint hier die Schnelluebersicht.")
        }
      </div>
    </aside>
  `;
}

function renderPlannerSidebarGroup(group) {
  return `
    <section class="planner-person-card">
      <div class="planner-person-head">
        <div>
          <h3>${escapeHtml(group.memberName)}</h3>
          <p class="timeline-meta">${escapeHtml(ROLE_LABELS[group.memberRole] || roleLabelForUserId(group.memberId))}</p>
        </div>
        <span class="pill amber">${escapeHtml(String(group.shiftCount))} Schichten</span>
      </div>
      <div class="inline-stats planner-inline-stats">
        <span>${escapeHtml(String(group.dayCount))} Tage</span>
        <span>${escapeHtml(formatHoursValue(group.totalHours))}</span>
      </div>
      <div class="planner-jump-list">
        ${group.entries.map((entry) => renderPlannerJumpButton(entry)).join("")}
      </div>
    </section>
  `;
}

function renderPlannerJumpButton(shift) {
  return `
    <button
      type="button"
      class="planner-jump-button ${state.ui.editingShiftId === shift.id ? "active" : ""}"
      data-action="focus-shift"
      data-shift-id="${escapeHtml(shift.id)}"
    >
      <span class="planner-jump-day">${escapeHtml(formatDate(shift.date))}</span>
      <strong>${escapeHtml(`${formatShiftWindow(shift)} · ${shift.world}`)}</strong>
      <span class="timeline-meta">${escapeHtml(`${shift.shiftType}${shift.isLead ? " · Leitung" : ""}`)}</span>
    </button>
  `;
}

function renderPlannerGroupedShiftSections(groups) {
  return groups
    .map(
      (group) => `
        <section class="planner-group">
          <div class="planner-group-head">
            <div>
              <p class="eyebrow">Moderator</p>
              <h3>${escapeHtml(group.memberName)}</h3>
            </div>
            <div class="inline-stats planner-inline-stats">
              <span>${escapeHtml(String(group.shiftCount))} Schichten</span>
              <span>${escapeHtml(String(group.dayCount))} Tage</span>
              <span>${escapeHtml(formatHoursValue(group.totalHours))}</span>
            </div>
          </div>
          <div class="card-list planner-card-list">
            ${group.entries.map((shift) => renderShiftCard(shift, { adminView: true })).join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function renderShiftCard(shift, options = {}) {
  const openEntry = getOpenEntryForShift(shift.id);
  const latestEntry = getLatestEntryForShift(shift.id);
  const status = openEntry ? "live" : latestEntry?.checkOutAt ? "complete" : "pending";
  const statusLabel = openEntry ? "Eingestempelt" : latestEntry?.checkOutAt ? "Abgeschlossen" : "Geplant";
  const statusTone = openEntry ? "teal" : latestEntry?.checkOutAt ? "success" : "amber";
  const todayShift = shift.date === getLocalDateKey();
  const focused = state.ui.editingShiftId === shift.id;

  return `
    <article id="shift-card-${escapeHtml(shift.id)}" class="mini-card ${status} ${focused ? "focused" : ""}">
      <div class="status-row">
        <span class="pill ${todayShift ? "teal" : "neutral"}">${escapeHtml(formatDate(shift.date))}</span>
        ${shift.isLead ? '<span class="pill rose">Leitung</span>' : ""}
        <span class="pill ${statusTone}">${escapeHtml(statusLabel)}</span>
      </div>
      <div>
        <h3>${escapeHtml(options.adminView ? shift.memberName : `${formatShiftWindow(shift)} in ${shift.world}`)}</h3>
        <p>${escapeHtml(options.adminView ? `${formatShiftWindow(shift)} · ${shift.shiftType} · ${shift.world}` : `Aufgabe: ${shift.task}`)}</p>
      </div>
      <div class="shift-meta">
        <span class="subtle">${escapeHtml(options.adminView ? `Aufgabe: ${shift.task}` : `Schicht: ${shift.shiftType} · ${formatShiftWindow(shift)}`)}</span>
        ${options.adminView ? `<span class="subtle">${escapeHtml(roleLabelForUserId(shift.memberId))}</span>` : ""}
      </div>
      <p class="helper-text">Zeitfenster: ${escapeHtml(formatShiftWindow(shift))}</p>
      ${shift.notes ? `<p class="helper-text">${escapeHtml(shift.notes)}</p>` : ""}
      ${
        options.adminView
          ? `
            <div class="card-actions">
              <button type="button" class="ghost small" data-action="edit-shift" data-shift-id="${escapeHtml(shift.id)}">Bearbeiten</button>
              <button type="button" class="danger small" data-action="delete-shift" data-shift-id="${escapeHtml(shift.id)}">Loeschen</button>
            </div>
          `
          : renderShiftActionRow(shift, openEntry)
      }
    </article>
  `;
}

function renderShiftCalendarPanel() {
  const shifts = getSortedShifts(state.data?.calendarShifts || state.data?.shifts || []);
  const days = buildShiftCalendarDays(shifts);
  const events = getCommunityData().events || [];
  const weeks = buildShiftCalendarWeeks(days, events);
  const leadCount = shifts.filter((entry) => entry.isLead).length;
  const worldCount = new Set(shifts.map((entry) => entry.world).filter(Boolean)).size;
  const eventCount = events.length;

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Kalender</p>
          <h2>Wochenkalender fuer Schichten</h2>
          <p class="section-copy">Ein normaler Wochenkalender: pro Tag direkt Uhrzeit, Welt, Leitung und Team.</p>
        </div>
      </div>

      <div class="stats-strip compact-stats">
        ${renderStatCard("Schichten", shifts.length, "Aktuell sichtbare Eintraege", "amber")}
        ${renderStatCard("Kalenderwochen", weeks.length, "Wochen mit geplanter Besetzung", "sky")}
        ${renderStatCard("Leitungen", leadCount, "Markierte Instanz-Leitungen", "rose")}
        ${renderStatCard("Welten", worldCount, "Einsatzorte im Plan", "teal")}
        ${renderStatCard("Events", eventCount, "Community-Termine im Kalender", "sky")}
      </div>

      <div class="calendar-weeks">
        ${
          weeks.length
            ? weeks.map((week) => renderShiftCalendarWeek(week)).join("")
            : renderEmptyState("Noch keine Schichten im Kalender", "Sobald Schichten geplant sind, erscheinen sie hier als Wochenkalender.")
        }
      </div>
    </section>
  `;
}

function renderShiftCalendarDay(day) {
  return `
    <article class="calendar-day">
      <div class="calendar-day-head">
        <div>
          <p class="eyebrow">Kalendertag</p>
          <h3>${escapeHtml(formatDate(day.date))}</h3>
        </div>
        <span class="pill neutral">${escapeHtml(String(day.slots.length))} Schichtfenster</span>
      </div>
      <div class="calendar-agenda">
        ${day.slots.map((slot) => renderShiftCalendarSlot(slot)).join("")}
      </div>
    </article>
  `;
}

function renderShiftCalendarSlot(slot) {
  const leaders = slot.members.filter((entry) => entry.isLead);
  const leaderText = leaders.length ? leaders.map((entry) => entry.memberName).join(", ") : "Noch keine Leitung gesetzt";
  const teamText =
    slot.members
      .map((entry) => `${entry.memberName}${entry.task ? ` (${entry.task})` : ""}${entry.isLead ? " [Leitung]" : ""}`)
      .join(", ") || "Noch niemand eingetragen";

  return `
    <section class="calendar-slot calendar-row">
      <div class="calendar-slot-head calendar-row-head">
        <div>
          <div class="status-row">
            <span class="pill teal">${escapeHtml(slot.windowLabel)}</span>
            <span class="pill amber">${escapeHtml(slot.world)}</span>
            <span class="pill ${leaders.length ? "rose" : "neutral"}">${escapeHtml(leaders.length ? `Leitung: ${leaderText}` : leaderText)}</span>
          </div>
          <h3>${escapeHtml(slot.shiftTypes.join(" · "))}</h3>
          <p class="calendar-row-copy"><strong>Team:</strong> ${escapeHtml(teamText)}</p>
          <p class="calendar-row-copy"><strong>Team:</strong> ${escapeHtml(teamText)}</p>
        </div>
        <p class="pill-note">${escapeHtml(String(slot.members.length))} Personen in dieser Gruppe</p>
      </div>
      <div class="calendar-members">
        ${slot.members.map((entry) => renderShiftCalendarMember(entry)).join("")}
      </div>
    </section>
  `;
}

function renderShiftCalendarMember(entry) {
  return `
    <article class="calendar-member ${entry.isLead ? "lead" : ""}">
      <div class="status-row">
        <h4>${escapeHtml(entry.memberName || "Unbekannt")}</h4>
        <span class="pill ${entry.isLead ? "rose" : "neutral"}">${entry.isLead ? "Leitung" : "Team"}</span>
      </div>
      <p>${escapeHtml(entry.task || "Ohne Aufgabe")}</p>
      <p class="timeline-meta">${escapeHtml(ROLE_LABELS[entry.memberRole] || "Team")}</p>
    </article>
  `;
}

function buildShiftCalendarWeeks(days, events = []) {
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const dateKeys = [...days.map((day) => day.date), ...buildCalendarEventAnchorDates(events)];
  if (!dateKeys.length) return [];

  const sortedDateKeys = dateKeys.slice().sort((left, right) => left.localeCompare(right));
  const firstDate = parseDateKey(sortedDateKeys[0]);
  const lastDate = parseDateKey(sortedDateKeys[sortedDateKeys.length - 1]);
  const start = getStartOfCalendarWeek(firstDate);
  const end = getEndOfCalendarWeek(lastDate);
  const weeks = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 7)) {
    const weekStart = new Date(cursor);
    const weekDays = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const current = new Date(weekStart);
      current.setDate(weekStart.getDate() + offset);
      const dateKey = getLocalDateKey(current);
      const existing = dayMap.get(dateKey);

      weekDays.push({
        date: dateKey,
        weekdayLabel: formatWeekdayLabel(dateKey),
        dayLabel: formatCalendarDayLabel(dateKey),
        isToday: dateKey === getLocalDateKey(),
        slots: existing?.slots || [],
        events: buildCalendarEventEntriesForDate(events, dateKey)
      });
    }

    weeks.push({
      startDate: weekDays[0].date,
      endDate: weekDays[6].date,
      totalSlots: weekDays.reduce((sum, day) => sum + day.slots.length, 0),
      days: weekDays
    });
  }

  return weeks;
}

function buildCalendarEventAnchorDates(events) {
  return (Array.isArray(events) ? events : [])
    .map((entry) => {
      if (entry.scheduleType === "weekly") return getLocalDateKey();
      return String(entry.eventDate || "").trim();
    })
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
}

function renderShiftCalendarWeek(week) {
  return `
    <article class="calendar-week">
      <div class="calendar-week-head">
        <div>
          <p class="eyebrow">Kalenderwoche</p>
          <h3>${escapeHtml(`${formatDate(week.startDate)} bis ${formatDate(week.endDate)}`)}</h3>
        </div>
        <span class="pill neutral">${escapeHtml(String(week.totalSlots))} Schichtfenster</span>
      </div>
      <div class="calendar-week-grid">
        ${week.days.map((day) => renderShiftCalendarDayCell(day)).join("")}
      </div>
    </article>
  `;
}

function renderShiftCalendarDayCell(day) {
  const totalItems = day.slots.length + day.events.length;
  return `
    <section class="calendar-day-cell ${day.isToday ? "today" : ""}">
      <div class="calendar-day-cell-head">
        <div>
          <p class="eyebrow">${escapeHtml(day.weekdayLabel)}</p>
          <h4>${escapeHtml(day.dayLabel)}</h4>
        </div>
        <span class="pill ${totalItems ? "teal" : "neutral"}">${escapeHtml(String(totalItems))}</span>
      </div>
      <div class="calendar-day-cell-list">
        ${day.events.length ? day.events.map((entry) => renderCalendarEventEntry(entry)).join("") : ""}
        ${
          day.slots.length
            ? day.slots.map((slot) => renderShiftCalendarEntry(slot)).join("")
            : !day.events.length
              ? '<p class="helper-text">Nichts geplant</p>'
              : ""
        }
      </div>
    </section>
  `;
}

function renderShiftCalendarEntry(slot) {
  const leaders = slot.members.filter((entry) => entry.isLead);
  const leaderText = leaders.length ? leaders.map((entry) => entry.memberName).join(", ") : "Keine Leitung";
  const teamText = slot.members.map((entry) => entry.memberName).join(", ");

  return `
    <article class="calendar-entry ${leaders.length ? "lead" : ""}">
      <p class="calendar-entry-time">${escapeHtml(slot.windowLabel)}</p>
      <p class="calendar-entry-world">${escapeHtml(slot.world)}</p>
      <p class="calendar-entry-meta"><strong>Leitung:</strong> ${escapeHtml(leaderText)}</p>
      <p class="calendar-entry-meta"><strong>Team:</strong> ${escapeHtml(teamText)}</p>
    </article>
  `;
}

function buildCalendarEventEntriesForDate(events, dateKey) {
  return (Array.isArray(events) ? events : [])
    .filter((entry) => eventOccursOnDate(entry, dateKey))
    .slice()
    .sort((left, right) => compareTimeValues(left.eventTime || "", right.eventTime || ""))
    .map((entry) => ({
      ...entry,
      eventTimeLabel: entry.eventTime ? `${entry.eventTime} Uhr` : entry.dateLabel || ""
    }));
}

function eventOccursOnDate(event, dateKey) {
  if (event.scheduleType === "weekly") {
    return parseDateKey(dateKey).getDay() === Number(event.weekday);
  }
  return String(event.eventDate || "") === String(dateKey || "");
}

function renderCalendarEventEntry(event) {
  return `
    <article class="calendar-entry event">
      <p class="calendar-entry-time">${escapeHtml(event.eventTimeLabel || event.dateLabel || "Event")}</p>
      <p class="calendar-entry-world">${escapeHtml(event.title)}</p>
      <p class="calendar-entry-meta"><strong>Ort:</strong> ${escapeHtml(event.world || "-")}</p>
      <p class="calendar-entry-meta"><strong>Host:</strong> ${escapeHtml(event.host || "-")}</p>
    </article>
  `;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((value) => Number.parseInt(value, 10));
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);
}

function getStartOfCalendarWeek(date) {
  const start = new Date(date);
  const weekday = start.getDay();
  const deltaToMonday = weekday === 0 ? -6 : 1 - weekday;
  start.setDate(start.getDate() + deltaToMonday);
  start.setHours(12, 0, 0, 0);
  return start;
}

function getEndOfCalendarWeek(date) {
  const end = getStartOfCalendarWeek(date);
  end.setDate(end.getDate() + 6);
  return end;
}

function formatWeekdayLabel(dateKey) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(parseDateKey(dateKey));
}

function formatCalendarDayLabel(dateKey) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(parseDateKey(dateKey));
}

function renderCapacityPanel() {
  const rows = buildCapacityRows();
  const totalWorkedHours = rows.reduce((sum, entry) => sum + entry.workedHours, 0);
  const totalPlannedHours = rows.reduce((sum, entry) => sum + entry.plannedHours, 0);
  const totalCapacityHours = rows.reduce((sum, entry) => sum + entry.capacityHours, 0);
  const openHours = rows.reduce((sum, entry) => sum + Math.max(0, entry.capacityHours - entry.plannedHours), 0);

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Auslastung</p>
          <h2>Stunden und Verfuegbarkeit im Blick</h2>
          <p class="section-copy">Hier siehst du pro Moderator geleistete Stunden, geplante Schichten und die gemeldeten Zeitfenster fuer diese Woche. Die Stunden sind nur der Rahmen, entscheidend sind die echten Zeitfenster.</p>
        </div>
      </div>

      <p class="pill-note">Bitte bis Samstag die Verfuegbarkeiten fuer die naechste Woche einsammeln. Ohne Rueckmeldung keine Einplanung; wiederholt fehlend kann zu Verwarnungen fuehren.</p>

      <div class="stats-strip compact-stats">
        ${renderStatCard("Geleistet", formatHoursValue(totalWorkedHours), "Bisher erfasste Stunden diese Woche", "teal")}
        ${renderStatCard("Geplant", formatHoursValue(totalPlannedHours), "Eingetragene Schichtstunden diese Woche", "amber")}
        ${renderStatCard("Kapazitaet", totalCapacityHours ? formatHoursValue(totalCapacityHours) : "-", totalCapacityHours ? "Gemeldete Wochenstunden aus Profilen" : "Noch keine Profilangaben", "sky")}
        ${renderStatCard("Noch offen", totalCapacityHours ? formatHoursValue(openHours) : "-", totalCapacityHours ? "Noch nicht verplante gemeldete Stunden" : "Keine Kapazitaet hinterlegt", "rose")}
      </div>

      <div class="calendar-members">
        ${
          rows.length
            ? rows.map((entry) => renderCapacityCard(entry)).join("")
            : renderEmptyState("Noch keine Staff-Daten", "Sobald Moderatoren oder Leitung angelegt sind, erscheint die Wochenuebersicht hier.")
        }
      </div>
    </section>
  `;
}

function renderCapacityCard(entry) {
  const plannedDelta = entry.capacityHours > 0 ? entry.capacityHours - entry.plannedHours : null;
  const dayDelta = entry.capacityDays > 0 ? entry.capacityDays - entry.plannedDays : null;

  return `
    <article class="calendar-member ${entry.statusTone === "rose" ? "lead" : ""}">
      <div class="status-row">
        <h4>${escapeHtml(getPrimaryDisplayName(entry.user))}</h4>
        <span class="pill ${entry.statusTone}">${escapeHtml(entry.statusLabel)}</span>
      </div>
      <p class="timeline-meta">${escapeHtml(ROLE_LABELS[entry.user.role] || entry.user.role)}</p>
      <p><strong>Geleistet:</strong> ${escapeHtml(formatHoursValue(entry.workedHours))} an ${escapeHtml(formatCapacityDays(entry.workedDays))}</p>
      <p><strong>Geplant:</strong> ${escapeHtml(formatHoursValue(entry.plannedHours))} an ${escapeHtml(formatCapacityDays(entry.plannedDays))}</p>
      <p><strong>Verfuegbar:</strong> ${escapeHtml(formatCapacityHours(entry.capacityHours))} / ${escapeHtml(formatCapacityDays(entry.capacityDays))}</p>
      ${
        entry.availabilitySchedule
          ? `<p><strong>Zeitfenster:</strong> ${escapeHtml(entry.availabilitySchedule)}</p>`
          : '<p class="helper-text">Noch kein konkretes Zeitfenster fuer diese Woche eingetragen.</p>'
      }
      ${entry.availabilityUpdatedAt ? `<p class="timeline-meta">Zuletzt aktualisiert: ${escapeHtml(formatDateTime(entry.availabilityUpdatedAt))}</p>` : ""}
      ${
        plannedDelta === null && dayDelta === null
          ? entry.availabilitySchedule
            ? '<p class="helper-text">Zeitfenster ist eingetragen, aber noch ohne Stunden- oder Tagesrahmen.</p>'
            : '<p class="helper-text">Diese Person hat noch keine Wochen-Kapazitaet im Profil hinterlegt.</p>'
          : `<p class="helper-text">${escapeHtml(buildCapacityDeltaText(plannedDelta, dayDelta))}</p>`
      }
    </article>
  `;
}

function renderShiftActionRow(shift, openEntry) {
  const isToday = shift.date === getLocalDateKey();
  const activeElsewhere = getOpenEntryForViewer();
  const blockByOtherShift = activeElsewhere && activeElsewhere.shiftId !== shift.id;
  const openSwapRequest = getOpenSwapRequestForShift(shift.id);

  return `
    <div class="card-actions">
      <button
        type="button"
        class="${openEntry ? "" : "ghost"} small"
        data-action="check-in"
        data-shift-id="${escapeHtml(shift.id)}"
        ${!isToday || openEntry || blockByOtherShift ? "disabled" : ""}
      >
        Einstempeln
      </button>
      <button
        type="button"
        class="ghost small"
        data-action="check-out"
        data-shift-id="${escapeHtml(shift.id)}"
        ${openEntry ? "" : "disabled"}
      >
        Ausstempeln
      </button>
      <button type="button" class="ghost small" data-action="quick-swap" data-shift-id="${escapeHtml(shift.id)}">Tausch anfragen</button>
    </div>
    ${openSwapRequest ? `<p class="helper-text">Tauschwunsch offen: ${escapeHtml(getSwapStatusLabel(openSwapRequest.status))}</p>` : ""}
    <p class="pill-note">
      ${blockByOtherShift
        ? "Du bist bereits in einer anderen Schicht eingestempelt."
        : isToday
          ? "Stempelbuttons sind fuer heutige Einsaetze aktiv."
          : "Stempeln ist am Einsatztag verfuegbar."}
    </p>
  `;
}

function renderSwapPanel(managerView) {
  const swapRequests = state.data.swapRequests || [];

  return `
    <section class="panel ${managerView ? "span-4" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Schichttausch</p>
          <h2>${managerView ? "Tauschwuesche genehmigen" : "Tauschwuesche und Uebernahmen"}</h2>
          <p class="section-copy">
            ${managerView
              ? "Waehle einen angebotenen Moderator aus und uebernimm die Schicht direkt im Plan."
              : "Stelle fuer eigene Schichten einen Tauschwunsch oder biete die Uebernahme fuer andere an."}
          </p>
        </div>
      </div>

      <div class="stack-list">
        ${
          swapRequests.length
            ? swapRequests.map((entry) => renderSwapRequestCard(entry, managerView)).join("")
            : renderEmptyState("Keine Tauschwuesche", "Sobald jemand einen Schichttausch anfragt, erscheint er hier.")
        }
      </div>
    </section>
  `;
}

function renderSwapRequestCard(entry, managerView) {
  const statusTone = entry.status === "genehmigt" ? "success" : entry.status === "abgelehnt" ? "rose" : "amber";
  const iAmCandidate = entry.candidates.some((candidate) => candidate.id === state.session.id);
  const canOffer = !managerView && entry.status !== "genehmigt" && entry.status !== "abgelehnt" && !iAmCandidate && entry.shift?.memberId !== state.session.id;

  return `
    <article class="request-card">
      <div class="status-row">
        <span class="pill ${statusTone}">${escapeHtml(getSwapStatusLabel(entry.status))}</span>
        ${entry.shift ? `<span class="pill neutral">${escapeHtml(formatDate(entry.shift.date))}</span>` : ""}
      </div>
      <div>
        <h3>${escapeHtml(entry.requesterName)}</h3>
        <p class="timeline-meta">
          ${entry.shift ? escapeHtml(`${formatShiftWindow(entry.shift)} · ${entry.shift.shiftType} · ${entry.shift.world} · ${entry.shift.task}`) : "Schicht nicht mehr verfuegbar"}
        </p>
      </div>
      <p>${escapeHtml(entry.message)}</p>
      <p class="helper-text">
        Angebote: ${
          entry.candidates.length
            ? escapeHtml(entry.candidates.map((candidate) => candidate.name).join(", "))
            : "Noch keine"
        }
      </p>
      ${
        entry.approvedCandidateName
          ? `<p class="helper-text">Genehmigt fuer: ${escapeHtml(entry.approvedCandidateName)}</p>`
          : ""
      }
      ${
        managerView && entry.status !== "genehmigt" && entry.status !== "abgelehnt"
          ? `
            <form class="stack-form compact-form" data-form="swap-decision" data-swap-request-id="${escapeHtml(entry.id)}">
              <div class="field">
                <label for="swap-candidate-${escapeHtml(entry.id)}">Uebernahme durch</label>
                <select id="swap-candidate-${escapeHtml(entry.id)}" name="candidateId">
                  <option value="">Moderator waehlen</option>
                  ${entry.candidates
                    .map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`)
                    .join("")}
                </select>
              </div>
              <div class="card-actions">
                <button type="submit" name="status" value="genehmigt" ${entry.candidates.length ? "" : "disabled"}>Genehmigen</button>
                <button type="submit" class="ghost small" name="status" value="abgelehnt">Ablehnen</button>
              </div>
            </form>
          `
          : canOffer
            ? `<button type="button" class="ghost small" data-action="offer-swap" data-swap-request-id="${escapeHtml(entry.id)}">Ich uebernehme</button>`
            : iAmCandidate
              ? '<p class="helper-text">Du hast die Uebernahme bereits angeboten.</p>'
              : ""
      }
    </article>
  `;
}

function renderTeamPanel() {
  const users = state.data.users || [];
  const rows = users
    .map((user) => {
      const shiftCount = (state.data.shifts || []).filter((entry) => entry.memberId === user.id).length;
      const requestCount = (state.data.requests || []).filter((entry) => entry.userId === user.id && entry.status !== "beruecksichtigt").length;

      if (!canManageUsers()) {
        return `
          <div class="roster-row">
            <div>
              <strong>${escapeHtml(user.displayName)}</strong>
              <p class="subtle">@${escapeHtml(user.username)}</p>
            </div>
            <div>
              <span class="pill ${user.role === "admin" ? "amber" : user.role === "planner" ? "sky" : "teal"}">${escapeHtml(ROLE_LABELS[user.role])}</span>
              <p class="subtle">${escapeHtml(String(shiftCount))} Schichten · ${escapeHtml(String(requestCount))} offen</p>
            </div>
          </div>
        `;
      }

      return `
        <article class="request-card">
          <div class="status-row">
            <span class="pill ${user.role === "admin" ? "amber" : user.role === "planner" ? "sky" : "teal"}">${escapeHtml(ROLE_LABELS[user.role])}</span>
            <span class="timeline-meta">${escapeHtml(String(shiftCount))} Schichten | ${escapeHtml(String(requestCount))} offen</span>
          </div>
          <div>
            <h3>${escapeHtml(user.displayName)}</h3>
            <p class="timeline-meta">@${escapeHtml(user.username)} · VRC: ${escapeHtml(user.vrchatName || "-")} · DC: ${escapeHtml(user.discordName || "-")}</p>
          </div>
          <form data-form="user-update" data-user-id="${escapeHtml(user.id)}">
            <div class="field">
              <label for="vrchat-${escapeHtml(user.id)}">VRChat-Name</label>
              <input id="vrchat-${escapeHtml(user.id)}" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}">
            </div>
            <div class="field">
              <label for="discord-${escapeHtml(user.id)}">Discord-Name</label>
              <input id="discord-${escapeHtml(user.id)}" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}">
            </div>
            <div class="field">
              <label for="role-${escapeHtml(user.id)}">Rolle</label>
              <select id="role-${escapeHtml(user.id)}" name="role">
                ${buildRoleOptions(user.role)}
              </select>
            </div>
            <div class="field">
              <label for="password-${escapeHtml(user.id)}">Neues Passwort</label>
              <input id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Leer lassen fuer keine Aenderung">
            </div>
            <div class="card-actions">
              <button type="submit" class="ghost small">Speichern</button>
              ${
                user.username !== "admin" && user.id !== state.session.id
                  ? `<button type="button" class="danger small" data-action="delete-user" data-user-id="${escapeHtml(user.id)}">Loeschen</button>`
                  : ""
              }
            </div>
          </form>
        </article>
      `;
    })
    .join("");

  return `
    <section class="panel span-4">
      <div class="section-head">
        <div>
          <p class="eyebrow">Team-Zugaenge</p>
          <h2>Wer ist im Portal registriert?</h2>
        </div>
        <span class="pill neutral">${escapeHtml(String(users.length))} Accounts</span>
      </div>

      <div class="stack-list">
        ${rows}
      </div>

      ${
        canManageUsers()
          ? `
            <div class="catalog-group">
              <h3>Neuen Account anlegen</h3>
              <form class="stack-form" data-form="admin-user-create">
                <div class="field">
                  <label for="newDisplayName">Anzeigename</label>
                  <input id="newDisplayName" name="displayName" type="text" required>
                </div>
                <div class="field">
                  <label for="newUsername">Benutzername</label>
                  <input id="newUsername" name="username" type="text" required>
                </div>
                <div class="field">
                  <label for="newVrchatName">VRChat-Name</label>
                  <input id="newVrchatName" name="vrchatName" type="text" required>
                </div>
                <div class="field">
                  <label for="newDiscordName">Discord-Name</label>
                  <input id="newDiscordName" name="discordName" type="text" required>
                </div>
                <div class="field">
                  <label for="newPassword">Startpasswort</label>
                  <input id="newPassword" name="password" type="password" required>
                </div>
                <div class="field">
                  <label for="newRole">Rolle</label>
                  <select id="newRole" name="role">
                    ${buildRoleOptions("viewer")}
                  </select>
                </div>
                <button type="submit">Account anlegen</button>
              </form>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderRequestAdminPanel() {
  const requests = state.data.requests || [];

  return `
    <section class="panel span-4">
      <div class="section-head">
        <div>
          <p class="eyebrow">Wuensche und Notizen</p>
          <h2>Rueckmeldungen aus dem Team</h2>
        </div>
      </div>

      <div class="stack-list">
        ${
          requests.length
            ? requests.map((entry) => renderAdminRequestCard(entry)).join("")
            : renderEmptyState("Keine Rueckmeldungen", "Sobald das Team Wuensche oder Notizen sendet, erscheinen sie hier.")
        }
      </div>
    </section>
  `;
}

function renderTeamPanelV2() {
  const users = state.data.users || [];
  const rows = users
    .map((user) => {
      const shiftCount = (state.data.shifts || []).filter((entry) => entry.memberId === user.id).length;
      const requestCount = (state.data.requests || []).filter((entry) => entry.userId === user.id && entry.status !== "beruecksichtigt").length;

      return `
        <article class="request-card">
          <div class="status-row">
            <span class="pill ${user.role === "admin" ? "amber" : user.role === "planner" ? "sky" : "teal"}">${escapeHtml(ROLE_LABELS[user.role])}</span>
            <span class="timeline-meta">${escapeHtml(String(shiftCount))} Schichten · ${escapeHtml(String(requestCount))} offen</span>
          </div>
          <div class="profile-head">
            ${renderUserAvatar(user, "profile-avatar")}
            <div>
              <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
              <p class="timeline-meta">VRChat: ${escapeHtml(user.vrchatName || "-")} | Discord: ${escapeHtml(user.discordName || "-")}</p>
              ${user.bio ? `<p class="helper-text">${escapeHtml(user.bio)}</p>` : ""}
            </div>
          </div>
          ${
            canManageUsers()
              ? `
                <form data-form="user-update" data-user-id="${escapeHtml(user.id)}">
                  <div class="field">
                    <label for="vrchat-${escapeHtml(user.id)}">VRChat-Name</label>
                    <input id="vrchat-${escapeHtml(user.id)}" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}">
                  </div>
                  <div class="field">
                    <label for="discord-${escapeHtml(user.id)}">Discord-Name</label>
                    <input id="discord-${escapeHtml(user.id)}" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}">
                  </div>
                  <div class="field">
                    <label for="role-${escapeHtml(user.id)}">Rolle</label>
                    <select id="role-${escapeHtml(user.id)}" name="role">
                      ${buildRoleOptions(user.role)}
                    </select>
                  </div>
                  <div class="field">
                    <label for="avatar-${escapeHtml(user.id)}">Profilbild-URL</label>
                    <input id="avatar-${escapeHtml(user.id)}" name="avatarUrl" type="url" value="${escapeHtml(user.avatarUrl || "")}" placeholder="https://...">
                  </div>
                  <div class="field">
                    <label for="bio-${escapeHtml(user.id)}">Kurzprofil</label>
                    <textarea id="bio-${escapeHtml(user.id)}" name="bio" placeholder="Kurze Beschreibung fuer die Teamseite">${escapeHtml(user.bio || "")}</textarea>
                  </div>
                  <div class="field">
                    <label for="password-${escapeHtml(user.id)}">Neues Passwort</label>
                    <input id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Leer lassen fuer keine Aenderung">
                  </div>
                  <div class="card-actions">
                    <button type="submit" class="ghost small">Speichern</button>
                    ${
                      user.username !== "admin" && user.id !== state.session.id
                        ? `<button type="button" class="danger small" data-action="delete-user" data-user-id="${escapeHtml(user.id)}">Loeschen</button>`
                        : ""
                    }
                  </div>
                </form>
              `
              : `<p class="helper-text">Dieser Account ist fuer Schichten, News und Feedback im Portal aktiv.</p>`
          }
        </article>
      `;
    })
    .join("");

  return `
    <section class="panel span-4">
      <div class="section-head">
        <div>
          <p class="eyebrow">Team-Zugaenge</p>
          <h2>Wer ist im Portal registriert?</h2>
        </div>
        <span class="pill neutral">${escapeHtml(String(users.length))} Accounts</span>
      </div>

      <div class="stack-list">
        ${rows}
      </div>

      ${
        canManageUsers()
          ? `
            <div class="catalog-group">
              <h3>Neuen Account anlegen</h3>
              <form class="stack-form" data-form="admin-user-create">
                <div class="field">
                  <label for="newVrchatName">VRChat-Name</label>
                  <input id="newVrchatName" name="vrchatName" type="text" required>
                </div>
                <div class="field">
                  <label for="newDiscordName">Discord-Name</label>
                  <input id="newDiscordName" name="discordName" type="text" required>
                </div>
                <div class="field">
                  <label for="newAvatarUrl">Profilbild-URL</label>
                  <input id="newAvatarUrl" name="avatarUrl" type="url" placeholder="https://...">
                </div>
                <div class="field">
                  <label for="newBio">Kurzprofil</label>
                  <textarea id="newBio" name="bio" placeholder="Kurzbeschreibung fuer die Teamseite"></textarea>
                </div>
                <div class="field">
                  <label for="newPassword">Startpasswort</label>
                  <input id="newPassword" name="password" type="password" required>
                </div>
                <div class="field">
                  <label for="newRole">Rolle</label>
                  <select id="newRole" name="role">
                    ${buildRoleOptions("viewer")}
                  </select>
                </div>
                <button type="submit">Account anlegen</button>
              </form>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderFeedbackAdminPanel() {
  const requests = state.data.requests || [];

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Feedback und Wuensche</p>
          <h2>Rueckmeldungen aus dem Team</h2>
          <p class="section-copy">Hier landen Stimmungsbilder, Hinweise, Schichtwuensche und echtes Portal-Feedback.</p>
        </div>
      </div>

      <div class="stack-list">
        ${
          requests.length
            ? requests.map((entry) => renderAdminRequestCard(entry)).join("")
            : renderEmptyState("Kein Feedback", "Sobald das Team etwas einreicht, erscheint es hier.")
        }
      </div>
    </section>
  `;
}

function renderFeedbackMemberPanel() {
  return renderRequestMemberPanel();
}

function renderNewsPanel(managerView) {
  return renderAnnouncementsPanel(managerView);
}

function renderProfilePanel(managerView) {
  const user = state.session;

  return `
    <section class="panel ${managerView ? "span-5" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Profil</p>
          <h2>Dein Auftritt im SONARA Portal</h2>
          <p class="section-copy">Hier pflegst du Profilbild, Namen und Kurzprofil, damit die Community-Seite lebendiger wirkt.</p>
        </div>
      </div>

      <div class="profile-panel">
        <div class="profile-preview">
          ${renderUserAvatar(user, "hero-avatar")}
          <div>
            <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
            <p class="timeline-meta">VRChat: ${escapeHtml(user.vrchatName || "-")} | Discord: ${escapeHtml(user.discordName || "-")}</p>
            <p class="helper-text">${escapeHtml(user.bio || "Noch kein Kurzprofil gesetzt.")}</p>
          </div>
        </div>

        <form class="stack-form" data-form="profile-update">
          <div class="form-grid">
            <div class="field">
              <label for="profileVrchatName">VRChat-Name</label>
              <input id="profileVrchatName" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}" required>
            </div>
            <div class="field">
              <label for="profileDiscordName">Discord-Name</label>
              <input id="profileDiscordName" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}" required>
            </div>
            <div class="field">
              <label for="profileAvatarUrl">Profilbild-URL</label>
              <input id="profileAvatarUrl" name="avatarUrl" type="url" value="${escapeHtml(user.avatarUrl || "")}" placeholder="https://...">
            </div>
            <div class="field">
              <label for="profilePassword">Neues Passwort</label>
              <input id="profilePassword" name="password" type="password" placeholder="Leer lassen fuer keine Aenderung">
            </div>
            <div class="field span-all">
              <label for="profileBio">Kurzprofil</label>
              <textarea id="profileBio" name="bio" placeholder="Schreibe kurz, wofuer du in SONARA stehst">${escapeHtml(user.bio || "")}</textarea>
            </div>
          </div>
          <button type="submit">Profil speichern</button>
        </form>
      </div>
    </section>
  `;
}

async function readImageFileInput(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return null;
  if (!file.type.startsWith("image/")) {
    throw new Error("Bitte nur Bilddateien hochladen.");
  }
  if (file.size > 1800000) {
    throw new Error("Das Bild ist zu gross. Bitte unter 1,8 MB bleiben.");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

async function buildProfilePayload(form) {
  const formData = new FormData(form);
  const payload = {
    vrchatName: formData.get("vrchatName"),
    discordName: formData.get("discordName"),
    bio: formData.get("bio"),
    contactNote: formData.get("contactNote"),
    weeklyHoursCapacity: formData.get("weeklyHoursCapacity"),
    weeklyDaysCapacity: formData.get("weeklyDaysCapacity"),
    creatorBlurb: formData.get("creatorBlurb"),
    creatorLinks: formData.get("creatorLinks"),
    creatorVisible: formData.get("creatorVisible") === "on"
  };

  if (form.querySelector('[name="blocked"]')) {
    payload.blocked = formData.get("blocked") === "on";
    payload.blockReason = formData.get("blockReason");
  }

  if (form.querySelector('[name="blocked"]')) {
    payload.blocked = formData.get("blocked") === "on";
    payload.blockReason = formData.get("blockReason");
  }

  const avatarData = await readImageFileInput(form.querySelector('input[name="avatarFile"]'));
  if (avatarData) payload.avatarUrl = avatarData;

  return { formData, payload };
}

async function handleSubmit(event) {
  const form = event.target;
  const formName = form.dataset.form;
  if (!formName) return;

  event.preventDefault();

  switch (formName) {
    case "login": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/login", {
            method: "POST",
            body: JSON.stringify({
              identifier: formData.get("identifier"),
              password: formData.get("password")
            })
          }),
        "Willkommen im Portal."
      );
      break;
    }

    case "register": {
      const formData = new FormData(form);
      const password = String(formData.get("password") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (password !== confirmPassword) {
        setFlash("Die Passwoerter stimmen nicht ueberein.", "danger");
        render();
        return;
      }

      const avatarUrl = await readImageFileInput(form.querySelector('input[name="avatarFile"]'));
      await performAction(
        () =>
          api("/api/register", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              bio: formData.get("bio"),
              avatarUrl: avatarUrl || "",
              password
            })
          }),
        "Zugang wurde erstellt."
      );
      break;
    }

    case "shift": {
      const formData = new FormData(form);
      const payload = {
        date: formData.get("date"),
        startTime: normalizeTimeValue(formData.get("startTime")),
        endTime: normalizeTimeValue(formData.get("endTime")),
        memberId: formData.get("memberId"),
        shiftType: String(formData.get("shiftType") || "").trim(),
        world: String(formData.get("world") || "").trim(),
        task: String(formData.get("task") || "").trim(),
        notes: formData.get("notes"),
        isLead: formData.get("isLead") === "on"
      };
      const catalogAdds = collectCatalogAddsForShift(payload, state.data.settings);
      if (catalogAdds.shiftTypes.length || catalogAdds.worlds.length || catalogAdds.tasks.length) {
        const lines = [
          "Diese Werte sind neu und noch nicht im Katalog:",
          ...catalogAdds.shiftTypes.map((entry) => `- Schichttyp: ${entry}`),
          ...catalogAdds.worlds.map((entry) => `- Welt: ${entry}`),
          ...catalogAdds.tasks.map((entry) => `- Aufgabe: ${entry}`),
          "",
          "Sollen diese Werte zusaetzlich in die Listen aufgenommen werden?"
        ];
        if (window.confirm(lines.join("\n"))) payload.catalogAdds = catalogAdds;
      }

      const shiftId = state.ui.editingShiftId;
      await performAction(
        () =>
          api(shiftId ? `/api/shifts/${encodeURIComponent(shiftId)}` : "/api/shifts", {
            method: shiftId ? "PATCH" : "POST",
            body: JSON.stringify(payload)
          }),
        shiftId ? "Schicht wurde aktualisiert." : "Neue Schicht wurde gespeichert."
      );
      state.ui.editingShiftId = "";
      render();
      break;
    }

    case "request": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/requests", {
            method: "POST",
            body: JSON.stringify({
              type: formData.get("type"),
              date: formData.get("date"),
              content: formData.get("content"),
              rating: formData.get("rating")
            })
          }),
        "Deine Rueckmeldung wurde gespeichert."
      );
      break;
    }

    case "request-admin": {
      const formData = new FormData(form);
      const requestId = form.dataset.requestId;
      await performAction(
        () =>
          api(`/api/requests/${encodeURIComponent(requestId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: formData.get("status"),
              adminNote: formData.get("adminNote")
            })
          }),
        "Rueckmeldung fuer das Teammitglied gespeichert."
      );
      break;
    }

    case "request-decision": {
      const requestId = form.dataset.requestId;
      const action = String(event.submitter?.value || "");
      await performAction(
        () =>
          api(`/api/requests/${encodeURIComponent(requestId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action })
          }),
        action === "accepted" ? "Du hast die Antwort bestaetigt." : "Du hast die Antwort abgelehnt."
      );
      break;
    }

    case "announcement": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/announcements", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              body: formData.get("body"),
              pinned: formData.get("pinned") === "on",
              imageUrl: formData.get("imageUrl")
            })
          }),
        "Neue Info wurde veroeffentlicht."
      );
      break;
    }

    case "vrchat-security-code": {
      const formData = new FormData(form);
      await submitVrchatSecurityCode(formData.get("code"));
      break;
    }

    case "event-create": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/events", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              dateLabel: formData.get("dateLabel"),
              world: formData.get("world"),
              host: formData.get("host"),
              summary: formData.get("summary")
            })
          }),
        "Event wurde gespeichert."
      );
      break;
    }

    case "event-delete": {
      const eventId = form.dataset.eventId;
      if (!window.confirm("Dieses Event wirklich entfernen?")) {
        return;
      }
      await performAction(
        () =>
          api(`/api/events/${encodeURIComponent(eventId)}`, {
            method: "DELETE"
          }),
        "Event wurde entfernt.",
        "warning"
      );
      break;
    }

    case "event-create": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/events", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              dateLabel: formData.get("dateLabel"),
              world: formData.get("world"),
              host: formData.get("host"),
              summary: formData.get("summary")
            })
          }),
        "Event wurde gespeichert."
      );
      break;
    }

    case "event-delete": {
      const eventId = form.dataset.eventId;
      if (!window.confirm("Dieses Event wirklich entfernen?")) {
        return;
      }

      await performAction(
        () =>
          api(`/api/events/${encodeURIComponent(eventId)}`, {
            method: "DELETE"
          }),
        "Event wurde entfernt.",
        "warning"
      );
      break;
    }

    case "catalog": {
      const formData = new FormData(form);
      const key = form.dataset.key;
      await performAction(
        () =>
          api(`/api/settings/${encodeURIComponent(key)}`, {
            method: "POST",
            body: JSON.stringify({ value: formData.get("value") })
          }),
        "Listenwert hinzugefuegt."
      );
      break;
    }

    case "chat": {
      const formData = new FormData(form);
      const channel = String(formData.get("channel") || "");
      await performAction(
        () =>
          api("/api/chat", {
            method: "POST",
            body: JSON.stringify({
              channel,
              relatedShiftId: formData.get("relatedShiftId"),
              content: formData.get("content")
            })
          }),
        channel === "staff" ? "Nachricht im Staff-Chat gepostet." : "Nachricht im allgemeinen Chat gepostet."
      );
      break;
    }

    case "chat-trim": {
      const channel = String(form.dataset.channel || "community");
      const count = Number(event.submitter?.value || 0);
      if (!CHAT_TRIM_OPTIONS.includes(count)) return;

      const label = channel === "staff" ? "Staff-Chat" : "Community-Chat";
      if (!window.confirm(`Die letzten ${count} Nachrichten im ${label} wirklich entfernen?`)) {
        return;
      }

      await performAction(
        () =>
          api("/api/chat/trim", {
            method: "POST",
            body: JSON.stringify({ channel, count })
          }),
        `Die letzten ${count} Nachrichten wurden aus dem ${label} entfernt.`
      );
      break;
    }

    case "direct-message": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/direct-messages", {
            method: "POST",
            body: JSON.stringify({
              recipientId: form.dataset.recipientId || formData.get("recipientId"),
              content: formData.get("content")
            })
          }),
        "Direktnachricht wurde gesendet."
      );
      break;
    }

    case "feed-post": {
      const formData = new FormData(form);
      const imageUrl = await readImageFileInput(form.querySelector('input[name="imageFile"]'));
      await performAction(
        () =>
          api("/api/feed-posts", {
            method: "POST",
            body: JSON.stringify({
              content: formData.get("content"),
              imageUrl: imageUrl || ""
            })
          }),
        "Beitrag wurde im Feed veroeffentlicht."
      );
      break;
    }

    case "feed-reaction": {
      const postId = form.dataset.postId;
      const emoji = form.dataset.emoji;
      await performAction(
        () =>
          api(`/api/feed-posts/${encodeURIComponent(postId)}/reactions`, {
            method: "PATCH",
            body: JSON.stringify({ emoji })
          }),
        "Reaktion wurde aktualisiert."
      );
      break;
    }

    case "feed-delete": {
      const postId = form.dataset.postId;
      if (!window.confirm("Diesen Feed-Beitrag wirklich loeschen?")) {
        return;
      }
      await performAction(
        () =>
          api(`/api/feed-posts/${encodeURIComponent(postId)}`, {
            method: "DELETE"
          }),
        "Feed-Beitrag wurde geloescht.",
        "warning"
      );
      break;
    }

    case "direct-message-trim": {
      const count = Number(event.submitter?.value || 0);
      if (!CHAT_TRIM_OPTIONS.includes(count)) return;

      if (!window.confirm(`Die letzten ${count} Direktnachrichten wirklich entfernen?`)) {
        return;
      }

      await performAction(
        () =>
          api("/api/direct-messages/trim", {
            method: "POST",
            body: JSON.stringify({ count })
          }),
        `Die letzten ${count} Direktnachrichten wurden entfernt.`
      );
      break;
    }

    case "forum-thread": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/forum-threads", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              category: formData.get("category"),
              content: formData.get("content")
            })
          }),
        "Thread wurde erstellt."
      );
      break;
    }

    case "forum-reply": {
      const formData = new FormData(form);
      const threadId = form.dataset.threadId;
      await performAction(
        () =>
          api(`/api/forum-threads/${encodeURIComponent(threadId)}/replies`, {
            method: "POST",
            body: JSON.stringify({
              content: formData.get("content")
            })
          }),
        "Antwort wurde gespeichert."
      );
      break;
    }

    case "warning-create": {
      const formData = new FormData(form);
      const userId = form.dataset.userId;
      await performAction(
        () =>
          api("/api/warnings", {
            method: "POST",
            body: JSON.stringify({
              userId,
              reason: formData.get("reason")
            })
          }),
        "Verwarnung wurde gesendet."
      );
      break;
    }

    case "warning-ack": {
      const warningId = form.dataset.warningId;
      await performAction(
        () =>
          api(`/api/warnings/${encodeURIComponent(warningId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "acknowledge" })
          }),
        "Verwarnung wurde bestaetigt.",
        "warning"
      );
      break;
    }

    case "warning-clear": {
      const warningId = form.dataset.warningId;
      await performAction(
        () =>
          api(`/api/warnings/${encodeURIComponent(warningId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "clear" })
          }),
        "Verwarnung wurde abgeschlossen."
      );
      break;
    }

    case "swap-decision": {
      const formData = new FormData(form);
      const swapRequestId = form.dataset.swapRequestId;
      const status = String(event.submitter?.value || "");
      await performAction(
        () =>
          api(`/api/swap-requests/${encodeURIComponent(swapRequestId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status,
              candidateId: formData.get("candidateId")
            })
          }),
        status === "genehmigt" ? "Tauschwunsch wurde genehmigt und die Schicht neu zugewiesen." : "Tauschwunsch wurde abgelehnt."
      );
      break;
    }

    case "admin-user-create": {
      const { formData, payload } = await buildProfilePayload(form);
      await performAction(
        () =>
          api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              avatarUrl: payload.avatarUrl || "",
              bio: payload.bio,
              contactNote: payload.contactNote,
              creatorBlurb: payload.creatorBlurb,
              creatorLinks: payload.creatorLinks,
              creatorVisible: payload.creatorVisible,
              password: formData.get("password"),
              role: formData.get("role")
            })
          }),
        "Account wurde angelegt."
      );
      break;
    }

    case "user-update": {
      const userId = form.dataset.userId;
      const { formData, payload } = await buildProfilePayload(form);
      payload.role = formData.get("role");
      payload.password = formData.get("password");
      await performAction(
        () =>
          api(`/api/admin/users/${encodeURIComponent(userId)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Account wurde aktualisiert."
      );
      break;
    }

    case "profile-update": {
      const { formData, payload } = await buildProfilePayload(form);
      payload.password = formData.get("password");
      await performAction(
        () =>
          api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Profil wurde aktualisiert."
      );
      break;
    }

    default:
      break;
  }
}

function renderAdminRequestCard(entry) {
  const statusTone = entry.status === "beruecksichtigt" ? "success" : entry.status === "in_planung" ? "amber" : "rose";

  return `
    <article class="request-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill ${statusTone}">${escapeHtml(getStatusLabel(entry.status))}</span>
          <span class="pill neutral">${escapeHtml(entry.type)}</span>
          ${renderRatingPill(entry.rating)}
        </div>
      </div>
      <div>
        <h3>${escapeHtml(entry.userName)}</h3>
        <p class="timeline-meta">${escapeHtml(entry.date ? formatDate(entry.date) : "Ohne fixes Datum")} | ${escapeHtml(formatDateTime(entry.createdAt))}</p>
      </div>
      <p>${escapeHtml(entry.content)}</p>

      <form data-form="request-admin" data-request-id="${escapeHtml(entry.id)}">
        <div class="field">
          <label for="status-${escapeHtml(entry.id)}">Status</label>
          <select id="status-${escapeHtml(entry.id)}" name="status">
            ${buildStatusOptions(entry.status)}
          </select>
        </div>
        <div class="field">
          <label for="adminNote-${escapeHtml(entry.id)}">Notiz fuer den Moderator</label>
          <textarea id="adminNote-${escapeHtml(entry.id)}" name="adminNote" placeholder="Kurze Rueckmeldung oder Bestaetigung">${escapeHtml(entry.adminNote || "")}</textarea>
        </div>
        <button type="submit" class="ghost small">Rueckmeldung speichern</button>
      </form>
    </article>
  `;
}

function renderAnnouncementsPanel(managerView) {
  const items = state.data.announcements || [];

  return `
    <section class="panel ${managerView ? "span-4" : "span-7"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community News</p>
          <h2>News, Hinweise und Highlights aus SONARA</h2>
          <p class="section-copy">Wichtige News, Event-Hinweise, neue Welten und sichtbare Community-Updates erscheinen hier gesammelt.</p>
        </div>
      </div>

      ${
        managerView
          ? `
            <form class="stack-form" data-form="announcement">
              <div class="field">
                <label for="announcementTitle">Titel</label>
                <input id="announcementTitle" name="title" type="text" required>
              </div>
              <div class="field">
                <label for="announcementBody">Nachricht</label>
                <textarea id="announcementBody" name="body" required></textarea>
              </div>
              <div class="field">
                <label for="announcementImageUrl">Bild-URL</label>
                <input id="announcementImageUrl" name="imageUrl" type="url" placeholder="https://...">
              </div>
              <label class="label-row">
                <input name="pinned" type="checkbox">
                <span>Oben anheften</span>
              </label>
              <button type="submit">News veroeffentlichen</button>
            </form>
          `
          : ""
      }

      <div class="stack-list ${managerView ? "" : "chat-list"}">
        ${
          items.length
            ? items.map((item) => renderAnnouncementCard(item, managerView)).join("")
            : renderEmptyState("Noch keine Infos", "Neue Team-Informationen erscheinen hier.")
        }
      </div>
    </section>
  `;
}

function renderAnnouncementCard(item, managerView) {
  return `
    <article class="announcement-card ${item.pinned ? "pinned" : ""}">
      <div class="status-row">
        <span class="pill ${item.pinned ? "amber" : "neutral"}">${item.pinned ? "Angeheftet" : "Info"}</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(item.createdAt))}</span>
      </div>
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="timeline-meta">von ${escapeHtml(item.authorName)}</p>
      </div>
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" class="announcement-image">` : ""}
      <p>${escapeHtml(item.body)}</p>
      ${
        managerView
          ? `<div class="card-actions"><button type="button" class="danger small" data-action="delete-announcement" data-announcement-id="${escapeHtml(item.id)}">Entfernen</button></div>`
          : ""
      }
    </article>
  `;
}

function renderAttendancePanel(managerView) {
  const entries = state.data.timeEntries || [];

  if (managerView) {
    const liveEntries = entries.filter((entry) => !entry.checkOutAt);
    const history = entries.slice(0, 8);
    const audits = buildShiftAuditRows();

    return `
      <section class="panel span-12">
        <div class="section-head">
          <div>
            <p class="eyebrow">Stempelzeiten</p>
            <h2>Wer arbeitet gerade und wer hat seine Schicht gemacht?</h2>
          </div>
        </div>

        <div class="attendance-admin-grid">
          <div class="stack-list">
            <h3>Gerade aktiv</h3>
            ${
              liveEntries.length
                ? liveEntries.map((entry) => renderActiveEntry(entry, false)).join("")
                : renderEmptyState("Niemand aktiv", "Sobald jemand einstempelt, wird er hier gelistet.")
            }
          </div>

          <div class="stack-list">
            <h3>Letzte Stempelungen</h3>
            ${history.length ? history.map((entry) => renderTimeEntry(entry, false)).join("") : renderEmptyState("Noch keine Eintraege", "Sobald Einsaetze gestempelt wurden, erscheinen sie hier.")}
          </div>

          <div class="stack-list">
            <h3>Schichtkontrolle</h3>
            ${
              audits.length
                ? audits.map((entry) => renderShiftAuditCard(entry)).join("")
                : renderEmptyState("Keine Schichten", "Sobald Schichten geplant wurden, erscheinen sie hier.")
            }
          </div>
        </div>
      </section>
    `;
  }

  const activeEntry = getOpenEntryForViewer();

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Meine Zeiten</p>
          <h2>Ein- und Ausstempeln</h2>
        </div>
      </div>

      ${
        activeEntry
          ? renderActiveEntry(activeEntry, true)
          : renderEmptyState("Kein aktiver Einsatz", "Wenn du heute eine Schicht hast, kannst du in deiner Schichtkarte einstempeln.")
      }

      <div class="stack-list">
        ${entries.length ? entries.map((entry) => renderTimeEntry(entry, true)).join("") : ""}
      </div>
    </section>
  `;
}

function renderShiftAuditCard(entry) {
  return `
    <article class="request-card">
      <div class="status-row">
        <span class="pill ${escapeHtml(entry.tone)}">${escapeHtml(entry.label)}</span>
        <span class="timeline-meta">${escapeHtml(formatDate(entry.date))}</span>
      </div>
      <div>
        <h3>${escapeHtml(entry.memberName)}</h3>
        <p class="timeline-meta">${escapeHtml(`${formatShiftWindow(entry)} · ${entry.shiftType} · ${entry.world} · ${entry.task}`)}</p>
      </div>
      <p class="helper-text">${escapeHtml(entry.detail)}</p>
    </article>
  `;
}

function renderActiveEntry(entry, personal) {
  return `
    <div class="active-shift">
      <div class="status-row">
        <span class="pill teal">Live</span>
        <span class="timeline-meta">seit ${escapeHtml(formatTime(entry.checkInAt))}</span>
      </div>
      <h3>${escapeHtml(personal ? "Du bist eingestempelt" : entry.memberName)}</h3>
      <p>${escapeHtml(entry.shift ? `${formatShiftWindow(entry.shift)} · ${entry.shift.shiftType} · ${entry.shift.world} · ${entry.shift.task}` : "Schicht wurde geloescht")}</p>
    </div>
  `;
}

function renderTimeEntry(entry, personal) {
  const duration = entry.checkOutAt ? formatDuration(new Date(entry.checkOutAt) - new Date(entry.checkInAt)) : "Laeuft";

  return `
    <article class="time-entry">
      <div class="status-row">
        <span class="pill ${entry.checkOutAt ? "success" : "teal"}">${entry.checkOutAt ? "Abgeschlossen" : "Offen"}</span>
        <span class="timeline-meta">${escapeHtml(duration)}</span>
      </div>
      <h3>${escapeHtml(personal ? (entry.shift ? formatDate(entry.shift.date) : "Meine Schicht") : entry.memberName)}</h3>
      <p>${escapeHtml(entry.shift ? `${formatShiftWindow(entry.shift)} · ${entry.shift.shiftType} · ${entry.shift.world}` : "Keine Schichtreferenz mehr")}</p>
      <p class="timeline-meta">${escapeHtml(`${formatTime(entry.checkInAt)} bis ${entry.checkOutAt ? formatTime(entry.checkOutAt) : "offen"}`)}</p>
    </article>
  `;
}

function renderSettingsPanel() {
  return `
    <section class="panel span-4">
      <div class="section-head">
        <div>
          <p class="eyebrow">Planungslisten</p>
          <h2>Schichttypen, Welten, Aufgaben</h2>
          <p class="section-copy">Diese Vorschlaege tauchen im Planungsformular als Auswahlhilfe auf.</p>
        </div>
      </div>

      ${renderCatalogEditor("shiftTypes", "Schichttypen")}
      ${renderCatalogEditor("worlds", "Welten")}
      ${renderCatalogEditor("tasks", "Aufgaben")}
    </section>
  `;
}

function renderDiscordPanel() {
  const status = state.discordStatus;

  return `
    <section class="panel span-4">
      <div class="section-head">
        <div>
          <p class="eyebrow">Discord</p>
          <h2>Webhook und Test</h2>
          <p class="section-copy">Hier siehst du, ob der Webhook gesetzt ist und ob Discord wirklich erreichbar ist.</p>
        </div>
        <div class="card-actions">
          <button type="button" class="ghost small" data-action="refresh-discord-status" ${state.discordLoading ? "disabled" : ""}>Status neu laden</button>
          <button type="button" class="small" data-action="run-discord-test" ${state.discordLoading ? "disabled" : ""}>${state.discordLoading ? "Pruefe..." : "Testnachricht senden"}</button>
        </div>
      </div>

      ${
        !status
          ? renderEmptyState("Noch kein Discord-Status", "Sobald du den Status laedst, erscheint hier die aktuelle Webhook-Pruefung.")
          : `
            <div class="stats-strip compact-stats">
              ${renderStatCard("Webhook", status.configured ? "Gesetzt" : "Fehlt", status.configured ? "DISCORD_WEBHOOK_URL ist vorhanden" : "Bitte in Render unter Umwelt eintragen", status.configured ? "teal" : "rose")}
              ${renderStatCard("Letzter Versuch", status.lastAttemptAt ? formatDateTime(status.lastAttemptAt) : "-", status.lastStatusCode ? `HTTP ${status.lastStatusCode}` : "Noch kein Versand", "amber")}
              ${renderStatCard("Letzter Erfolg", status.lastSuccessAt ? formatDateTime(status.lastSuccessAt) : "-", status.lastSuccessAt ? "Discord hat die Nachricht angenommen" : "Noch kein erfolgreicher Versand", status.lastSuccessAt ? "success" : "sky")}
            </div>
            ${status.blockedUntil ? `<div class="flash flash-warning"><span>${escapeHtml(`Discord-Sends pausieren aktuell bis ${formatDateTime(status.blockedUntil)}. Ein neuer Webhook hilft bei 1015 meistens nicht, weil die Sperre an der Server-IP haengt.`)}</span></div>` : ""}
            ${status.lastError ? `<div class="flash flash-danger"><span>${escapeHtml(status.lastError)}</span></div>` : ""}
            <p class="pill-note">Wenn die Testnachricht nicht ankommt, pruefe zuerst den Discord-Webhook und dann den letzten Fehler hier im Portal.</p>
          `
      }
    </section>
  `;
}

function renderVrchatAnalyticsPanel() {
  const overview = state.vrchatOverview;
  const missing = overview?.missing || [];
  const pendingAuth = overview?.pendingAuth || null;
  const needsEmailCode = pendingAuth?.type === "emailOtp";
  const needsLoginPlace = pendingAuth?.type === "loginPlace";

  return `
    <section class="panel span-8">
      <div class="section-head">
        <div>
          <p class="eyebrow">VRChat Analytics</p>
          <h2>Community-Daten aus VRChat einlesen</h2>
          <p class="section-copy">Diese Gratis-Version synchronisiert die Gruppendaten manuell auf Knopfdruck und speichert sie in Postgres.</p>
        </div>
        <div class="card-actions">
          <button type="button" class="ghost small" data-action="refresh-vrchat-overview" ${state.vrchatLoading ? "disabled" : ""}>Status neu laden</button>
          <button type="button" class="small" data-action="run-vrchat-sync" ${state.vrchatLoading ? "disabled" : ""}>${state.vrchatLoading ? "Sync laeuft..." : "Sync jetzt starten"}</button>
        </div>
      </div>

      ${
        !overview
          ? renderEmptyState("Noch keine VRChat-Daten", "Sobald du den Sync startest oder den Status laedst, erscheinen die Daten hier.")
          : `
            <div class="stats-strip compact-stats">
              ${renderStatCard("DB", overview.databaseConnected ? "Verbunden" : "Fehlt", overview.databaseConnected ? "Postgres ist erreichbar" : "DATABASE_URL fehlt", overview.databaseConnected ? "teal" : "rose")}
              ${renderStatCard("Gruppe", overview.group?.name || "-", overview.group ? `Lookup: ${overview.groupLookup || "-"}` : "Noch nicht aufgeloest", overview.group ? "sky" : "amber")}
              ${renderStatCard("Mitglieder", overview.group?.memberCount ?? "-", overview.group ? "Aus dem letzten Sync" : "Noch keine Daten", "amber")}
              ${renderStatCard("Letzter Sync", overview.lastSync?.status || "-", overview.lastSync?.finishedAt ? formatDateTime(overview.lastSync.finishedAt) : "Noch nicht gelaufen", overview.lastSync?.status === "success" ? "success" : overview.lastSync?.status === "failed" ? "rose" : "sky")}
            </div>

            ${missing.length ? `<div class="flash flash-warning"><span>Fehlende Environment-Variablen: ${escapeHtml(missing.join(", "))}</span></div>` : ""}
            ${overview.sessionSavedAt ? `<div class="flash flash-info"><span>VRChat-Session gespeichert: ${escapeHtml(formatDateTime(overview.sessionSavedAt))}</span></div>` : ""}
            ${needsEmailCode ? `
              <div class="flash flash-warning">
                <span>${escapeHtml(pendingAuth.message || "VRChat hat einen Sicherheitscode per E-Mail geschickt.")}</span>
              </div>
              <form class="stack-form compact-form" data-form="vrchat-security-code">
                <div class="field">
                  <label for="vrchatSecurityCode">VRChat-Sicherheitscode</label>
                  <input id="vrchatSecurityCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="Code aus der VRChat-E-Mail" required>
                </div>
                <button type="submit" class="small" ${state.vrchatLoading ? "disabled" : ""}>Code bestätigen</button>
              </form>
            ` : ""}
            ${needsLoginPlace ? `<div class="flash flash-warning"><span>${escapeHtml(pendingAuth.message || "Bitte zuerst den VRChat-Login-Ort per E-Mail-Link bestätigen und danach den Sync erneut starten.")}</span></div>` : ""}
            ${overview.lastSync?.errorMessage ? `<div class="flash flash-danger"><span>${escapeHtml(overview.lastSync.errorMessage)}</span></div>` : ""}

            <div class="analytics-grid">
              <div class="stack-list">
                <h3>Aktuelle Instanz-Snapshots</h3>
                ${
                  overview.latestInstances?.length
                    ? overview.latestInstances.map((entry) => `
                      <article class="request-card">
                        <div class="status-row">
                          <span class="pill sky">${escapeHtml(entry.instanceType || "group")}</span>
                          <span class="timeline-meta">${escapeHtml(formatDateTime(entry.observedAt))}</span>
                        </div>
                        <div>
                          <h3>${escapeHtml(entry.worldName || entry.worldId || "Unbekannte Welt")}</h3>
                          <p class="timeline-meta">${escapeHtml(entry.instanceId)}</p>
                        </div>
                        <p class="helper-text">${escapeHtml(String(entry.playerCount || 0))} Personen im letzten Snapshot</p>
                      </article>
                    `).join("")
                    : renderEmptyState("Noch keine Instanzdaten", "Nach dem ersten erfolgreichen Sync erscheinen hier die letzten bekannten Gruppeninstanzen.")
                }
              </div>

              <div class="stack-list">
                <h3>Top-Welten der letzten 7 Tage</h3>
                ${
                  overview.topWorlds?.length
                    ? overview.topWorlds.map((entry) => `
                      <article class="request-card">
                        <div class="status-row">
                          <span class="pill teal">Peak ${escapeHtml(String(entry.peakPlayers))}</span>
                          <span class="timeline-meta">${escapeHtml(String(entry.samples))} Snapshots</span>
                        </div>
                        <h3>${escapeHtml(entry.worldName)}</h3>
                      </article>
                    `).join("")
                    : renderEmptyState("Noch keine Weltdaten", "Sobald Instanz-Snapshots vorhanden sind, werden die staerksten Welten hier gezeigt.")
                }

                <h3>Neueste Audit-Logs</h3>
                ${
                  overview.latestAuditEvents?.length
                    ? overview.latestAuditEvents.map((entry) => `
                      <article class="request-card">
                        <div class="status-row">
                          <span class="pill neutral">${escapeHtml(entry.eventType || "event")}</span>
                          <span class="timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
                        </div>
                        <div>
                          <h3>${escapeHtml(entry.actorName || "Unbekannt")}</h3>
                          <p class="helper-text">${escapeHtml(entry.description || entry.targetName || "Ohne Beschreibung")}</p>
                        </div>
                      </article>
                    `).join("")
                    : renderEmptyState("Noch keine Audit-Logs", "Nach dem ersten erfolgreichen Sync erscheinen hier Gruppenereignisse.")
                }
              </div>
            </div>
          `
      }
    </section>
  `;
}

function renderCatalogEditor(key, label) {
  const values = state.data.settings[key] || [];

  return `
    <div class="catalog-group">
      <h3>${escapeHtml(label)}</h3>
      <form class="inline-form" data-form="catalog" data-key="${escapeHtml(key)}">
        <input name="value" type="text" placeholder="${escapeHtml(label.slice(0, -1) || label)} hinzufuegen">
        <button type="submit" class="ghost small">Hinzufuegen</button>
      </form>
      <div class="chip-list">
        ${
          values.length
            ? values
                .map(
                  (value) => `
                    <span class="chip">
                      <span>${escapeHtml(value)}</span>
                      <button
                        type="button"
                        class="ghost small"
                        data-action="remove-catalog-item"
                        data-key="${escapeHtml(key)}"
                        data-value="${escapeHtml(value)}"
                      >
                        x
                      </button>
                    </span>
                  `
                )
                .join("")
            : renderEmptyState("Keine Eintraege", "Noch keine Werte gespeichert.")
        }
      </div>
    </div>
  `;
}

function renderChatPanel(managerView, compact = false) {
  const availableShifts = managerView
    ? getSortedShifts(state.data.shifts || [])
    : getSortedShifts(state.data.shifts || []);
  const messages = state.data.chatMessages || [];

  return `
    <section class="panel ${compact ? "span-12" : managerView ? "span-8" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Team-Chat</p>
          <h2>Echtzeit-Chat fuer schnelle Absprachen</h2>
          <p class="section-copy">Neue Nachrichten erscheinen automatisch, ohne dass jemand neu laden muss.</p>
        </div>
        <span class="pill ${state.ui.liveChatConnected ? "success" : "amber"}">${state.ui.liveChatConnected ? "Live verbunden" : "Verbindung wird aufgebaut"}</span>
      </div>

      <form class="stack-form" data-form="chat">
        <div class="form-grid">
          <div class="field">
            <label for="chatShift">Bezug zu einer Schicht</label>
            <select id="chatShift" name="relatedShiftId">
              <option value="">Keine konkrete Schicht</option>
              ${availableShifts.map((shift) => renderShiftSelectOption(shift)).join("")}
            </select>
          </div>
          <div class="field">
            <label for="chatMessage">Nachricht</label>
            <textarea id="chatMessage" name="content" placeholder="z. B. Kann jemand meine Spaetschicht am Freitag uebernehmen?" required></textarea>
          </div>
        </div>

        <button type="submit">Nachricht posten</button>
      </form>

      <div class="stack-list chat-list">
        ${
          messages.length
            ? messages.map((message) => renderChatMessage(message)).join("")
            : renderEmptyState("Noch kein Team-Chat", "Die erste Nachricht erscheint sofort fuer alle online.")
        }
      </div>
    </section>
  `;
}

function renderChatMessage(message) {
  const shiftText = message.relatedShift
    ? `${formatDate(message.relatedShift.date)} · ${formatShiftWindow(message.relatedShift)} · ${message.relatedShift.shiftType} · ${message.relatedShift.world}`
    : "";

  return `
    <article class="chat-card">
      <div class="chat-meta">
        <div>
          <h3>${escapeHtml(message.authorName)}</h3>
          <p class="timeline-meta">${escapeHtml(formatDateTime(message.createdAt))}</p>
        </div>
        ${shiftText ? `<span class="pill neutral">${escapeHtml(shiftText)}</span>` : ""}
      </div>
      <p>${escapeHtml(message.content)}</p>
    </article>
  `;
}

function renderMySchedulePanel() {
  const shifts = getSortedShifts(state.data.shifts || []);

  return `
    <section class="panel span-7">
      <div class="section-head">
        <div>
          <p class="eyebrow">Mein Plan</p>
          <h2>Nur deine eigenen Schichten</h2>
          <p class="section-copy">Du siehst hier ausschliesslich deine Einsaetze inklusive Welt, Aufgabe und Briefing-Notizen.</p>
        </div>
      </div>

      <div class="card-list">
        ${
          shifts.length
            ? shifts.map((shift) => renderShiftCard(shift, { adminView: false })).join("")
            : renderEmptyState("Noch keine Einsaetze", "Sobald die Teamleitung dich plant, erscheinen deine Schichten hier.")
        }
      </div>
    </section>
  `;
}

function renderRequestMemberPanel() {
  const requests = state.data.requests || [];

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Feedback an die Leitung</p>
          <h2>Wuensche, Hinweise und Stimmungsbild</h2>
          <p class="section-copy">Hier meldest du Verfuegbarkeit, gibst Feedback zum Teamalltag oder schickst eine kurze Notiz an die Leitung.</p>
        </div>
      </div>

      <form class="stack-form" data-form="request">
        <div class="form-grid">
          <div class="field">
            <label for="requestType">Typ</label>
            <select id="requestType" name="type" required>
              <option value="Feedback">Feedback</option>
              <option value="Wunsch">Wunsch</option>
              <option value="Notiz">Notiz</option>
              <option value="Verfuegbarkeit">Verfuegbarkeit</option>
            </select>
          </div>
          <div class="field">
            <label for="requestDate">Bezug auf Datum</label>
            <input id="requestDate" name="date" type="date">
          </div>
          <div class="field">
            <label for="requestRating">Bewertung</label>
            <select id="requestRating" name="rating">
              <option value="0">Keine Bewertung</option>
              <option value="5">5 - Sehr gut</option>
              <option value="4">4 - Gut</option>
              <option value="3">3 - Mittel</option>
              <option value="2">2 - Eher schwierig</option>
              <option value="1">1 - Kritisch</option>
            </select>
          </div>
          <div class="field span-all">
            <label for="requestContent">Nachricht</label>
            <textarea id="requestContent" name="content" placeholder="Schichtwunsch, Ausfall, Wunschwelt oder andere Info" required></textarea>
          </div>
        </div>
        <button type="submit">Feedback senden</button>
      </form>

      <div class="stack-list">
        ${
          requests.length
            ? requests.map((entry) => renderMemberRequestCard(entry)).join("")
            : renderEmptyState("Noch keine Notizen", "Deine Rueckmeldungen an die Leitung erscheinen hier mit Status.")
        }
      </div>
    </section>
  `;
}

function renderMemberRequestCard(entry) {
  const statusTone = entry.status === "beruecksichtigt" ? "success" : entry.status === "in_planung" ? "amber" : "rose";

  return `
    <article class="request-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill ${statusTone}">${escapeHtml(getStatusLabel(entry.status))}</span>
          <span class="pill neutral">${escapeHtml(entry.type)}</span>
          ${renderRatingPill(entry.rating)}
        </div>
      </div>
      <p>${escapeHtml(entry.content)}</p>
      <p class="timeline-meta">${escapeHtml(entry.date ? formatDate(entry.date) : "Ohne fixes Datum")} | ${escapeHtml(formatDateTime(entry.createdAt))}</p>
      ${entry.adminNote ? `<p class="helper-text">Leitungsnotiz: ${escapeHtml(entry.adminNote)}</p>` : ""}
    </article>
  `;
}

function renderEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function renderFlash() {
  if (!state.ui.flash) return "";

  return `
    <div class="flash flash-${escapeHtml(state.ui.flash.tone || "info")}">
      <span>${escapeHtml(state.ui.flash.message)}</span>
      <button type="button" class="ghost small" data-action="dismiss-flash">Schliessen</button>
    </div>
  `;
}

async function handleSubmit(event) {
  const form = event.target;
  const formName = form.dataset.form;
  if (!formName) return;

  event.preventDefault();

  switch (formName) {
    case "login": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/login", {
            method: "POST",
            body: JSON.stringify({
              identifier: formData.get("identifier"),
              password: formData.get("password")
            })
          }),
        "Willkommen im Portal."
      );
      break;
    }

    case "register": {
      const formData = new FormData(form);
      const password = String(formData.get("password") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (password !== confirmPassword) {
        setFlash("Die Passwoerter stimmen nicht ueberein.", "danger");
        render();
        return;
      }

      await performAction(
        () =>
          api("/api/register", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              avatarUrl: formData.get("avatarUrl"),
              bio: formData.get("bio"),
              password
            })
          }),
        "Zugang wurde erstellt."
      );
      break;
    }

    case "shift": {
      const formData = new FormData(form);
      const payload = {
        date: formData.get("date"),
        startTime: normalizeTimeValue(formData.get("startTime")),
        endTime: normalizeTimeValue(formData.get("endTime")),
        memberId: formData.get("memberId"),
        shiftType: String(formData.get("shiftType") || "").trim(),
        world: String(formData.get("world") || "").trim(),
        task: String(formData.get("task") || "").trim(),
        notes: formData.get("notes"),
        isLead: formData.get("isLead") === "on"
      };
      const catalogAdds = collectCatalogAddsForShift(payload, state.data.settings);
      if (catalogAdds.shiftTypes.length || catalogAdds.worlds.length || catalogAdds.tasks.length) {
        const lines = [
          "Diese Werte sind neu und noch nicht im Katalog:",
          ...catalogAdds.shiftTypes.map((entry) => `- Schichttyp: ${entry}`),
          ...catalogAdds.worlds.map((entry) => `- Welt: ${entry}`),
          ...catalogAdds.tasks.map((entry) => `- Aufgabe: ${entry}`),
          "",
          "Sollen diese Werte zusaetzlich in die Listen aufgenommen werden?"
        ];

        if (window.confirm(lines.join("\n"))) {
          payload.catalogAdds = catalogAdds;
        }
      }

      const shiftId = state.ui.editingShiftId;
      await performAction(
        () =>
          api(shiftId ? `/api/shifts/${encodeURIComponent(shiftId)}` : "/api/shifts", {
            method: shiftId ? "PATCH" : "POST",
            body: JSON.stringify(payload)
          }),
        shiftId ? "Schicht wurde aktualisiert." : "Neue Schicht wurde gespeichert."
      );
      rememberPlannerDraft(payload, { advanceDate: !shiftId });
      state.ui.editingShiftId = "";
      render();
      break;
    }

    case "request": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/requests", {
            method: "POST",
            body: JSON.stringify({
              type: formData.get("type"),
              date: formData.get("date"),
              content: formData.get("content"),
              rating: formData.get("rating")
            })
          }),
        "Deine Rueckmeldung wurde gespeichert."
      );
      break;
    }

    case "request-admin": {
      const formData = new FormData(form);
      const requestId = form.dataset.requestId;
      await performAction(
        () =>
          api(`/api/requests/${encodeURIComponent(requestId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: formData.get("status"),
              adminNote: formData.get("adminNote")
            })
          }),
        "Rueckmeldung fuer das Teammitglied gespeichert."
      );
      break;
    }

    case "announcement": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/announcements", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              body: formData.get("body"),
              pinned: formData.get("pinned") === "on",
              imageUrl: formData.get("imageUrl")
            })
          }),
        "Neue Info wurde veroeffentlicht."
      );
      break;
    }

    case "event-create": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/events", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              scheduleType: formData.get("scheduleType"),
              eventDate: formData.get("eventDate"),
              eventTime: formData.get("eventTime"),
              weekday: formData.get("weekday"),
              world: formData.get("world"),
              host: formData.get("host"),
              summary: formData.get("summary"),
              reminderEnabled: formData.get("reminderEnabled") === "on"
            })
          }),
        "Event wurde gespeichert."
      );
      break;
    }

    case "event-delete": {
      const eventId = form.dataset.eventId;
      if (!window.confirm("Dieses Event wirklich entfernen?")) return;
      await performAction(
        () =>
          api(`/api/events/${encodeURIComponent(eventId)}`, {
            method: "DELETE"
          }),
        "Event wurde entfernt.",
        "warning"
      );
      break;
    }

    case "catalog": {
      const formData = new FormData(form);
      const key = form.dataset.key;
      await performAction(
        () =>
          api(`/api/settings/${encodeURIComponent(key)}`, {
            method: "POST",
            body: JSON.stringify({ value: formData.get("value") })
          }),
        "Listenwert hinzugefuegt."
      );
      break;
    }

    case "chat": {
      const formData = new FormData(form);
      const successMessage = canAccessStaffArea() ? "Nachricht im Staff-Chat gepostet." : "Nachricht im Community-Chat gepostet.";
      await performAction(
        () =>
          api("/api/chat", {
            method: "POST",
            body: JSON.stringify({
              relatedShiftId: formData.get("relatedShiftId"),
              content: formData.get("content")
            })
          }),
        successMessage
      );
      break;
    }

    case "swap-decision": {
      const formData = new FormData(form);
      const swapRequestId = form.dataset.swapRequestId;
      const status = String(event.submitter?.value || "");
      await performAction(
        () =>
          api(`/api/swap-requests/${encodeURIComponent(swapRequestId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status,
              candidateId: formData.get("candidateId")
            })
          }),
        status === "genehmigt" ? "Tauschwunsch wurde genehmigt und die Schicht neu zugewiesen." : "Tauschwunsch wurde abgelehnt."
      );
      break;
    }

    case "admin-user-create": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              avatarUrl: formData.get("avatarUrl"),
              bio: formData.get("bio"),
              password: formData.get("password"),
              role: formData.get("role")
            })
          }),
        "Account wurde angelegt."
      );
      break;
    }

    case "user-update": {
      const formData = new FormData(form);
      const userId = form.dataset.userId;
      await performAction(
        () =>
          api(`/api/admin/users/${encodeURIComponent(userId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              role: formData.get("role"),
              password: formData.get("password"),
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              avatarUrl: formData.get("avatarUrl"),
              bio: formData.get("bio")
            })
          }),
        "Account wurde aktualisiert."
      );
      break;
    }

    case "profile-update": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              avatarUrl: formData.get("avatarUrl"),
              bio: formData.get("bio"),
              password: formData.get("password")
            })
          }),
        "Profil wurde aktualisiert."
      );
      break;
    }

    default:
      break;
  }
}

async function handleClick(event) {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;

  switch (actionElement.dataset.action) {
    case "dismiss-flash":
      state.ui.flash = null;
      render();
      break;

    case "set-tab":
      rememberTabBarState(actionElement);
      state.ui.activeTab = normalizeActiveTab(actionElement.dataset.tab || "");
      render();
      break;

    case "enable-browser-notifications":
      await requestBrowserNotificationPermission();
      render();
      break;

    case "refresh-vrchat-overview":
      await refreshVrchatOverview(true);
      break;

    case "refresh-discord-status":
      await refreshDiscordStatus(true);
      break;

    case "run-discord-test":
      await runDiscordTest();
      break;

    case "run-vrchat-sync":
      await runVrchatSync();
      break;

    case "logout":
      await performAction(
        () =>
          api("/api/logout", {
            method: "POST",
            body: "{}"
          }),
        "Du wurdest abgemeldet.",
        "info"
      );
      state.session = null;
      state.data = null;
      state.vrchatOverview = null;
      state.vrchatLoading = false;
      state.discordStatus = null;
      state.discordLoading = false;
      state.ui.editingShiftId = "";
      state.ui.activeTab = "";
      await refreshPublicData();
      render();
      break;

    case "reset-demo":
      if (!window.confirm("Demo-Daten wirklich komplett zuruecksetzen?")) return;
      await performAction(
        () =>
          api("/api/admin/reset-demo", {
            method: "POST",
            body: "{}"
          }),
        "Demo-Daten wurden neu geladen."
      );
      state.ui.editingShiftId = "";
      render();
      break;

    case "edit-shift":
      state.ui.editingShiftId = actionElement.dataset.shiftId || "";
      state.ui.scrollToShiftId = actionElement.dataset.shiftId || "";
      render();
      break;

    case "focus-shift":
      state.ui.activeTab = normalizeActiveTab("planning");
      state.ui.editingShiftId = actionElement.dataset.shiftId || "";
      state.ui.scrollToShiftId = actionElement.dataset.shiftId || "";
      render();
      break;

    case "cancel-shift-edit":
      state.ui.editingShiftId = "";
      render();
      break;

    case "delete-shift":
      if (!window.confirm("Diese Schicht wirklich loeschen?")) return;
      await performAction(
        () =>
          api(`/api/shifts/${encodeURIComponent(actionElement.dataset.shiftId)}`, {
            method: "DELETE"
          }),
        "Schicht wurde geloescht.",
        "warning"
      );
      if (state.ui.editingShiftId === actionElement.dataset.shiftId) {
        state.ui.editingShiftId = "";
      }
      render();
      break;

    case "delete-announcement":
      if (!window.confirm("Diesen Infoboard-Eintrag entfernen?")) return;
      await performAction(
        () =>
          api(`/api/announcements/${encodeURIComponent(actionElement.dataset.announcementId)}`, {
            method: "DELETE"
          }),
        "Infoboard-Eintrag entfernt.",
        "warning"
      );
      break;

    case "remove-catalog-item":
      await performAction(
        () =>
          api(`/api/settings/${encodeURIComponent(actionElement.dataset.key)}/${encodeURIComponent(actionElement.dataset.value)}`, {
            method: "DELETE"
          }),
        "Listenwert entfernt.",
        "warning"
      );
      break;

    case "check-in":
      await performAction(
        () =>
          api("/api/time/check-in", {
            method: "POST",
            body: JSON.stringify({ shiftId: actionElement.dataset.shiftId })
          }),
        "Du bist jetzt eingestempelt."
      );
      break;

    case "check-out":
      await performAction(
        () =>
          api("/api/time/check-out", {
            method: "POST",
            body: JSON.stringify({ shiftId: actionElement.dataset.shiftId })
          }),
        "Du wurdest ausgestempelt."
      );
      break;

    case "quick-swap": {
      const shiftId = actionElement.dataset.shiftId;
      const shift = (state.data.shifts || []).find((entry) => entry.id === shiftId);
      if (!shift) return;

      await performAction(
        () =>
          api("/api/swap-requests", {
            method: "POST",
            body: JSON.stringify({
              shiftId: shift.id,
              message: `Ich suche einen Tausch fuer ${shift.shiftType} am ${formatDate(shift.date)} von ${formatShiftWindow(shift)} in ${shift.world}. Bitte hier melden.`
            })
          }),
        "Tauschwunsch wurde erstellt."
      );
      break;
    }

    case "offer-swap":
      await performAction(
        () =>
          api(`/api/swap-requests/${encodeURIComponent(actionElement.dataset.swapRequestId)}/offer`, {
            method: "POST",
            body: "{}"
          }),
        "Du hast die Uebernahme angeboten."
      );
      break;

    case "delete-user":
      if (!window.confirm("Diesen Benutzer wirklich loeschen?")) return;
      await performAction(
        () =>
          api(`/api/admin/users/${encodeURIComponent(actionElement.dataset.userId)}`, {
            method: "DELETE"
          }),
        "Benutzer wurde geloescht.",
        "warning"
      );
      break;

    default:
      break;
  }
}

function handleChange(event) {
  const changeElement = event.target.closest("[data-change]");
  if (!changeElement) return;

  switch (changeElement.dataset.change) {
    case "shift-preset":
      applyShiftPreset(changeElement);
      break;

    default:
      break;
  }
}

function canManagePortal() {
  return state.session?.role === "planner" || state.session?.role === "admin";
}

function normalizeActiveTab(tab) {
  const allowed = canManagePortal()
    ? ["overview", "planning", "team", "news", "feedback", "chat", "time", "profile", "settings"]
    : ["overview", "schedule", "feedback", "news", "chat", "time", "profile"];

  return allowed.includes(tab) ? tab : "overview";
}

function renderWarningOverlay() {
  const currentUserId = state.session?.id || "";
  const warnings = (state.data?.warnings || []).filter(
    (entry) => entry.status === "active" && !entry.acknowledgedAt && entry.userId === currentUserId
  );
  if (!warnings.length) return "";

  return `
    <div class="warning-overlay">
      <div class="warning-modal">
        <p class="eyebrow">Wichtige Verwarnung</p>
        <h2>Bitte zuerst lesen</h2>
        <div class="warning-grid">
          ${warnings.map((entry) => renderWarningCard(entry, false)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderWarningAdminPanel() {
  if (!canManagePortal()) return "";
  const warnings = (state.data?.managedWarnings || []).filter((entry) => entry.status === "active").slice(0, 8);

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Verwarnungen</p>
          <h2>Aktive Hinweise an Mitglieder</h2>
        </div>
      </div>
      <div class="warning-grid">
        ${warnings.length ? warnings.map((entry) => renderWarningCard(entry, true)).join("") : renderEmptyState("Keine aktiven Verwarnungen", "Aktuell ist nichts offen.")}
      </div>
    </section>
  `;
}

function renderWarningCard(entry, managerView) {
  return `
    <article class="warning-card">
      <div class="status-row">
        <span class="pill rose">${entry.acknowledgedAt ? "Bestaetigt" : "Offen"}</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
      </div>
      <h3>${escapeHtml(entry.userName || "Verwarnung")}</h3>
      <p>${escapeHtml(entry.reason)}</p>
      <p class="timeline-meta">von ${escapeHtml(entry.createdByName || "Leitung")}</p>
      <div class="card-actions">
        ${
          managerView
            ? `
              <form data-form="warning-clear" data-warning-id="${escapeHtml(entry.id)}">
                <button type="submit" class="ghost small">Als erledigt markieren</button>
              </form>
            `
            : `
              <form data-form="warning-ack" data-warning-id="${escapeHtml(entry.id)}">
                <button type="submit" class="small">Ich habe es gelesen</button>
              </form>
            `
        }
      </div>
    </article>
  `;
}

function renderCreatorLinksText(user) {
  return (user.creatorLinks || []).map((entry) => `${entry.label} | ${entry.url}`).join("\n");
}

function renderCreatorLinkList(user, compact = false) {
  const links = user.creatorLinks || [];
  if (!links.length) return compact ? "" : '<p class="helper-text">Noch keine Creator-Links.</p>';

  return `
    <div class="chip-list creator-link-list">
      ${links
        .map(
          (entry) => `
            <a class="pill ${compact ? "neutral" : "sky"}" href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">
              ${escapeHtml(entry.label)}
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderCreatorCard(user) {
  return `
    <article class="team-card creator-card">
      <div class="profile-head">
        ${renderUserAvatar(user, "profile-avatar")}
        <div>
          <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
          <p class="timeline-meta">${escapeHtml(user.creatorBlurb || user.contactNote || "Creator-Profil")}</p>
        </div>
      </div>
      ${renderCreatorLinkList(user, true)}
    </article>
  `;
}

function renderCreatorsPanel(managerView) {
  const community = getCommunityData();
  const creators = community.creators || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Creator</p>
          <h2>Content Creator aus SONARA</h2>
        </div>
      </div>
      ${managerView ? '<p class="helper-text">Creator pflegen ihre Links im Profil. Im Team-Bereich kannst du sie bei Bedarf mit bearbeiten.</p>' : ""}
      <div class="team-grid">
        ${creators.length ? creators.map((entry) => renderCreatorCard(entry)).join("") : renderEmptyState("Noch keine Creator", "Sobald Creator Links hinterlegen, erscheinen sie hier.")}
      </div>
    </section>
  `;
}

function renderChatWorkspace(mode) {
  const panels = [renderChatPanel("community"), renderDirectMessagesPanel()];
  if (mode !== "member") panels.push(renderChatPanel("staff", true));
  return panels.join("");
}

function renderChatPanel(mode = "community", compact = false) {
  const messages = getChatFeed(mode);
  const title = mode === "staff" ? "Staff-Chat" : "Allgemeiner Chat";
  const copy = mode === "staff" ? "Interne Abstimmung im Team." : "Offener Live-Chat fuer die Community.";
  const shifts = mode === "staff" && canAccessStaffArea() ? getSortedShifts(state.data?.shifts || []) : [];

  return `
    <section class="panel ${compact ? "span-5" : "span-7"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">${mode === "staff" ? "Intern" : "Community"}</p>
          <h2>${title}</h2>
          <p class="section-copy">${copy}</p>
        </div>
      </div>

      <form class="stack-form" data-form="chat">
        <input type="hidden" name="channel" value="${mode}">
        ${
          mode === "staff"
            ? `
              <div class="field">
                <label for="chatShiftRef-${mode}">Schichtbezug</label>
                <select id="chatShiftRef-${mode}" name="relatedShiftId">
                  <option value="">Kein Schichtbezug</option>
                  ${shifts.map((entry) => renderShiftSelectOption(entry)).join("")}
                </select>
              </div>
            `
            : ""
        }
        <div class="field">
          <label for="chatContent-${mode}">Nachricht</label>
          <textarea id="chatContent-${mode}" name="content" placeholder="Nachricht schreiben"></textarea>
        </div>
        <button type="submit">Senden</button>
      </form>

      <div class="chat-list">
        ${messages.length ? messages.map((message) => renderChatMessage(message)).join("") : renderEmptyState("Noch nichts im Chat", "Sobald jemand schreibt, erscheint es hier.")}
      </div>
    </section>
  `;
}

function buildDirectMessageConversations() {
  const messages = state.data?.directMessages || [];
  const users = new Map((state.data?.directory || []).map((entry) => [entry.id, entry]));
  const conversations = new Map();

  for (const message of messages) {
    const otherId = message.senderId === state.session?.id ? message.recipientId : message.senderId;
    if (!otherId) continue;
    if (!conversations.has(otherId)) {
      conversations.set(otherId, {
        otherUser: users.get(otherId) || { id: otherId, vrchatName: message.senderName || "Unbekannt" },
        messages: []
      });
    }
    conversations.get(otherId).messages.push(message);
  }

  return Array.from(conversations.values())
    .map((entry) => ({
      ...entry,
      messages: entry.messages.slice().sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)),
      lastAt: entry.messages.reduce((latest, message) => Math.max(latest, new Date(message.createdAt).getTime()), 0)
    }))
    .sort((left, right) => right.lastAt - left.lastAt);
}

function renderDirectMessageBubble(message) {
  const outgoing = message.senderId === state.session?.id;
  return `
    <article class="dm-bubble ${outgoing ? "outgoing" : "incoming"}">
      <div class="chat-meta">
        <strong>${escapeHtml(outgoing ? "Du" : message.senderName)}</strong>
        <span>${escapeHtml(formatDateTime(message.createdAt))}</span>
      </div>
      <p>${escapeHtml(message.content)}</p>
    </article>
  `;
}

function renderDirectMessageCard(conversation) {
  return `
    <article class="dm-thread-card">
      <div class="profile-head">
        ${renderUserAvatar(conversation.otherUser, "profile-avatar")}
        <div>
          <h3>${escapeHtml(getPrimaryDisplayName(conversation.otherUser))}</h3>
          <p class="timeline-meta">${escapeHtml(conversation.otherUser.discordName || "")}</p>
        </div>
      </div>
      <div class="dm-message-stack">
        ${conversation.messages.slice(-6).map((message) => renderDirectMessageBubble(message)).join("")}
      </div>
      <form class="stack-form" data-form="direct-message" data-recipient-id="${escapeHtml(conversation.otherUser.id)}">
        <div class="field">
          <label for="dmReply-${escapeHtml(conversation.otherUser.id)}">Antwort</label>
          <textarea id="dmReply-${escapeHtml(conversation.otherUser.id)}" name="content" placeholder="Direktnachricht schreiben"></textarea>
        </div>
        <button type="submit">Senden</button>
      </form>
    </article>
  `;
}

function renderDirectMessagesPanel() {
  const recipients = (state.data?.directory || []).filter((entry) => entry.id !== state.session?.id);
  const conversations = buildDirectMessageConversations();

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Direktnachrichten</p>
          <h2>Private Nachrichten</h2>
        </div>
      </div>

      <form class="stack-form" data-form="direct-message">
        <div class="field">
          <label for="dmRecipient">An</label>
          <select id="dmRecipient" name="recipientId" required>
            <option value="">Person auswaehlen</option>
            ${recipients.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(getPrimaryDisplayName(entry))}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="dmContent">Nachricht</label>
          <textarea id="dmContent" name="content" placeholder="Private Nachricht"></textarea>
        </div>
        <button type="submit">Nachricht senden</button>
      </form>

      <div class="dm-thread-list">
        ${conversations.length ? conversations.map((entry) => renderDirectMessageCard(entry)).join("") : renderEmptyState("Noch keine Direktnachrichten", "Sobald du jemandem schreibst, erscheint der Verlauf hier.")}
      </div>
    </section>
  `;
}

function renderForumReply(reply) {
  return `
    <article class="forum-reply-card">
      <div class="chat-meta">
        <strong>${escapeHtml(reply.authorName)}</strong>
        <span>${escapeHtml(formatDateTime(reply.createdAt))}</span>
      </div>
      <p>${escapeHtml(reply.content)}</p>
    </article>
  `;
}

function renderForumThreadCard(thread) {
  return `
    <article class="forum-thread-card">
      <div class="status-row">
        <span class="pill sky">${escapeHtml(thread.category || "Allgemein")}</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(thread.createdAt))}</span>
      </div>
      <h3>${escapeHtml(thread.title)}</h3>
      <p class="timeline-meta">von ${escapeHtml(thread.authorName)}</p>
      <p>${escapeHtml(thread.content)}</p>
      <div class="forum-replies">
        ${(thread.replies || []).length ? thread.replies.map((reply) => renderForumReply(reply)).join("") : '<p class="helper-text">Noch keine Antworten.</p>'}
      </div>
      <form class="stack-form" data-form="forum-reply" data-thread-id="${escapeHtml(thread.id)}">
        <div class="field">
          <label for="forumReply-${escapeHtml(thread.id)}">Antwort</label>
          <textarea id="forumReply-${escapeHtml(thread.id)}" name="content" placeholder="Antwort schreiben"></textarea>
        </div>
        <button type="submit">Antworten</button>
      </form>
    </article>
  `;
}

function renderForumPanel(managerView) {
  const threads = state.data?.forumThreads || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Forum</p>
          <h2>Fragen, Ideen und Anfragen</h2>
        </div>
      </div>

      <form class="stack-form" data-form="forum-thread">
        <div class="form-grid">
          <div class="field">
            <label for="forumTitle">Titel</label>
            <input id="forumTitle" name="title" type="text" required>
          </div>
          <div class="field">
            <label for="forumCategory">Kategorie</label>
            <input id="forumCategory" name="category" type="text" placeholder="${managerView ? "z. B. Event, Feedback, Hilfe" : "z. B. Hilfe, Idee, Event"}">
          </div>
          <div class="field span-all">
            <label for="forumContent">Beitrag</label>
            <textarea id="forumContent" name="content" placeholder="Dein Anliegen"></textarea>
          </div>
        </div>
        <button type="submit">Thread erstellen</button>
      </form>

      <div class="forum-thread-list">
        ${threads.length ? threads.map((thread) => renderForumThreadCard(thread)).join("") : renderEmptyState("Noch keine Threads", "Sobald jemand ein Thema erstellt, erscheint es hier.")}
      </div>
    </section>
  `;
}

function renderTeamPanelV2() {
  const users = state.data?.users || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Team und Mitglieder</p>
          <h2>Accounts, Rollen und Creator-Profile</h2>
        </div>
        <span class="pill neutral">${escapeHtml(String(users.length))} Accounts</span>
      </div>

      ${
        canManageUsers()
          ? `
            <form class="stack-form" data-form="admin-user-create">
              <div class="form-grid">
                <div class="field">
                  <label for="newVrchatName">VRChat-Name</label>
                  <input id="newVrchatName" name="vrchatName" type="text" required>
                </div>
                <div class="field">
                  <label for="newDiscordName">Discord-Name</label>
                  <input id="newDiscordName" name="discordName" type="text" required>
                </div>
                <div class="field">
                  <label for="newRole">Rolle</label>
                  <select id="newRole" name="role">${buildRoleOptions("member")}</select>
                </div>
                <div class="field">
                  <label for="newAvatarFile">Profilbild</label>
                  <input id="newAvatarFile" name="avatarFile" type="file" accept="image/*">
                </div>
                <div class="field">
                  <label for="newPassword">Startpasswort</label>
                  <input id="newPassword" name="password" type="password" required>
                </div>
                <div class="field">
                  <label for="newCreatorVisible">Im Creator-Bereich zeigen</label>
                  <input id="newCreatorVisible" name="creatorVisible" type="checkbox">
                </div>
                <div class="field span-all">
                  <label for="newBio">Kurzprofil</label>
                  <textarea id="newBio" name="bio"></textarea>
                </div>
                <div class="field span-all">
                  <label for="newContactNote">Kontakt / Hinweise</label>
                  <textarea id="newContactNote" name="contactNote" placeholder="Discord-Server, Kontaktinfo oder kurze Hinweise"></textarea>
                </div>
                <div class="field">
                  <label for="newCreatorBlurb">Creator-Text</label>
                  <input id="newCreatorBlurb" name="creatorBlurb" type="text" placeholder="Kurztext fuer Creator-Bereich">
                </div>
                <div class="field span-all">
                  <label for="newCreatorLinks">Creator-Links</label>
                  <textarea id="newCreatorLinks" name="creatorLinks" placeholder="Discord | https://...&#10;TikTok | https://...&#10;Spotify | https://..."></textarea>
                </div>
              </div>
              <button type="submit">Account anlegen</button>
            </form>
          `
          : ""
      }

      <div class="wide-team-grid">
        ${users
          .map((user) => {
            const shiftCount = (state.data?.shifts || []).filter((entry) => entry.memberId === user.id).length;
            const requestCount = (state.data?.requests || []).filter((entry) => entry.userId === user.id && entry.status !== "beruecksichtigt").length;

            return `
              <article class="request-card team-user-card">
                <div class="status-row">
                  <div class="chip-list">
                    <span class="pill ${user.role === "admin" ? "amber" : user.role === "planner" ? "sky" : user.role === "moderator" ? "teal" : "neutral"}">${escapeHtml(ROLE_LABELS[user.role])}</span>
                    ${user.isBlocked ? '<span class="pill rose">Gesperrt</span>' : '<span class="pill success">Aktiv</span>'}
                  </div>
                  <span class="timeline-meta">${escapeHtml(String(shiftCount))} Schichten | ${escapeHtml(String(requestCount))} offen</span>
                </div>
                <div class="profile-head">
                  ${renderUserAvatar(user, "profile-avatar")}
                  <div>
                    <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
                    <p class="timeline-meta">Discord: ${escapeHtml(user.discordName || "-")}</p>
                    ${user.isBlocked ? `<p class="helper-text"><strong>Gesperrt:</strong> ${escapeHtml(user.blockReason || "Kein Grund angegeben.")}</p>` : ""}
                    ${user.bio ? `<p class="helper-text">${escapeHtml(user.bio)}</p>` : ""}
                    ${user.contactNote ? `<p class="helper-text">${escapeHtml(user.contactNote)}</p>` : ""}
                    ${user.role === "moderator" && (Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0)) ? `<p class="helper-text">Verfuegbar: ${escapeHtml(formatCapacityHours(user.weeklyHoursCapacity))} / ${escapeHtml(formatCapacityDays(user.weeklyDaysCapacity))}</p>` : ""}
                    ${user.role === "moderator" && user.availabilitySchedule ? `<p class="helper-text"><strong>Diese Woche:</strong> ${escapeHtml(user.availabilitySchedule)}</p>` : ""}
                    ${renderCreatorLinkList(user, true)}
                  </div>
                </div>

                <form data-form="user-update" data-user-id="${escapeHtml(user.id)}">
                  <div class="form-grid">
                    <div class="field">
                      <label for="vrchat-${escapeHtml(user.id)}">VRChat-Name</label>
                      <input id="vrchat-${escapeHtml(user.id)}" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}" required>
                    </div>
                    <div class="field">
                      <label for="discord-${escapeHtml(user.id)}">Discord-Name</label>
                      <input id="discord-${escapeHtml(user.id)}" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}" required>
                    </div>
                    <div class="field">
                      <label for="role-${escapeHtml(user.id)}">Rolle</label>
                      <select id="role-${escapeHtml(user.id)}" name="role">${buildRoleOptions(user.role)}</select>
                    </div>
                    <div class="field">
                      <label for="avatar-${escapeHtml(user.id)}">Profilbild</label>
                      <input id="avatar-${escapeHtml(user.id)}" name="avatarFile" type="file" accept="image/*">
                    </div>
                    <div class="field">
                      <label for="password-${escapeHtml(user.id)}">Neues Passwort</label>
                      <input id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Leer lassen = behalten">
                    </div>
                    <div class="field">
                      <label for="creatorVisible-${escapeHtml(user.id)}">Im Creator-Bereich zeigen</label>
                      <input id="creatorVisible-${escapeHtml(user.id)}" name="creatorVisible" type="checkbox" ${user.creatorVisible ? "checked" : ""}>
                    </div>
                    <div class="field">
                      <label for="blocked-${escapeHtml(user.id)}">Account sperren</label>
                      <input id="blocked-${escapeHtml(user.id)}" name="blocked" type="checkbox" ${user.isBlocked ? "checked" : ""}>
                    </div>
                    <div class="field span-all">
                      <label for="bio-${escapeHtml(user.id)}">Kurzprofil</label>
                      <textarea id="bio-${escapeHtml(user.id)}" name="bio">${escapeHtml(user.bio || "")}</textarea>
                    </div>
                    <div class="field span-all">
                      <label for="contact-${escapeHtml(user.id)}">Kontakt / Hinweise</label>
                      <textarea id="contact-${escapeHtml(user.id)}" name="contactNote">${escapeHtml(user.contactNote || "")}</textarea>
                    </div>
                    ${
                      user.role === "moderator"
                        ? `
                          <div class="field">
                            <label for="weeklyHours-${escapeHtml(user.id)}">Stunden pro Woche</label>
                            <input id="weeklyHours-${escapeHtml(user.id)}" name="weeklyHoursCapacity" type="number" min="0" max="168" step="0.5" value="${escapeHtml(String(user.weeklyHoursCapacity || ""))}">
                          </div>
                          <div class="field">
                            <label for="weeklyDays-${escapeHtml(user.id)}">Tage pro Woche</label>
                            <input id="weeklyDays-${escapeHtml(user.id)}" name="weeklyDaysCapacity" type="number" min="0" max="7" step="1" value="${escapeHtml(String(user.weeklyDaysCapacity || ""))}">
                          </div>
                          <div class="field span-all">
                            <label for="availability-${escapeHtml(user.id)}">Zeitfenster fuer diese Woche</label>
                            <textarea id="availability-${escapeHtml(user.id)}" name="availabilitySchedule" placeholder="Mo 18:00-22:00, Di frei, Mi 20:00-00:00">${escapeHtml(user.availabilitySchedule || "")}</textarea>
                            <p class="helper-text">Bitte bis Samstag eintragen. Ohne Rueckmeldung keine Einplanung; wiederholt fehlend kann zu Verwarnungen fuehren.</p>
                          </div>
                        `
                        : ""
                    }
                    <div class="field">
                      <label for="creatorBlurb-${escapeHtml(user.id)}">Creator-Text</label>
                      <input id="creatorBlurb-${escapeHtml(user.id)}" name="creatorBlurb" type="text" value="${escapeHtml(user.creatorBlurb || "")}">
                    </div>
                    <div class="field">
                      <label for="blockReason-${escapeHtml(user.id)}">Sperrgrund</label>
                      <input id="blockReason-${escapeHtml(user.id)}" name="blockReason" type="text" value="${escapeHtml(user.blockReason || "")}" placeholder="z. B. Missbrauch oder Regelverstoss">
                    </div>
                    <div class="field span-all">
                      <label for="creatorLinks-${escapeHtml(user.id)}">Creator-Links</label>
                      <textarea id="creatorLinks-${escapeHtml(user.id)}" name="creatorLinks" placeholder="Discord | https://...&#10;TikTok | https://...">${escapeHtml(renderCreatorLinksText(user))}</textarea>
                    </div>
                  </div>
                  <div class="card-actions">
                    <button type="submit" class="ghost small">Speichern</button>
                    ${
                      user.username !== "admin" && user.id !== state.session?.id
                        ? `<button type="button" class="danger small" data-action="delete-user" data-user-id="${escapeHtml(user.id)}">Loeschen</button>`
                        : ""
                    }
                  </div>
                </form>

                ${
                  user.id !== state.session?.id
                    ? `
                      <form class="stack-form" data-form="warning-create" data-user-id="${escapeHtml(user.id)}">
                        <div class="field">
                          <label for="warning-${escapeHtml(user.id)}">Verwarnung an ${escapeHtml(getPrimaryDisplayName(user))}</label>
                          <textarea id="warning-${escapeHtml(user.id)}" name="reason" placeholder="Begruendung"></textarea>
                        </div>
                        <button type="submit" class="ghost small">Verwarnung senden</button>
                      </form>
                    `
                    : ""
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderProfilePanel(managerView) {
  const user = state.session;

  return `
    <section class="panel ${managerView ? "span-12" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Profil</p>
          <h2>Dein Community-Profil</h2>
        </div>
      </div>

      <div class="profile-panel">
        <div class="profile-preview">
          ${renderUserAvatar(user, "hero-avatar")}
          <div>
            <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
            <p class="timeline-meta">VRChat: ${escapeHtml(user.vrchatName || "-")} | Discord: ${escapeHtml(user.discordName || "-")}</p>
            ${user.bio ? `<p class="helper-text">${escapeHtml(user.bio)}</p>` : ""}
            ${user.contactNote ? `<p class="helper-text">${escapeHtml(user.contactNote)}</p>` : ""}
            ${(Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0)) ? `<p class="helper-text">Verfuegbar: ${escapeHtml(formatCapacityHours(user.weeklyHoursCapacity))} / ${escapeHtml(formatCapacityDays(user.weeklyDaysCapacity))}</p>` : ""}
            ${renderCreatorLinkList(user, true)}
          </div>
        </div>

        <form class="stack-form" data-form="profile-update">
          <div class="form-grid">
            <div class="field">
              <label for="profileVrchatName">VRChat-Name</label>
              <input id="profileVrchatName" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}" required>
            </div>
            <div class="field">
              <label for="profileDiscordName">Discord-Name</label>
              <input id="profileDiscordName" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}" required>
            </div>
            <div class="field">
              <label for="profileAvatarFile">Profilbild</label>
              <input id="profileAvatarFile" name="avatarFile" type="file" accept="image/*">
            </div>
            <div class="field">
              <label for="profilePassword">Neues Passwort</label>
              <input id="profilePassword" name="password" type="password" placeholder="Leer lassen = behalten">
            </div>
            <div class="field span-all">
              <label for="profileBio">Kurzprofil</label>
              <textarea id="profileBio" name="bio">${escapeHtml(user.bio || "")}</textarea>
            </div>
            <div class="field span-all">
              <label for="profileContactNote">Kontakt / Hinweise</label>
              <textarea id="profileContactNote" name="contactNote" placeholder="Discord-Server, kurze Erreichbarkeit oder Info">${escapeHtml(user.contactNote || "")}</textarea>
            </div>
            <div class="field">
              <label for="profileWeeklyHoursCapacity">Verfuegbare Stunden pro Woche</label>
              <input id="profileWeeklyHoursCapacity" name="weeklyHoursCapacity" type="number" min="0" max="168" step="0.5" value="${escapeHtml(String(user.weeklyHoursCapacity || ""))}" placeholder="z. B. 12">
            </div>
            <div class="field">
              <label for="profileWeeklyDaysCapacity">Verfuegbare Tage pro Woche</label>
              <input id="profileWeeklyDaysCapacity" name="weeklyDaysCapacity" type="number" min="0" max="7" step="1" value="${escapeHtml(String(user.weeklyDaysCapacity || ""))}" placeholder="z. B. 3">
            </div>
            <div class="field">
              <label for="profileCreatorBlurb">Creator-Text</label>
              <input id="profileCreatorBlurb" name="creatorBlurb" type="text" value="${escapeHtml(user.creatorBlurb || "")}" placeholder="z. B. Musik, Clips, Streams">
            </div>
            <div class="field">
              <label for="profileCreatorVisible">Im Creator-Bereich zeigen</label>
              <input id="profileCreatorVisible" name="creatorVisible" type="checkbox" ${user.creatorVisible ? "checked" : ""}>
            </div>
            <div class="field span-all">
              <label for="profileCreatorLinks">Creator-Links</label>
              <textarea id="profileCreatorLinks" name="creatorLinks" placeholder="Discord | https://...&#10;TikTok | https://...&#10;Spotify | https://...">${escapeHtml(renderCreatorLinksText(user))}</textarea>
            </div>
          </div>
          <button type="submit">Profil speichern</button>
        </form>
      </div>
    </section>
  `;
}

function syncChatStream() {
  if (!state.session) {
    closeChatStream();
    return;
  }

  if (state.chatStream) return;

  const stream = new EventSource("/api/stream");
  state.chatStream = stream;

  stream.addEventListener("open", () => {
    state.ui.liveChatConnected = true;
    render();
  });

  stream.addEventListener("chat", async () => {
    await refreshBootstrap();
    render();
  });

  stream.addEventListener("portal", async () => {
    await refreshBootstrap();
    render();
  });

  stream.addEventListener("error", () => {
    state.ui.liveChatConnected = false;
    closeChatStream(false);
    window.setTimeout(() => {
      if (!state.session) return;
      syncChatStream();
    }, 2500);
    render();
  });
}

function closeChatStream(resetState = true) {
  if (state.chatStream) {
    state.chatStream.close();
    state.chatStream = null;
  }

  if (resetState) {
    state.ui.liveChatConnected = false;
  }
}

function syncNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    state.ui.notificationPermission = "unsupported";
    return;
  }

  state.ui.notificationPermission = Notification.permission;
}

async function requestBrowserNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    setFlash("Dieser Browser unterstuetzt keine Benachrichtigungen.", "warning");
    return;
  }

  const permission = await Notification.requestPermission();
  state.ui.notificationPermission = permission;
  if (permission === "granted") {
    setFlash("Browser-Benachrichtigungen wurden aktiviert.", "success");
  }
}

function emitBrowserNotifications() {
  if (!state.session || state.ui.notificationPermission !== "granted") return;

  const notifications = state.data?.notifications || [];
  const latest = notifications[0];
  if (!latest) return;

  const key = `seen-notification-${state.session.id}`;
  const seenId = window.localStorage.getItem(key);
  if (seenId === latest.id) return;

  window.localStorage.setItem(key, latest.id);
  new Notification(latest.title, {
    body: latest.body
  });
}

function getOpenSwapRequestForShift(shiftId) {
  return (state.data.swapRequests || []).find((entry) => entry.shiftId === shiftId && ["offen", "angeboten"].includes(entry.status)) || null;
}

function getSwapStatusLabel(status) {
  return {
    offen: "Offen",
    angeboten: "Angebote vorhanden",
    genehmigt: "Genehmigt",
    abgelehnt: "Abgelehnt"
  }[status] || status;
}

function canManageUsers() {
  return state.session?.role === "admin";
}

function getPrimaryDisplayName(user) {
  return String(user?.vrchatName || user?.displayName || user?.discordName || "Unbekannt").trim() || "Unbekannt";
}

function getInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "SO";
}

function renderUserAvatar(user, className = "") {
  const label = getPrimaryDisplayName(user);
  const classes = ["avatar", className].filter(Boolean).join(" ");

  if (user?.avatarUrl) {
    return `
      <div class="${classes}">
        <img src="${escapeHtml(user.avatarUrl)}" alt="Profilbild von ${escapeHtml(label)}" class="avatar-image">
      </div>
    `;
  }

  return `<div class="${classes}" aria-hidden="true">${escapeHtml(getInitials(label))}</div>`;
}

function renderRatingPill(rating) {
  const value = Number(rating || 0);
  if (!value) return "";
  return `<span class="pill neutral">Bewertung ${escapeHtml(`${value}/5`)}</span>`;
}

function getAssignableUsers() {
  return (state.data.users || []).slice().sort((left, right) => getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de"));
}

function roleLabelForUserId(userId) {
  const user = (state.data.users || []).find((entry) => entry.id === userId);
  return user ? ROLE_LABELS[user.role] : "Account";
}

function getSortedShifts(shifts) {
  return shifts
    .slice()
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if ((left.startTime || "") !== (right.startTime || "")) return compareTimeValues(left.startTime || "", right.startTime || "");
      if (left.shiftType !== right.shiftType) return left.shiftType.localeCompare(right.shiftType, "de");
      return left.world.localeCompare(right.world, "de");
    });
}

function buildShiftCalendarDays(shifts) {
  const groupedByDate = new Map();

  for (const shift of shifts) {
    const dateKey = String(shift.date || "");
    const slotKey = [dateKey, shift.startTime || "", shift.endTime || "", shift.world || ""].join("|");
    if (!groupedByDate.has(dateKey)) groupedByDate.set(dateKey, new Map());

    const slotMap = groupedByDate.get(dateKey);
    if (!slotMap.has(slotKey)) {
      slotMap.set(slotKey, {
        key: slotKey,
        date: dateKey,
        world: shift.world || "Ohne Welt",
        startTime: shift.startTime || "",
        endTime: shift.endTime || "",
        windowLabel: formatShiftWindow(shift),
        shiftTypes: [],
        members: []
      });
    }

    const slot = slotMap.get(slotKey);
    if (!slot.shiftTypes.includes(shift.shiftType)) slot.shiftTypes.push(shift.shiftType);
    slot.members.push(shift);
  }

  return Array.from(groupedByDate.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, slotMap]) => ({
      date,
      slots: Array.from(slotMap.values())
        .sort((left, right) => compareTimeValues(left.startTime || "", right.startTime || "") || left.world.localeCompare(right.world, "de"))
        .map((slot) => ({
          ...slot,
          members: slot.members
            .slice()
            .sort((left, right) => Number(Boolean(right.isLead)) - Number(Boolean(left.isLead)) || (left.memberName || "").localeCompare(right.memberName || "", "de"))
        }))
    }));
}

function buildCapacityRows() {
  const users = (state.data?.users || []).filter((entry) => entry.role === "moderator");
  const week = getCurrentWeekRange();

  return users
    .map((user) => {
      const workedHours = calculateWorkedHoursForWeek(user.id, week);
      const workedDays = calculateWorkedDaysForWeek(user.id, week);
      const plannedHours = calculatePlannedHoursForWeek(user.id, week);
      const plannedDays = calculatePlannedDaysForWeek(user.id, week);
      const capacityHours = Number(user.weeklyHoursCapacity || 0);
      const capacityDays = Number(user.weeklyDaysCapacity || 0);
      const availabilitySchedule = String(user.availabilitySchedule || "").trim();
      const availabilityUpdatedAt = String(user.availabilityUpdatedAt || "").trim();
      const overHours = capacityHours > 0 && plannedHours > capacityHours;
      const overDays = capacityDays > 0 && plannedDays > capacityDays;
      const fullyPlanned =
        (capacityHours > 0 && plannedHours >= capacityHours) ||
        (capacityDays > 0 && plannedDays >= capacityDays);
      const hasAvailability = Boolean(availabilitySchedule || capacityHours || capacityDays);

      let statusLabel = "Noch offen";
      let statusTone = "amber";
      if (!hasAvailability) {
        statusLabel = "Rueckmeldung fehlt";
        statusTone = "rose";
      } else if (overHours || overDays) {
        statusLabel = "Ueberplant";
        statusTone = "rose";
      } else if (fullyPlanned) {
        statusLabel = "Gedeckt";
        statusTone = "success";
      }

      return {
        user,
        workedHours,
        workedDays,
        plannedHours,
        plannedDays,
        capacityHours,
        capacityDays,
        availabilitySchedule,
        availabilityUpdatedAt,
        statusLabel,
        statusTone
      };
    })
    .sort((left, right) => left.user.vrchatName.localeCompare(right.user.vrchatName, "de"));
}

function getCurrentWeekRange(referenceDate = new Date()) {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  const weekday = start.getDay();
  const deltaToMonday = weekday === 0 ? -6 : 1 - weekday;
  start.setDate(start.getDate() + deltaToMonday);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return {
    start,
    end,
    startKey: getLocalDateKey(start),
    endKey: getLocalDateKey(end)
  };
}

function calculateWorkedHoursForWeek(userId, week) {
  return (state.data?.timeEntries || [])
    .filter((entry) => entry.userId === userId)
    .reduce((sum, entry) => sum + calculateEntryOverlapHours(entry, week), 0);
}

function calculateWorkedDaysForWeek(userId, week) {
  const days = new Set();
  for (const entry of state.data?.timeEntries || []) {
    if (entry.userId !== userId) continue;
    const overlap = getEntryOverlapWindow(entry, week);
    if (!overlap) continue;
    days.add(getLocalDateKey(overlap.start));
  }
  return days.size;
}

function calculatePlannedHoursForWeek(userId, week) {
  return getSortedShifts(state.data?.shifts || [])
    .filter((entry) => entry.memberId === userId && entry.date >= week.startKey && entry.date < week.endKey)
    .reduce((sum, entry) => sum + getShiftDurationHours(entry), 0);
}

function calculatePlannedDaysForWeek(userId, week) {
  return new Set(
    getSortedShifts(state.data?.shifts || [])
      .filter((entry) => entry.memberId === userId && entry.date >= week.startKey && entry.date < week.endKey)
      .map((entry) => entry.date)
  ).size;
}

function calculateEntryOverlapHours(entry, week) {
  const overlap = getEntryOverlapWindow(entry, week);
  if (!overlap) return 0;
  return (overlap.end - overlap.start) / 3600000;
}

function getEntryOverlapWindow(entry, week) {
  const entryStart = new Date(entry.checkInAt);
  const entryEnd = entry.checkOutAt ? new Date(entry.checkOutAt) : new Date();
  const overlapStart = entryStart > week.start ? entryStart : week.start;
  const overlapEnd = entryEnd < week.end ? entryEnd : week.end;
  if (!(overlapEnd > overlapStart)) return null;
  return { start: overlapStart, end: overlapEnd };
}

function getShiftDurationHours(shift) {
  const start = timeValueToMinutes(shift.startTime || "");
  const end = timeValueToMinutes(shift.endTime || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === Number.MAX_SAFE_INTEGER || end === Number.MAX_SAFE_INTEGER) return 0;
  const durationMinutes = end >= start ? end - start : 1440 - start + end;
  return durationMinutes / 60;
}

function formatHoursValue(value) {
  const numeric = Number(value || 0);
  const rounded = Math.round(numeric * 10) / 10;
  const hasDecimal = Math.abs(rounded % 1) > 0.001;
  return `${hasDecimal ? rounded.toFixed(1) : Math.round(rounded)} Std.`;
}

function formatCapacityHours(value) {
  const numeric = Number(value || 0);
  return numeric > 0 ? formatHoursValue(numeric) : "Keine Angabe";
}

function formatCapacityDays(value) {
  const numeric = Number(value || 0);
  return numeric > 0 ? `${numeric} Tage` : "Keine Angabe";
}

function buildCapacityDeltaText(plannedDelta, dayDelta) {
  const parts = [];
  if (plannedDelta !== null) {
    if (plannedDelta > 0) parts.push(`${formatHoursValue(plannedDelta)} noch frei`);
    else if (plannedDelta < 0) parts.push(`${formatHoursValue(Math.abs(plannedDelta))} ueberplant`);
    else parts.push("Stunden genau gedeckt");
  }

  if (dayDelta !== null) {
    if (dayDelta > 0) parts.push(`${dayDelta} Tage noch frei`);
    else if (dayDelta < 0) parts.push(`${Math.abs(dayDelta)} Tage ueberplant`);
    else parts.push("Tage genau gedeckt");
  }

  return parts.join(" · ");
}

function getOpenEntryForViewer() {
  return (state.data.timeEntries || []).find((entry) => !entry.checkOutAt) || null;
}

function getOpenEntryForShift(shiftId) {
  return (state.data.timeEntries || []).find((entry) => entry.shiftId === shiftId && !entry.checkOutAt) || null;
}

function getLatestEntryForShift(shiftId) {
  const entries = (state.data.timeEntries || [])
    .filter((entry) => entry.shiftId === shiftId)
    .sort((left, right) => new Date(right.checkInAt) - new Date(left.checkInAt));
  return entries[0] || null;
}

function buildShiftAuditRows() {
  return getSortedShifts(state.data.shifts || [])
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date) || compareTimeValues(left.startTime || "", right.startTime || "") || left.shiftType.localeCompare(right.shiftType, "de"))
    .slice(0, 12)
    .map((shift) => {
      const openEntry = getOpenEntryForShift(shift.id);
      const latestEntry = getLatestEntryForShift(shift.id);
      const today = getLocalDateKey();

      if (openEntry) {
        return {
          ...shift,
          label: "Aktiv",
          tone: "teal",
          detail: `Seit ${formatTime(openEntry.checkInAt)} eingestempelt.`
        };
      }

      if (latestEntry?.checkOutAt) {
        return {
          ...shift,
          label: "Erledigt",
          tone: "success",
          detail: `Gestempelt von ${formatTime(latestEntry.checkInAt)} bis ${formatTime(latestEntry.checkOutAt)}.`
        };
      }

      if (shift.date < today) {
        return {
          ...shift,
          label: "Ohne Stempel",
          tone: "rose",
          detail: "Die Schicht liegt in der Vergangenheit, aber es gibt keinen abgeschlossenen Stempel."
        };
      }

      if (shift.date === today) {
        return {
          ...shift,
          label: "Heute offen",
          tone: "amber",
          detail: "Heute geplant, bisher ohne Stempel."
        };
      }

      return {
        ...shift,
        label: "Geplant",
        tone: "sky",
        detail: "Zukuenftige Schicht ohne bisherigen Stempel."
      };
    });
}

function buildUserOptions(users, selectedId) {
  return [
    '<option value="">Moderator waehlen</option>',
    ...users.map(
      (user) => `
        <option value="${escapeHtml(user.id)}" ${user.id === selectedId ? "selected" : ""}>
          ${escapeHtml(getPrimaryDisplayName(user))}${user.discordName ? ` | ${escapeHtml(user.discordName)}` : ""}
        </option>
      `
    )
  ].join("");
}

function renderShiftPresetOptions(selectedValue) {
  return [
    '<option value="custom">Individuell</option>',
    ...SHIFT_WINDOW_PRESETS.map(
      (entry) => `
        <option value="${escapeHtml(entry.value)}" ${entry.value === selectedValue ? "selected" : ""}>
          ${escapeHtml(entry.label)}
        </option>
      `
    )
  ].join("");
}

function buildStringOptions(values, selectedValue, placeholder) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...values.map(
      (value) => `
        <option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>
          ${escapeHtml(value)}
        </option>
      `
    )
  ].join("");
}

function buildStatusOptions(selectedStatus) {
  return REQUEST_STATUSES.map(
    (entry) => `
      <option value="${escapeHtml(entry.value)}" ${entry.value === selectedStatus ? "selected" : ""}>
        ${escapeHtml(entry.label)}
      </option>
    `
  ).join("");
}

function buildRoleOptions(selectedRole) {
  return ["viewer", "planner", "admin"]
    .map(
      (role) => `
        <option value="${role}" ${role === selectedRole ? "selected" : ""}>
          ${escapeHtml(ROLE_LABELS[role])}
        </option>
      `
    )
    .join("");
}

function renderDatalistOptions(values) {
  return values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function renderShiftSelectOption(shift) {
  const label = `${formatDate(shift.date)} · ${formatShiftWindow(shift)} · ${shift.shiftType} · ${shift.world}${shift.memberName ? ` · ${shift.memberName}` : ""}`;
  return `<option value="${escapeHtml(shift.id)}">${escapeHtml(label)}</option>`;
}

function getStatusLabel(status) {
  return REQUEST_STATUSES.find((entry) => entry.value === status)?.label || status;
}

function getInitials(name) {
  return normalizeText(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function applyShiftPreset(select) {
  const preset = SHIFT_WINDOW_PRESETS.find((entry) => entry.value === select.value);
  if (!preset) return;

  const form = select.closest("form");
  if (!form) return;

  const [startTime, endTime] = preset.value.split("|");
  const startInput = form.querySelector('input[name="startTime"]');
  const endInput = form.querySelector('input[name="endTime"]');

  if (startInput) startInput.value = startTime;
  if (endInput) endInput.value = endTime;
}

function getMatchingShiftPresetValue(startTime, endTime) {
  const normalizedStart = normalizeTimeValue(startTime);
  const normalizedEnd = normalizeTimeValue(endTime);
  const match = SHIFT_WINDOW_PRESETS.find((entry) => {
    const [presetStart, presetEnd] = entry.value.split("|");
    return presetStart === normalizedStart && presetEnd === normalizedEnd;
  });

  return match ? match.value : "custom";
}

function collectCatalogAddsForShift(payload, settings) {
  return {
    shiftTypes: getUnknownCatalogValues([payload.shiftType], settings.shiftTypes),
    worlds: getUnknownCatalogValues([payload.world], settings.worlds),
    tasks: getUnknownCatalogValues([payload.task], settings.tasks)
  };
}

function getUnknownCatalogValues(values, catalog) {
  const known = new Set((catalog || []).map((entry) => normalizeText(entry)));
  return values
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, list) => list.findIndex((other) => other.toLowerCase() === entry.toLowerCase()) === index)
    .filter((entry) => !known.has(normalizeText(entry)));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function setFlash(message, tone = "info") {
  state.ui.flash = { message, tone };
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatDateTime(isoString) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(isoString));
}

function formatTime(isoString) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(isoString));
}

function formatShiftWindow(shift) {
  const start = normalizeTimeValue(shift?.startTime);
  const end = normalizeTimeValue(shift?.endTime);
  if (!start && !end) return "Ohne Uhrzeit";
  if (!start) return `bis ${end}`;
  if (!end) return `ab ${start}`;
  return `${start} - ${end}`;
}

function formatDuration(milliseconds) {
  if (!milliseconds || milliseconds < 0) return "0h 00m";

  const totalMinutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function buildRoleOptions(selectedRole) {
  const normalizedRole = selectedRole === "viewer" ? "member" : selectedRole;
  return ["member", "moderator", "planner", "admin"]
    .map(
      (role) => `
        <option value="${role}" ${role === normalizedRole ? "selected" : ""}>
          ${escapeHtml(ROLE_LABELS[role] || role)}
        </option>
      `
    )
    .join("");
}

async function handleSubmit(event) {
  const form = event.target;
  const formName = form.dataset.form;
  if (!formName) return;

  event.preventDefault();

  switch (formName) {
    case "login": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/login", {
            method: "POST",
            body: JSON.stringify({
              identifier: formData.get("identifier"),
              password: formData.get("password")
            })
          }),
        "Willkommen im Portal."
      );
      break;
    }

    case "register": {
      const formData = new FormData(form);
      const password = String(formData.get("password") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (password !== confirmPassword) {
        setFlash("Die Passwoerter stimmen nicht ueberein.", "danger");
        render();
        return;
      }

      const avatarUrl = await readImageFileInput(form.querySelector('input[name="avatarFile"]'));
      await performAction(
        () =>
          api("/api/register", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              bio: formData.get("bio"),
              avatarUrl: avatarUrl || "",
              password
            })
          }),
        "Zugang wurde erstellt."
      );
      break;
    }

    case "shift": {
      const formData = new FormData(form);
      const payload = {
        date: formData.get("date"),
        startTime: normalizeTimeValue(formData.get("startTime")),
        endTime: normalizeTimeValue(formData.get("endTime")),
        memberId: formData.get("memberId"),
        shiftType: String(formData.get("shiftType") || "").trim(),
        world: String(formData.get("world") || "").trim(),
        task: String(formData.get("task") || "").trim(),
        notes: String(formData.get("notes") || "").trim(),
        isLead: formData.get("isLead") === "on"
      };
      const catalogAdds = collectCatalogAddsForShift(payload, state.data.settings);
      if (catalogAdds.shiftTypes.length || catalogAdds.worlds.length || catalogAdds.tasks.length) {
        const lines = [
          "Diese Werte sind neu und noch nicht im Katalog:",
          ...catalogAdds.shiftTypes.map((entry) => `- Schichttyp: ${entry}`),
          ...catalogAdds.worlds.map((entry) => `- Welt: ${entry}`),
          ...catalogAdds.tasks.map((entry) => `- Aufgabe: ${entry}`),
          "",
          "Sollen diese Werte zusaetzlich in die Listen aufgenommen werden?"
        ];
        if (window.confirm(lines.join("\n"))) payload.catalogAdds = catalogAdds;
      }

      const shiftId = state.ui.editingShiftId;
      await performAction(
        () =>
          api(shiftId ? `/api/shifts/${encodeURIComponent(shiftId)}` : "/api/shifts", {
            method: shiftId ? "PATCH" : "POST",
            body: JSON.stringify(payload)
          }),
        shiftId ? "Schicht wurde aktualisiert." : "Neue Schicht wurde gespeichert."
      );
      rememberPlannerDraft(payload, { advanceDate: !shiftId });
      state.ui.editingShiftId = "";
      render();
      break;
    }

    case "shift-bulk": {
      const formData = new FormData(form);
      const entries = buildBulkShiftEntries(formData);
      const catalogAdds = collectCatalogAddsForShift(entries[0], state.data.settings);
      if (catalogAdds.shiftTypes.length || catalogAdds.worlds.length || catalogAdds.tasks.length) {
        const lines = [
          "Diese Werte sind neu und noch nicht im Katalog:",
          ...catalogAdds.shiftTypes.map((entry) => `- Schichttyp: ${entry}`),
          ...catalogAdds.worlds.map((entry) => `- Welt: ${entry}`),
          ...catalogAdds.tasks.map((entry) => `- Aufgabe: ${entry}`),
          "",
          "Sollen diese Werte zusaetzlich in die Listen aufgenommen werden?"
        ];
        if (window.confirm(lines.join("\n"))) {
          for (const entry of entries) {
            entry.catalogAdds = catalogAdds;
          }
        }
      }

      await performAction(async () => {
        let lastPayload = null;
        for (const entry of entries) {
          lastPayload = await api("/api/shifts", {
            method: "POST",
            body: JSON.stringify(entry)
          });
        }
        return lastPayload;
      }, `${entries.length} Schichten wurden gesammelt angelegt.`);
      rememberPlannerDraft(
        {
          ...entries[0],
          date: getNextPlannerDateKey(entries[entries.length - 1].date)
        },
        { advanceDate: false }
      );
      state.ui.editingShiftId = "";
      render();
      break;
    }

    case "request": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/requests", {
            method: "POST",
            body: JSON.stringify({
              type: formData.get("type"),
              date: formData.get("date"),
              content: formData.get("content"),
              rating: formData.get("rating")
            })
          }),
        "Deine Rueckmeldung wurde gespeichert."
      );
      break;
    }

    case "request-admin": {
      const formData = new FormData(form);
      const requestId = form.dataset.requestId;
      await performAction(
        () =>
          api(`/api/requests/${encodeURIComponent(requestId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: formData.get("status"),
              adminNote: formData.get("adminNote")
            })
          }),
        "Rueckmeldung fuer das Teammitglied gespeichert."
      );
      break;
    }

    case "announcement": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/announcements", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              body: formData.get("body"),
              pinned: formData.get("pinned") === "on",
              imageUrl: formData.get("imageUrl")
            })
          }),
        "Neue Info wurde veroeffentlicht."
      );
      break;
    }

    case "event-create": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/events", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              scheduleType: formData.get("scheduleType"),
              eventDate: formData.get("eventDate"),
              eventTime: formData.get("eventTime"),
              weekday: formData.get("weekday"),
              world: formData.get("world"),
              host: formData.get("host"),
              summary: formData.get("summary"),
              reminderEnabled: formData.get("reminderEnabled") === "on"
            })
          }),
        "Event wurde gespeichert."
      );
      break;
    }

    case "event-delete": {
      const eventId = form.dataset.eventId;
      if (!window.confirm("Dieses Event wirklich entfernen?")) return;
      await performAction(
        () =>
          api(`/api/events/${encodeURIComponent(eventId)}`, {
            method: "DELETE"
          }),
        "Event wurde entfernt.",
        "warning"
      );
      break;
    }

    case "catalog": {
      const formData = new FormData(form);
      const key = form.dataset.key;
      await performAction(
        () =>
          api(`/api/settings/${encodeURIComponent(key)}`, {
            method: "POST",
            body: JSON.stringify({ value: formData.get("value") })
          }),
        "Listenwert hinzugefuegt."
      );
      break;
    }

    case "chat": {
      const formData = new FormData(form);
      const channel = String(formData.get("channel") || "");
      await performAction(
        () =>
          api("/api/chat", {
            method: "POST",
            body: JSON.stringify({
              channel,
              relatedShiftId: formData.get("relatedShiftId"),
              content: formData.get("content")
            })
          }),
        channel === "staff" ? "Nachricht im Staff-Chat gepostet." : "Nachricht im allgemeinen Chat gepostet."
      );
      break;
    }

    case "direct-message": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/direct-messages", {
            method: "POST",
            body: JSON.stringify({
              recipientId: form.dataset.recipientId || formData.get("recipientId"),
              content: formData.get("content")
            })
          }),
        "Direktnachricht wurde gesendet."
      );
      break;
    }

    case "forum-thread": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/forum-threads", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              category: formData.get("category"),
              body: formData.get("content")
            })
          }),
        "Thread wurde erstellt."
      );
      break;
    }

    case "forum-reply": {
      const formData = new FormData(form);
      const threadId = form.dataset.threadId;
      await performAction(
        () =>
          api(`/api/forum-threads/${encodeURIComponent(threadId)}/replies`, {
            method: "POST",
            body: JSON.stringify({
              body: formData.get("content")
            })
          }),
        "Antwort wurde gespeichert."
      );
      break;
    }

    case "warning-create": {
      const formData = new FormData(form);
      const userId = form.dataset.userId;
      await performAction(
        () =>
          api("/api/warnings", {
            method: "POST",
            body: JSON.stringify({
              userId,
              reason: formData.get("reason")
            })
          }),
        "Verwarnung wurde gesendet."
      );
      break;
    }

    case "warning-ack": {
      const warningId = form.dataset.warningId;
      await performAction(
        () =>
          api(`/api/warnings/${encodeURIComponent(warningId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "acknowledge" })
          }),
        "Verwarnung wurde bestaetigt.",
        "warning"
      );
      break;
    }

    case "warning-clear": {
      const warningId = form.dataset.warningId;
      await performAction(
        () =>
          api(`/api/warnings/${encodeURIComponent(warningId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "clear" })
          }),
        "Verwarnung wurde abgeschlossen."
      );
      break;
    }

    case "swap-decision": {
      const formData = new FormData(form);
      const swapRequestId = form.dataset.swapRequestId;
      const status = String(event.submitter?.value || "");
      await performAction(
        () =>
          api(`/api/swap-requests/${encodeURIComponent(swapRequestId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status,
              candidateId: formData.get("candidateId")
            })
          }),
        status === "genehmigt" ? "Tauschwunsch wurde genehmigt und die Schicht neu zugewiesen." : "Tauschwunsch wurde abgelehnt."
      );
      break;
    }

    case "admin-user-create": {
      const { formData, payload } = await buildProfilePayload(form);
      await performAction(
        () =>
          api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              avatarUrl: payload.avatarUrl || "",
              bio: payload.bio,
              contactNote: payload.contactNote,
              weeklyHoursCapacity: payload.weeklyHoursCapacity,
              weeklyDaysCapacity: payload.weeklyDaysCapacity,
              availabilitySchedule: payload.availabilitySchedule,
              creatorBlurb: payload.creatorBlurb,
              creatorLinks: payload.creatorLinks,
              creatorVisible: payload.creatorVisible,
              password: formData.get("password"),
              role: formData.get("role")
            })
          }),
        "Account wurde angelegt."
      );
      break;
    }

    case "user-update": {
      const userId = form.dataset.userId;
      const { formData, payload } = await buildProfilePayload(form);
      payload.role = formData.get("role");
      payload.password = formData.get("password");
      await performAction(
        () =>
          api(`/api/admin/users/${encodeURIComponent(userId)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Account wurde aktualisiert."
      );
      break;
    }

    case "profile-update": {
      const { formData, payload } = await buildProfilePayload(form);
      payload.password = formData.get("password");
      await performAction(
        () =>
          api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Profil wurde aktualisiert."
      );
      break;
    }

    default:
      break;
  }
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T12:00:00`);
  const to = new Date(`${toDate}T12:00:00`);
  return Math.floor((to - from) / 86400000);
}

function normalizeTimeValue(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return "";
  const [hours, minutes] = normalized.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function compareTimeValues(left, right) {
  return timeToMinutes(left) - timeToMinutes(right);
}

function timeToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return Number.MAX_SAFE_INTEGER;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function canAccessStaffArea() {
  return ["moderator", "planner", "admin"].includes(state.session?.role);
}

function normalizeActiveTab(tab) {
  const allowed = canManagePortal()
    ? ["overview", "community", "events", "news", "feedback", "planning", "team", "chat", "time", "profile", "settings"]
    : canAccessStaffArea()
      ? ["overview", "community", "events", "news", "schedule", "feedback", "chat", "time", "profile"]
      : ["overview", "community", "events", "news", "feedback", "chat", "profile"];

  return allowed.includes(tab) ? tab : "overview";
}

function getCommunityData() {
  return (
    state.data?.community ||
    state.publicData?.community || {
      team: [],
      events: [],
      rules: [],
      faq: [],
      stats: {}
    }
  );
}

function getAnnouncementFeed() {
  return state.data?.announcements || state.publicData?.announcements || [];
}

function getChatFeed(mode = "community") {
  if (mode === "staff") {
    return state.data?.staffChatMessages || state.data?.chatMessages || [];
  }
  return state.data?.communityChatMessages || [];
}

function renderStatsStrip() {
  if (canManagePortal()) {
    const memberCount = (state.data?.users || []).filter((entry) => entry.role === "member").length;
    const moderatorCount = (state.data?.users || []).filter((entry) => entry.role === "moderator").length;
    const liveEntries = (state.data?.timeEntries || []).filter((entry) => !entry.checkOutAt).length;
    const openRequests = (state.data?.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
    const nextWeekShifts = getSortedShifts(state.data?.shifts || []).filter((entry) => daysBetween(getLocalDateKey(), entry.date) <= 7);

    return `
      <section class="stats-strip">
        ${renderStatCard("Mitglieder", memberCount, "Registrierte Community-Accounts", "teal")}
        ${renderStatCard("Moderatoren", moderatorCount, "Aktive Staff-Mitglieder", "amber")}
        ${renderStatCard("Schichten", nextWeekShifts.length, "Einsaetze in den naechsten 7 Tagen", "amber")}
        ${renderStatCard("Offenes Feedback", openRequests, "Rueckmeldungen warten auf Sichtung", "rose")}
        ${renderStatCard("Eingestempelt", liveEntries, "Aktuell aktive Moderatoren", "sky")}
      </section>
    `;
  }

  if (canAccessStaffArea()) {
    const myShifts = getSortedShifts(state.data?.shifts || []);
    const nextShift = myShifts.find((entry) => entry.date >= getLocalDateKey());
    const openRequests = (state.data?.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
    const activeEntry = getOpenEntryForViewer();
    const totalHours = (state.data?.timeEntries || [])
      .filter((entry) => entry.checkOutAt)
      .reduce((total, entry) => total + Math.max(0, new Date(entry.checkOutAt) - new Date(entry.checkInAt)), 0);

    return `
      <section class="stats-strip">
        ${renderStatCard("Naechste Schicht", nextShift ? `${formatDate(nextShift.date)} | ${formatShiftWindow(nextShift)}` : "-", nextShift ? `${nextShift.shiftType} | ${nextShift.world}` : "Noch nichts geplant", "teal")}
        ${renderStatCard("Meine Einsaetze", myShifts.length, "Aktuell in deinem Plan", "amber")}
        ${renderStatCard("Offene Notizen", openRequests, "Rueckmeldungen mit offenem Status", "rose")}
        ${renderStatCard("Erfasste Zeit", formatDuration(totalHours), activeEntry ? "Gerade aktiv eingestempelt" : "Gesamt aus abgeschlossenen Schichten", "sky")}
      </section>
    `;
  }

  const community = getCommunityData();
  const stats = community.stats || {};
  const openRequests = (state.data?.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;

  return `
    <section class="stats-strip">
      ${renderStatCard("Community News", getAnnouncementFeed().length, "Aktuelle sichtbare Updates", "teal")}
      ${renderStatCard("Events", (community.events || []).length, "Geplante Community-Termine", "amber")}
      ${renderStatCard("Feedback", openRequests, "Deine offenen Rueckmeldungen", "rose")}
      ${renderStatCard("Staff", (stats.moderators || 0) + (stats.planners || 0), "Moderation und Leitung im Portal", "sky")}
    </section>
  `;
}

function renderPublicCommunityOverview() {
  const community = getCommunityData();
  const stats = community.stats || {};
  const latestNews = getAnnouncementFeed().slice(0, 2);

  return `
    <section class="panel span-7">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community Hub</p>
          <h2>Was SONARA gerade ausmacht</h2>
          <p class="section-copy">Mitgliederzahlen, sichtbare News und der aktuelle Eindruck der Community liegen hier kompakt zusammen.</p>
        </div>
      </div>

      <div class="community-overview-grid">
        <div class="community-stat-grid">
          ${renderStatCard("Mitglieder", stats.members || 0, "Registrierte Community-Accounts", "teal")}
          ${renderStatCard("Staff", (stats.moderators || 0) + (stats.planners || 0), "Moderation und Leitung", "amber")}
          ${renderStatCard("News", getAnnouncementFeed().length, "Aktuelle sichtbare Hinweise", "rose")}
          ${renderStatCard("Events", (community.events || []).length, "Kommende Community-Termine", "sky")}
        </div>
        <div class="community-side-stack">
          ${
            latestNews.length
              ? latestNews.map((entry) => renderAnnouncementCard(entry, false)).join("")
              : renderEmptyState("Noch keine News", "Sobald es sichtbare Community-Updates gibt, erscheinen sie hier.")
          }
        </div>
      </div>
    </section>
  `;
}

function renderPublicEventsPanel() {
  const events = (getCommunityData().events || []).slice(0, 3);

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Events</p>
          <h2>Was als Naechstes ansteht</h2>
          <p class="section-copy">Kommende Termine, Welten und Hosts sind sofort sichtbar, ohne Discord durchsuchen zu muessen.</p>
        </div>
      </div>

      <div class="event-grid">
        ${
          events.length
            ? events.map((event) => renderEventCard(event)).join("")
            : renderEmptyState("Noch keine Events", "Sobald neue Termine geplant werden, tauchen sie hier auf.")
        }
      </div>
    </section>
  `;
}

function renderPublicRulesPanel() {
  const community = getCommunityData();

  return `
    <section class="panel span-6">
      <div class="section-head">
        <div>
          <p class="eyebrow">Regeln und FAQ</p>
          <h2>Wie SONARA aufgebaut ist</h2>
          <p class="section-copy">Neue Leute sehen direkt, wie die Community funktioniert und wo sie Antworten finden.</p>
        </div>
      </div>

      <div class="rule-list">
        ${(community.rules || []).map((entry) => renderRuleCard(entry)).join("")}
      </div>

      <div class="faq-list">
        ${(community.faq || []).map((entry) => renderFaqCard(entry)).join("")}
      </div>
    </section>
  `;
}

function renderPublicTeamPanel() {
  const team = (getCommunityData().team || []).slice(0, 4);

  return `
    <section class="panel span-6">
      <div class="section-head">
        <div>
          <p class="eyebrow">Team</p>
          <h2>Wer sich um SONARA kuemmert</h2>
          <p class="section-copy">Moderation, Leitung und wichtige Ansprechpartner werden offen und greifbar dargestellt.</p>
        </div>
      </div>

      <div class="team-grid">
        ${
          team.length
            ? team.map((user) => renderTeamSpotlightCard(user)).join("")
            : renderEmptyState("Noch kein Team sichtbar", "Sobald Staff-Mitglieder gepflegt sind, erscheinen sie hier.")
        }
      </div>
    </section>
  `;
}

function renderCommunityOverviewPanel() {
  const community = getCommunityData();
  const stats = community.stats || {};
  const latestNews = getAnnouncementFeed().slice(0, 3);

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community Ueberblick</p>
          <h2>Die wichtigsten Community-Daten auf einen Blick</h2>
          <p class="section-copy">Hier laufen Stimmung, News und sichtbare Kerninfos zusammen, ohne den Staff-Bereich zu vermischen.</p>
        </div>
      </div>

      <div class="community-overview-grid">
        <div class="community-stat-grid">
          ${renderStatCard("Mitglieder", stats.members || 0, "Registrierte Community-Accounts", "teal")}
          ${renderStatCard("Moderatoren", stats.moderators || 0, "Aktive Moderation", "amber")}
          ${renderStatCard("Leitung", stats.planners || 0, "Planung und Admin", "rose")}
          ${renderStatCard("Events", (community.events || []).length, "Kommende Termine", "sky")}
        </div>
        <div class="community-side-stack">
          ${
            latestNews.length
              ? latestNews.map((entry) => renderAnnouncementCard(entry, false)).join("")
              : renderEmptyState("Noch keine News", "Sobald es Ankuendigungen gibt, erscheinen sie hier.")
          }
        </div>
      </div>
    </section>
  `;
}

function renderCommunityRulesPanel() {
  const community = getCommunityData();

  return `
    <section class="panel span-7">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community Leitlinien</p>
          <h2>Regeln, Haltung und Antworten</h2>
          <p class="section-copy">So bleibt die Community fuer Mitglieder klar, freundlich und leicht verstaendlich.</p>
        </div>
      </div>

      <div class="rule-list">
        ${(community.rules || []).map((entry) => renderRuleCard(entry)).join("")}
      </div>

      <div class="faq-list">
        ${(community.faq || []).map((entry) => renderFaqCard(entry)).join("")}
      </div>
    </section>
  `;
}

function renderCommunityTeamPanel() {
  const team = getCommunityData().team || [];

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Staff-Vorstellung</p>
          <h2>Moderation und Leitung</h2>
          <p class="section-copy">Die Community sieht hier, wer fuer Moderation, Events und Organisation zustaendig ist.</p>
        </div>
      </div>

      <div class="team-grid">
        ${
          team.length
            ? team.map((user) => renderTeamSpotlightCard(user)).join("")
            : renderEmptyState("Noch keine Profile", "Sobald Staff-Profile gepflegt sind, erscheinen sie hier.")
        }
      </div>
    </section>
  `;
}

function renderEventsPanel() {
  const events = getCommunityData().events || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Eventplan</p>
          <h2>Kommende SONARA-Events</h2>
          <p class="section-copy">Welten, Hosts und Zeiten bleiben fuer Mitglieder und Staff an einem Ort sichtbar.</p>
        </div>
      </div>

      <div class="event-grid">
        ${
          events.length
            ? events.map((event) => renderEventCard(event)).join("")
            : renderEmptyState("Noch keine Events", "Sobald neue Termine feststehen, erscheinen sie hier.")
        }
      </div>
    </section>
  `;
}

function renderEventCard(event) {
  return `
    <article class="mini-card event-card">
      <div class="status-row">
        <span class="pill amber">Event</span>
        <span class="timeline-meta">${escapeHtml(event.dateLabel || "-")}</span>
      </div>
      <div>
        <h3>${escapeHtml(event.title)}</h3>
        <p class="timeline-meta">${escapeHtml(event.world)} | Host: ${escapeHtml(event.host)}</p>
      </div>
      <p>${escapeHtml(event.summary)}</p>
    </article>
  `;
}

function renderRuleCard(entry) {
  return `
    <article class="mini-card community-rule-card">
      <h3>${escapeHtml(entry.title)}</h3>
      <p>${escapeHtml(entry.body)}</p>
    </article>
  `;
}

function renderFaqCard(entry) {
  return `
    <article class="mini-card community-faq-card">
      <h3>${escapeHtml(entry.question)}</h3>
      <p>${escapeHtml(entry.answer)}</p>
    </article>
  `;
}

function renderTeamSpotlightCard(user) {
  return `
    <article class="mini-card team-card">
      <div class="profile-head">
        ${renderUserAvatar(user, "list-avatar")}
        <div class="roster-identity">
          <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
          <p class="timeline-meta">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
        </div>
      </div>
      <p class="helper-text">Discord: ${escapeHtml(user.discordName || "-")}</p>
      <p>${escapeHtml(user.bio || "Noch kein Kurzprofil vorhanden.")}</p>
    </article>
  `;
}

function renderNewsSpotlightPanel() {
  const featured = getAnnouncementFeed().slice(0, 2);

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">SONARA News</p>
          <h2>Was gerade in der Community wichtig ist</h2>
          <p class="section-copy">News, Highlights und wichtige Hinweise werden hier direkt im Dashboard sichtbar.</p>
        </div>
      </div>
      <div class="card-list guide-grid">
        ${
          featured.length
            ? featured.map((entry) => renderAnnouncementCard(entry, false)).join("")
            : renderEmptyState("Noch keine News", "Sobald etwas fuer die Community wichtig ist, taucht es hier auf.")
        }
      </div>
    </section>
  `;
}

function renderNotificationsPanel() {
  const notifications = state.data?.notifications || [];
  const browserSupport = typeof window !== "undefined" && "Notification" in window;
  const manager = canManagePortal();
  const staff = canAccessStaffArea();
  const title = manager
    ? "Automatische Hinweise fuer Leitung und Planung"
    : staff
      ? "Automatische Hinweise fuer Schichten und Staff-News"
      : "Das Wichtigste aus Community, News und Events";
  const copy = manager
    ? "Offene Rueckmeldungen, heutige Einsaetze und laufende Schichten werden hier automatisch zusammengefasst."
    : staff
      ? "Heute, morgen und bald anstehende Einsaetze erscheinen hier zusammen mit angehefteten Staff-Infos."
      : "Angeheftete News und kommende Events werden hier automatisch fuer dich gesammelt.";
  const emptyBody = manager
    ? "Sobald neue Rueckmeldungen oder Einsaetze anstehen, erscheinen sie hier."
    : staff
      ? "Sobald neue Staff-Hinweise oder Schichten anstehen, erscheinen sie hier."
      : "Sobald es neue News oder Events gibt, erscheinen sie hier.";

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Benachrichtigungen</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="section-copy">${escapeHtml(copy)}</p>
        </div>
        ${
          browserSupport
            ? `
              <button
                type="button"
                class="ghost small"
                data-action="enable-browser-notifications"
                ${state.ui.notificationPermission === "granted" ? "disabled" : ""}
              >
                ${
                  state.ui.notificationPermission === "granted"
                    ? "Browser-Popups aktiv"
                    : "Browser-Popups aktivieren"
                }
              </button>
            `
            : '<span class="pill neutral">Browser-Popups nicht verfuegbar</span>'
        }
      </div>

      <div class="card-list notification-list">
        ${
          notifications.length
            ? notifications.map((entry) => renderNotificationCard(entry)).join("")
            : renderEmptyState("Keine neuen Hinweise", emptyBody)
        }
      </div>
    </section>
  `;
}

function renderAnnouncementsPanel(managerView) {
  const items = getAnnouncementFeed();

  return `
    <section class="panel ${managerView ? "span-4" : "span-7"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community News</p>
          <h2>News, Hinweise und Highlights aus SONARA</h2>
          <p class="section-copy">Wichtige News, Event-Hinweise, neue Welten und sichtbare Community-Updates erscheinen hier gesammelt.</p>
        </div>
      </div>

      ${
        managerView
          ? `
            <form class="stack-form" data-form="announcement">
              <div class="field">
                <label for="announcementTitle">Titel</label>
                <input id="announcementTitle" name="title" type="text" required>
              </div>
              <div class="field">
                <label for="announcementBody">Nachricht</label>
                <textarea id="announcementBody" name="body" required></textarea>
              </div>
              <div class="field">
                <label for="announcementImageUrl">Bild-URL</label>
                <input id="announcementImageUrl" name="imageUrl" type="url" placeholder="https://...">
              </div>
              <label class="label-row">
                <input name="pinned" type="checkbox">
                <span>Oben anheften</span>
              </label>
              <button type="submit">News veroeffentlichen</button>
            </form>
          `
          : ""
      }

      <div class="stack-list ${managerView ? "" : "chat-list"}">
        ${
          items.length
            ? items.map((item) => renderAnnouncementCard(item, managerView)).join("")
            : renderEmptyState("Noch keine Infos", "Neue Community-News erscheinen hier, sobald etwas wichtig wird.")
        }
      </div>
    </section>
  `;
}

function renderChatPanel(mode = "community", compact = false) {
  const staffMode = mode === "staff";
  const availableShifts = staffMode ? getSortedShifts(state.data?.shifts || []) : [];
  const messages = getChatFeed(mode);
  const sectionSpan = compact ? "span-5" : staffMode ? "span-8" : "span-12";
  const eyebrow = staffMode ? "Staff-Chat" : "Community-Chat";
  const title = staffMode ? "Echtzeit-Chat fuer schnelle Staff-Absprachen" : "Echtzeit-Chat fuer die Community";
  const copy = staffMode
    ? "Neue Nachrichten erscheinen automatisch, ohne dass jemand neu laden muss."
    : "Mitglieder koennen sich hier direkt im Portal austauschen, ohne auf Discord wechseln zu muessen.";
  const placeholder = staffMode
    ? "z. B. Wer kann die Schicht heute spaeter uebernehmen?"
    : "z. B. Wer ist heute Abend beim Event dabei?";
  const emptyTitle = staffMode ? "Noch kein Staff-Chat" : "Noch kein Community-Chat";
  const emptyText = staffMode
    ? "Die erste Nachricht erscheint sofort fuer alle Staff-Mitglieder online."
    : "Die erste Nachricht erscheint sofort fuer alle Mitglieder online.";

  return `
    <section class="panel ${sectionSpan}">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="section-copy">${escapeHtml(copy)}</p>
        </div>
        <span class="pill ${state.ui.liveChatConnected ? "success" : "amber"}">${state.ui.liveChatConnected ? "Live verbunden" : "Verbindung wird aufgebaut"}</span>
      </div>

      <form class="stack-form" data-form="chat">
        <div class="form-grid">
          ${
            staffMode
              ? `
                <div class="field">
                  <label for="chatShift">Bezug zu einer Schicht</label>
                  <select id="chatShift" name="relatedShiftId">
                    <option value="">Keine konkrete Schicht</option>
                    ${availableShifts.map((shift) => renderShiftSelectOption(shift)).join("")}
                  </select>
                </div>
              `
              : ""
          }
          <div class="field ${staffMode ? "" : "span-all"}">
            <label for="chatMessage">${staffMode ? "Nachricht" : "Beitrag"}</label>
            <textarea id="chatMessage" name="content" placeholder="${escapeHtml(placeholder)}" required></textarea>
          </div>
        </div>

        <button type="submit">${staffMode ? "Im Staff-Chat posten" : "In Community posten"}</button>
      </form>

      <div class="stack-list chat-list">
        ${
          messages.length
            ? messages.map((message) => renderChatMessage(message)).join("")
            : renderEmptyState(emptyTitle, emptyText)
        }
      </div>
    </section>
  `;
}

function renderChatMessage(message) {
  const shiftText = message.relatedShift
    ? `${formatDate(message.relatedShift.date)} | ${formatShiftWindow(message.relatedShift)} | ${message.relatedShift.shiftType} | ${message.relatedShift.world}`
    : "";
  const channelTone = message.channel === "staff" ? "amber" : "sky";
  const channelLabel = message.channel === "staff" ? "Staff" : "Community";

  return `
    <article class="chat-card">
      <div class="chat-meta">
        <div>
          <h3>${escapeHtml(message.authorName)}</h3>
          <p class="timeline-meta">${escapeHtml(formatDateTime(message.createdAt))}</p>
        </div>
        <div class="status-row">
          <span class="pill ${channelTone}">${escapeHtml(channelLabel)}</span>
          ${shiftText ? `<span class="pill neutral">${escapeHtml(shiftText)}</span>` : ""}
        </div>
      </div>
      <p>${escapeHtml(message.content)}</p>
    </article>
  `;
}

function getAssignableUsers() {
  return (state.data?.users || [])
    .filter((entry) => entry.role !== "member")
    .slice()
    .sort((left, right) => getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de"));
}

function buildRoleOptions(selectedRole) {
  const normalizedRole = selectedRole === "viewer" ? "member" : selectedRole;
  return ["member", "moderator", "planner", "admin"]
    .map(
      (role) => `
        <option value="${role}" ${role === normalizedRole ? "selected" : ""}>
          ${escapeHtml(ROLE_LABELS[role])}
        </option>
      `
    )
    .join("");
}

function renderShiftSelectOption(shift) {
  const label = `${formatDate(shift.date)} | ${formatShiftWindow(shift)} | ${shift.shiftType} | ${shift.world}${shift.memberName ? ` | ${shift.memberName}` : ""}`;
  return `<option value="${escapeHtml(shift.id)}">${escapeHtml(label)}</option>`;
}

function renderPublicPortal() {
  const community = getCommunityData();
  const stats = community.stats || {};
  const creators = (community.creators || []).slice(0, 3);

  return `
    <div class="app-shell">
      ${renderSonaraHero({
        eyebrow: "SONARA Community Portal",
        title: "Community, Team und Creator an einem Ort",
        intro: "News, Events, Creator-Links und der Mitgliederbereich liegen hier kompakt zusammen.",
        chips: [`${stats.members || 0} Mitglieder`, `${stats.creators || 0} Creator`, `${(community.events || []).length} Events`]
      })}

      ${renderFlash()}

      <div class="auth-layout public-grid">
        <section class="panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Portal</p>
              <h2>Das Wichtigste zuerst</h2>
            </div>
          </div>
          <div class="feature-grid">
            <article class="feature-card">
              <h3>News</h3>
              <p>Aktuelle Hinweise und Event-Infos.</p>
            </article>
            <article class="feature-card">
              <h3>Community</h3>
              <p>Regeln, Team, Creator und Kontaktwege.</p>
            </article>
            <article class="feature-card">
              <h3>Mitgliederbereich</h3>
              <p>Profil, Forum, Direktnachrichten und Chat.</p>
            </article>
            <article class="feature-card">
              <h3>Staff</h3>
              <p>Schichten, Zeiten und interne Abstimmung.</p>
            </article>
          </div>

          ${
            creators.length
              ? `
                <div class="stack-list compact-stack">
                  <h3>Creator im Fokus</h3>
                  <div class="team-grid">
                    ${creators.map((entry) => renderCreatorCard(entry)).join("")}
                  </div>
                </div>
              `
              : ""
          }
        </section>

        <div class="auth-stack public-auth-stack">
          <form class="panel auth-card" data-form="login">
            <div>
              <p class="eyebrow">Login</p>
              <h3>Einloggen</h3>
            </div>
            <div class="auth-fieldset">
              <div class="field">
                <label for="loginIdentifier">VRChat-Name oder Discord-Name</label>
                <input id="loginIdentifier" name="identifier" type="text" autocomplete="username" required>
              </div>
              <div class="field">
                <label for="loginPassword">Passwort</label>
                <input id="loginPassword" name="password" type="password" autocomplete="current-password" required>
              </div>
            </div>
            <button type="submit">Einloggen</button>
          </form>

          <form class="panel auth-card" data-form="register">
            <div>
              <p class="eyebrow">Registrierung</p>
              <h3>Konto anlegen</h3>
            </div>
            <div class="auth-fieldset">
              <div class="field">
                <label for="registerVrchatName">VRChat-Name</label>
                <input id="registerVrchatName" name="vrchatName" type="text" required>
              </div>
              <div class="field">
                <label for="registerDiscordName">Discord-Name</label>
                <input id="registerDiscordName" name="discordName" type="text" required>
              </div>
              <div class="field">
                <label for="registerAvatarFile">Profilbild</label>
                <input id="registerAvatarFile" name="avatarFile" type="file" accept="image/*">
              </div>
              <div class="field span-all">
                <label for="registerBio">Kurzprofil</label>
                <textarea id="registerBio" name="bio" placeholder="Kurz und knapp"></textarea>
              </div>
              <div class="field">
                <label for="registerPassword">Passwort</label>
                <input id="registerPassword" name="password" type="password" required>
              </div>
              <div class="field">
                <label for="registerConfirmPassword">Passwort bestaetigen</label>
                <input id="registerConfirmPassword" name="confirmPassword" type="password" required>
              </div>
            </div>
            <button type="submit">Zugang erstellen</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const user = state.session;
  const manager = canManagePortal();
  const staff = canAccessStaffArea();
  const activeTab = normalizeActiveTab(state.ui.activeTab);

  return `
    ${renderWarningOverlay()}
    <div class="app-shell">
      ${renderSonaraHero({
        eyebrow: manager ? "Leitung" : staff ? "Staff Portal" : "Mitgliederbereich",
        title: `Willkommen ${getPrimaryDisplayName(user)}`,
        intro: manager ? "Community, Team und Staff laufen hier zusammen." : staff ? "Schichten, Chat und Community kompakt an einem Ort." : "News, Forum, Creator und Community auf einen Blick.",
        chips: [ROLE_LABELS[user.role] || user.role, user.vrchatName || "", user.discordName || ""].filter(Boolean)
      })}
      <div class="dashboard-shell">
        ${renderFlash()}
        <section class="panel toolbar">
          <div class="toolbar-user">
            ${renderUserAvatar(user, "toolbar-avatar")}
            <div>
              <p class="eyebrow">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
              <h2>${escapeHtml(getPrimaryDisplayName(user))}</h2>
            </div>
          </div>
          <div class="toolbar-actions">
            ${canManageUsers() ? '<button type="button" class="ghost small" data-action="reset-demo">Demo wiederherstellen</button>' : ""}
            <button type="button" class="ghost small" data-action="logout">Abmelden</button>
          </div>
        </section>
        ${renderStatsStrip()}
        ${renderDashboardTabs(activeTab)}
        <div class="dashboard-grid focused-grid">
          ${manager ? renderManagerDashboard(activeTab) : staff ? renderModeratorDashboard(activeTab) : renderMemberDashboard(activeTab)}
        </div>
      </div>
    </div>
  `;
}

function renderDashboardTabs(activeTab) {
  const common = [
    { id: "overview", label: "Dashboard" },
    { id: "community", label: "Community" },
    { id: "events", label: "Events" },
    { id: "news", label: "News" },
    { id: "creators", label: "Creator" },
    { id: "forum", label: "Forum" },
    { id: "chat", label: "Chat" },
    { id: "profile", label: "Profil" }
  ];

  let tabs = common;
  if (canManagePortal()) {
    tabs = [...common, { id: "feedback", label: "Feedback" }, { id: "planning", label: "Planung" }, { id: "capacity", label: "Auslastung" }, { id: "team", label: "Team" }, { id: "time", label: "Zeiten" }, { id: "settings", label: "Einstellungen" }];
  } else if (canAccessStaffArea()) {
    tabs = [...common, { id: "schedule", label: "Meine Schichten" }, { id: "feedback", label: "Feedback" }, { id: "time", label: "Zeiten" }];
  } else {
    tabs = [...common, { id: "feedback", label: "Feedback" }];
  }

  return `
    <nav class="panel tab-bar" aria-label="Hauptbereiche">
      ${tabs
        .map(
          (tab) => `
            <button type="button" class="tab-chip ${tab.id === activeTab ? "active" : ""}" data-action="set-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderManagerDashboard(activeTab) {
  switch (activeTab) {
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(true);
    case "creators":
      return renderCreatorsPanel(true);
    case "forum":
      return renderForumPanel(true);
    case "feedback":
      return renderFeedbackAdminPanel();
    case "planning":
      return [renderPlannerPanel(), renderSwapPanel(true), renderRequestAdminPanel()].join("");
    case "capacity":
      return renderCapacityPanel();
    case "team":
      return [renderWarningAdminPanel(), renderTeamPanelV2()].join("");
    case "chat":
      return renderChatWorkspace("manager");
    case "time":
      return renderAttendancePanel(true);
    case "profile":
      return renderProfilePanel(true);
    case "settings":
      return [renderSettingsPanel(), renderDiscordPanel(), renderVrchatAnalyticsPanel()].join("");
    case "overview":
    default:
      return [renderNotificationsPanel(), renderWarningAdminPanel(), renderNewsSpotlightPanel(), renderCreatorsPanel(false), renderRequestAdminPanel()].join("");
  }
}

function renderModeratorDashboard(activeTab) {
  switch (activeTab) {
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(false);
    case "creators":
      return renderCreatorsPanel(false);
    case "forum":
      return renderForumPanel(false);
    case "schedule":
      return [renderMySchedulePanel(), renderSwapPanel(false)].join("");
    case "feedback":
      return renderFeedbackMemberPanel();
    case "chat":
      return renderChatWorkspace("staff");
    case "time":
      return renderAttendancePanel(false);
    case "profile":
      return renderProfilePanel(false);
    case "overview":
    default:
      return [renderNotificationsPanel(), renderNewsSpotlightPanel(), renderMySchedulePanel(), renderCreatorsPanel(false)].join("");
  }
}

function renderMemberDashboard(activeTab) {
  switch (activeTab) {
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(false);
    case "creators":
      return renderCreatorsPanel(false);
    case "forum":
      return renderForumPanel(false);
    case "feedback":
      return renderFeedbackMemberPanel();
    case "chat":
      return renderChatWorkspace("member");
    case "profile":
      return renderProfilePanel(false);
    case "overview":
    default:
      return [renderNotificationsPanel(), renderNewsSpotlightPanel(), renderCreatorsPanel(false), renderCommunityOverviewPanel()].join("");
  }
}

function normalizeActiveTab(tab) {
  const allowed = canManagePortal()
    ? ["overview", "community", "events", "news", "creators", "forum", "feedback", "planning", "team", "chat", "time", "profile", "settings"]
    : canAccessStaffArea()
      ? ["overview", "community", "events", "news", "creators", "forum", "schedule", "feedback", "chat", "time", "profile"]
      : ["overview", "community", "events", "news", "creators", "forum", "feedback", "chat", "profile"];

  return allowed.includes(tab) ? tab : "overview";
}

function getAvatarDraftStore() {
  if (!state.ui.avatarDrafts) state.ui.avatarDrafts = {};
  return state.ui.avatarDrafts;
}

function getAvatarDraftKey(source) {
  const form = source?.tagName === "FORM" ? source : source?.closest?.("form");
  if (!form) return "";
  return `${form.dataset.form || "form"}:${form.dataset.userId || ""}`;
}

function getAvatarDraftInfo(key) {
  return key ? getAvatarDraftStore()[key] || null : null;
}

function clearAvatarDraft(key) {
  if (!key || !state.ui.avatarDrafts) return;
  delete state.ui.avatarDrafts[key];
}

function renderAvatarDraftHint(draftKey, hasSavedAvatar) {
  const draft = getAvatarDraftInfo(draftKey);
  if (draft?.fileName) {
    return `<p class="helper-text file-hint">Ausgewaehlt: ${escapeHtml(draft.fileName)}</p>`;
  }
  if (hasSavedAvatar) {
    return '<p class="helper-text file-hint">Aktuelles Profilbild ist gespeichert.</p>';
  }
  return '<p class="helper-text file-hint">PNG, JPG, WebP oder GIF bis 1,8 MB.</p>';
}

async function captureAvatarDraft(fileInput) {
  const draftKey = getAvatarDraftKey(fileInput);
  if (!draftKey) return;

  const file = fileInput?.files?.[0];
  if (!file) {
    clearAvatarDraft(draftKey);
    render();
    return;
  }

  try {
    const dataUrl = await readImageFileInput(fileInput);
    getAvatarDraftStore()[draftKey] = {
      dataUrl,
      fileName: String(file.name || "Bild")
    };
    setFlash(`Bild ausgewaehlt: ${file.name}`, "info");
  } catch (error) {
    clearAvatarDraft(draftKey);
    fileInput.value = "";
    setFlash(error.message, "danger");
  }

  render();
}

async function performAction(callback, successMessage = "", successTone = "success") {
  let succeeded = false;

  try {
    const payload = await callback();
    if (payload?.session || payload?.data) applyPayload(payload);
    if (successMessage) setFlash(successMessage, successTone);
    if (state.session?.role === "admin" && !state.vrchatOverview) {
      void refreshVrchatOverview(false);
    }
    succeeded = true;
  } catch (error) {
    if (error.status === 401) {
      state.session = null;
      state.data = null;
      setFlash("Bitte erneut anmelden.", "warning");
    } else {
      setFlash(error.message, "danger");
    }
  }

  render();
  return succeeded;
}

async function buildProfilePayload(form) {
  const formData = new FormData(form);
  const draftKey = getAvatarDraftKey(form);
  const draft = getAvatarDraftInfo(draftKey);
  const payload = {
    vrchatName: formData.get("vrchatName"),
    discordName: formData.get("discordName"),
    bio: formData.get("bio"),
    contactNote: formData.get("contactNote"),
    weeklyHoursCapacity: formData.get("weeklyHoursCapacity"),
    weeklyDaysCapacity: formData.get("weeklyDaysCapacity"),
    availabilitySchedule: formData.get("availabilitySchedule"),
    creatorBlurb: formData.get("creatorBlurb"),
    creatorLinks: formData.get("creatorLinks"),
    creatorVisible: formData.get("creatorVisible") === "on"
  };

  if (draft?.dataUrl) {
    payload.avatarUrl = draft.dataUrl;
  } else {
    const avatarData = await readImageFileInput(form.querySelector('input[name="avatarFile"]'));
    if (avatarData) payload.avatarUrl = avatarData;
  }

  return { formData, payload, draftKey };
}

async function handleChange(event) {
  const fileInput = event.target.closest('input[type="file"][name="avatarFile"]');
  if (fileInput) {
    await captureAvatarDraft(fileInput);
    return;
  }

  const changeElement = event.target.closest("[data-change]");
  if (!changeElement) return;

  switch (changeElement.dataset.change) {
    case "shift-preset":
      applyShiftPreset(changeElement);
      break;

    default:
      break;
  }
}

function renderProfilePanel(managerView) {
  const user = state.session;
  const draftKey = "profile-update:";
  const showAvailabilityFields = user.role === "moderator";

  return `
    <section class="panel ${managerView ? "span-12" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Profil</p>
          <h2>Dein Community-Profil</h2>
        </div>
      </div>

      <div class="profile-panel">
        <div class="profile-preview">
          ${renderUserAvatar(user, "hero-avatar")}
          <div>
            <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
            <p class="timeline-meta">VRChat: ${escapeHtml(user.vrchatName || "-")} | Discord: ${escapeHtml(user.discordName || "-")}</p>
            ${user.bio ? `<p class="helper-text">${escapeHtml(user.bio)}</p>` : ""}
            ${user.contactNote ? `<p class="helper-text">${escapeHtml(user.contactNote)}</p>` : ""}
            ${showAvailabilityFields && (Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0)) ? `<p class="helper-text">Verfuegbar: ${escapeHtml(formatCapacityHours(user.weeklyHoursCapacity))} / ${escapeHtml(formatCapacityDays(user.weeklyDaysCapacity))}</p>` : ""}
            ${showAvailabilityFields && user.availabilitySchedule ? `<p class="helper-text"><strong>Diese Woche:</strong> ${escapeHtml(user.availabilitySchedule)}</p>` : ""}
            ${showAvailabilityFields && user.availabilityUpdatedAt ? `<p class="timeline-meta">Zuletzt aktualisiert: ${escapeHtml(formatDateTime(user.availabilityUpdatedAt))}</p>` : ""}
            ${renderCreatorLinkList(user, true)}
          </div>
        </div>

        <form class="stack-form" data-form="profile-update">
          <div class="form-grid">
            <div class="field">
              <label for="profileVrchatName">VRChat-Name</label>
              <input id="profileVrchatName" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}" required>
            </div>
            <div class="field">
              <label for="profileDiscordName">Discord-Name</label>
              <input id="profileDiscordName" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}" required>
            </div>
            <div class="field">
              <label for="profileAvatarFile">Profilbild</label>
              <input id="profileAvatarFile" name="avatarFile" type="file" accept="image/*">
              ${renderAvatarDraftHint(draftKey, Boolean(user.avatarUrl))}
            </div>
            <div class="field">
              <label for="profilePassword">Neues Passwort</label>
              <input id="profilePassword" name="password" type="password" placeholder="Leer lassen = behalten">
            </div>
            <div class="field span-all">
              <label for="profileBio">Kurzprofil</label>
              <textarea id="profileBio" name="bio">${escapeHtml(user.bio || "")}</textarea>
            </div>
            <div class="field span-all">
              <label for="profileContactNote">Kontakt / Hinweise</label>
              <textarea id="profileContactNote" name="contactNote" placeholder="Discord-Server, kurze Erreichbarkeit oder Info">${escapeHtml(user.contactNote || "")}</textarea>
            </div>
            ${
              showAvailabilityFields
                ? `
                  <div class="field">
                    <label for="profileWeeklyHoursCapacity">Verfuegbare Stunden pro Woche</label>
                    <input id="profileWeeklyHoursCapacity" name="weeklyHoursCapacity" type="number" min="0" max="168" step="0.5" value="${escapeHtml(String(user.weeklyHoursCapacity || ""))}" placeholder="z. B. 12">
                  </div>
                  <div class="field">
                    <label for="profileWeeklyDaysCapacity">Verfuegbare Tage pro Woche</label>
                    <input id="profileWeeklyDaysCapacity" name="weeklyDaysCapacity" type="number" min="0" max="7" step="1" value="${escapeHtml(String(user.weeklyDaysCapacity || ""))}" placeholder="z. B. 3">
                  </div>
                  <div class="field span-all">
                    <label for="profileAvailabilitySchedule">Zeitfenster fuer diese Woche</label>
                    <textarea id="profileAvailabilitySchedule" name="availabilitySchedule" placeholder="Mo 18:00-22:00, Di frei, Mi 20:00-00:00">${escapeHtml(user.availabilitySchedule || "")}</textarea>
                    <p class="helper-text">Bitte bis Samstag deine Verfuegbarkeit fuer die naechste Woche eintragen. Ohne Rueckmeldung keine Einplanung; wiederholt fehlend kann zu Verwarnungen fuehren.</p>
                  </div>
                `
                : ""
            }
            <div class="field">
              <label for="profileCreatorBlurb">Creator-Text</label>
              <input id="profileCreatorBlurb" name="creatorBlurb" type="text" value="${escapeHtml(user.creatorBlurb || "")}" placeholder="z. B. Musik, Clips, Streams">
            </div>
            <div class="field">
              <label for="profileCreatorVisible">Im Creator-Bereich zeigen</label>
              <input id="profileCreatorVisible" name="creatorVisible" type="checkbox" ${user.creatorVisible ? "checked" : ""}>
            </div>
            <div class="field span-all">
              <label for="profileCreatorLinks">Creator-Links</label>
              <textarea id="profileCreatorLinks" name="creatorLinks" placeholder="Discord | https://...&#10;TikTok | https://...&#10;Spotify | https://...">${escapeHtml(renderCreatorLinksText(user))}</textarea>
            </div>
          </div>
          <button type="submit">Profil speichern</button>
        </form>
      </div>
    </section>
  `;
}

function getCommunityDirectory() {
  const directory = state.data?.directory || state.data?.users || [];
  return Array.isArray(directory) ? directory : [];
}

function getCreatorEntries() {
  const baseCommunity = state.data?.community || state.publicData?.community || {};
  const directCreators = Array.isArray(baseCommunity.creators) ? baseCommunity.creators : [];
  if (directCreators.length) {
    return directCreators
      .slice()
      .sort((left, right) => getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de"));
  }

  return getCommunityDirectory()
    .filter((entry) => entry.creatorVisible && (((entry.creatorLinks || []).length > 0) || entry.creatorBlurb))
    .slice()
    .sort((left, right) => getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de"));
}

function getCommunityData() {
  const community = state.data?.community || state.publicData?.community || {};
  const creators = getCreatorEntries();

  return {
    team: Array.isArray(community.team) ? community.team : [],
    creators,
    events: Array.isArray(community.events) ? community.events : [],
    rules: Array.isArray(community.rules) ? community.rules : [],
    faq: Array.isArray(community.faq) ? community.faq : [],
    stats: {
      ...(community.stats || {}),
      creators: creators.length
    }
  };
}

function getChatFeed(mode = "community") {
  if (mode === "staff") {
    if ((state.data?.staffChatMessages || []).length) return state.data.staffChatMessages;
    return (state.data?.chatMessages || []).filter((entry) => entry.channel === "staff");
  }

  if ((state.data?.communityChatMessages || []).length) return state.data.communityChatMessages;
  return (state.data?.chatMessages || []).filter((entry) => entry.channel !== "staff");
}

function renderCreatorsPanel(managerView) {
  const creators = getCreatorEntries();

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Creator</p>
          <h2>Content Creator aus SONARA</h2>
        </div>
      </div>
      ${managerView ? '<p class="helper-text">Creator pflegen ihre Links im Profil. Im Team-Bereich kannst du sie bei Bedarf mit bearbeiten.</p>' : ""}
      <div class="team-grid">
        ${creators.length ? creators.map((entry) => renderCreatorCard(entry)).join("") : renderEmptyState("Noch keine Creator", "Sobald Creator Profiltext oder Links hinterlegen, erscheinen sie hier.")}
      </div>
    </section>
  `;
}

function renderChatWorkspace(mode) {
  const panels = [renderChatPanel("community"), renderDirectMessagesPanel()];
  if (mode !== "member") panels.push(renderChatPanel("staff", true));
  return panels.join("");
}

function renderChatPanel(mode = "community", compact = false) {
  const staffMode = mode === "staff";
  const availableShifts = staffMode ? getSortedShifts(state.data?.shifts || []) : [];
  const messages = getChatFeed(mode);
  const sectionSpan = compact ? "span-5" : staffMode ? "span-8" : "span-7";
  const eyebrow = staffMode ? "Staff-Chat" : "Community-Chat";
  const title = staffMode ? "Echtzeit-Chat fuer schnelle Staff-Absprachen" : "Echtzeit-Chat fuer die Community";
  const copy = staffMode
    ? "Neue Nachrichten erscheinen automatisch, ohne dass jemand neu laden muss. 5 Sekunden Cooldown verhindern Spam."
    : "Mitglieder koennen sich hier direkt im Portal austauschen, ohne auf Discord wechseln zu muessen. 5 Sekunden Cooldown verhindern Spam.";
  const placeholder = staffMode
    ? "z. B. Wer kann heute spaeter uebernehmen?"
    : "z. B. Wer ist heute Abend beim Event dabei?";
  const emptyTitle = staffMode ? "Noch kein Staff-Chat" : "Noch kein Community-Chat";
  const emptyText = staffMode
    ? "Die erste Nachricht erscheint sofort fuer alle Staff-Mitglieder online."
    : "Die erste Nachricht erscheint sofort fuer alle Mitglieder online.";
  const managerTools = canManagePortal()
    ? `
      <form class="chat-tools" data-form="chat-trim" data-channel="${escapeHtml(mode)}">
        <span class="helper-text">Verlauf kuerzen</span>
        <div class="trim-actions">
          ${CHAT_TRIM_OPTIONS.map((count) => `<button type="submit" class="ghost small" value="${count}">${count}</button>`).join("")}
        </div>
      </form>
    `
    : "";

  return `
    <section class="panel ${sectionSpan}">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="section-copy">${escapeHtml(copy)}</p>
        </div>
        <div class="chat-head-tools">
          ${managerTools}
          <span class="pill ${state.ui.liveChatConnected ? "success" : "amber"}">${state.ui.liveChatConnected ? "Live verbunden" : "Verbindung wird aufgebaut"}</span>
        </div>
      </div>

      <form class="stack-form" data-form="chat">
        <input type="hidden" name="channel" value="${escapeHtml(mode)}">
        <div class="form-grid">
          ${
            staffMode
              ? `
                <div class="field">
                  <label for="chatShift-${mode}">Bezug zu einer Schicht</label>
                  <select id="chatShift-${mode}" name="relatedShiftId">
                    <option value="">Keine konkrete Schicht</option>
                    ${availableShifts.map((shift) => renderShiftSelectOption(shift)).join("")}
                  </select>
                </div>
              `
              : ""
          }
          <div class="field ${staffMode ? "" : "span-all"}">
            <label for="chatMessage-${mode}">${staffMode ? "Nachricht" : "Beitrag"}</label>
            <textarea id="chatMessage-${mode}" name="content" placeholder="${escapeHtml(placeholder)}" required></textarea>
          </div>
        </div>
        <button type="submit">${staffMode ? "Im Staff-Chat posten" : "In Community posten"}</button>
      </form>

      <div class="stack-list chat-list">
        ${messages.length ? messages.map((message) => renderChatMessage(message)).join("") : renderEmptyState(emptyTitle, emptyText)}
      </div>
    </section>
  `;
}

function renderDirectMessagesPanel() {
  const recipients = getCommunityDirectory()
    .filter((entry) => entry.id !== state.session?.id)
    .slice()
    .sort((left, right) => getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de"));
  const conversations = buildDirectMessageConversations();
  const trimControls = canManagePortal()
    ? `
      <form class="chat-tools" data-form="direct-message-trim">
        <span class="helper-text">Verlauf kuerzen</span>
        <div class="trim-actions">
          ${CHAT_TRIM_OPTIONS.map((count) => `<button type="submit" class="ghost small" value="${count}">${count}</button>`).join("")}
        </div>
      </form>
    `
    : "";

  return `
    <section class="panel span-5">
      <div class="section-head">
        <div>
          <p class="eyebrow">Direktnachrichten</p>
          <h2>Private Nachrichten</h2>
        </div>
        ${trimControls}
      </div>

      <form class="stack-form" data-form="direct-message">
        <div class="field">
          <label for="dmRecipient">An</label>
          <select id="dmRecipient" name="recipientId" ${recipients.length ? "required" : "disabled"}>
            <option value="">${recipients.length ? "Person auswaehlen" : "Noch keine Empfaenger verfuegbar"}</option>
            ${recipients.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(getPrimaryDisplayName(entry))}${entry.discordName ? ` | ${escapeHtml(entry.discordName)}` : ""}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="dmContent">Nachricht</label>
          <textarea id="dmContent" name="content" placeholder="Private Nachricht" ${recipients.length ? "required" : "disabled"}></textarea>
        </div>
        <button type="submit" ${recipients.length ? "" : "disabled"}>Nachricht senden</button>
      </form>

      <div class="dm-thread-list">
        ${conversations.length ? conversations.map((entry) => renderDirectMessageCard(entry)).join("") : renderEmptyState("Noch keine Direktnachrichten", recipients.length ? "Sobald du jemandem schreibst, erscheint der Verlauf hier." : "Sobald die Benutzerliste geladen ist, kannst du hier Leute direkt anschreiben.")}
      </div>
    </section>
  `;
}

function buildDirectMessageConversations() {
  const messages = state.data?.directMessages || [];
  const users = new Map(getCommunityDirectory().map((entry) => [entry.id, entry]));
  const conversations = new Map();

  for (const message of messages) {
    const otherId = message.senderId === state.session?.id ? message.recipientId : message.senderId;
    if (!otherId) continue;
    if (!conversations.has(otherId)) {
      conversations.set(otherId, {
        otherUser: users.get(otherId) || {
          id: otherId,
          vrchatName: message.senderId === state.session?.id ? message.recipientName : message.senderName,
          discordName: ""
        },
        messages: []
      });
    }
    conversations.get(otherId).messages.push(message);
  }

  return Array.from(conversations.values())
    .map((entry) => ({
      ...entry,
      messages: entry.messages.slice().sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)),
      lastAt: entry.messages.reduce((latest, message) => Math.max(latest, new Date(message.createdAt).getTime()), 0)
    }))
    .sort((left, right) => right.lastAt - left.lastAt);
}

function getCreatorPlatformMeta(entry) {
  const rawUrl = String(entry?.url || "").trim();
  const rawLabel = String(entry?.label || "").trim();
  let host = "";

  try {
    host = new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {}

  const haystack = `${rawLabel} ${host} ${rawUrl}`.toLowerCase();

  if (haystack.includes("discord")) return { name: "Discord", badge: "DC" };
  if (haystack.includes("tiktok")) return { name: "TikTok", badge: "TT" };
  if (haystack.includes("spotify")) return { name: "Spotify", badge: "SP" };
  if (haystack.includes("youtube") || haystack.includes("youtu.be")) return { name: "YouTube", badge: "YT" };
  if (haystack.includes("twitch")) return { name: "Twitch", badge: "TW" };
  if (haystack.includes("instagram")) return { name: "Instagram", badge: "IG" };
  if (haystack.includes("twitter") || haystack.includes("x.com")) return { name: "X", badge: "X" };
  if (haystack.includes("soundcloud")) return { name: "SoundCloud", badge: "SC" };
  if (haystack.includes("patreon")) return { name: "Patreon", badge: "PT" };
  if (haystack.includes("vrchat")) return { name: "VRChat", badge: "VR" };
  return { name: rawLabel || "Website", badge: "WB" };
}

function renderCreatorLinkList(user, compact = false) {
  const links = user.creatorLinks || [];
  if (!links.length) return compact ? "" : '<p class="helper-text">Noch keine Creator-Links.</p>';

  return `
    <div class="chip-list creator-link-list">
      ${links
        .map((entry) => {
          const platform = getCreatorPlatformMeta(entry);
          return `
            <a class="pill ${compact ? "neutral" : "sky"} creator-link-pill" href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">
              <span class="creator-link-badge" aria-hidden="true">${escapeHtml(platform.badge)}</span>
              <span>${escapeHtml(entry.label || platform.name)}</span>
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMemberRequestCard(entry) {
  const statusTone = entry.status === "beruecksichtigt" ? "success" : entry.status === "in_planung" ? "amber" : "rose";
  const decisionTone = entry.memberDecision === "accepted" ? "success" : entry.memberDecision === "declined" ? "rose" : "amber";

  return `
    <article class="request-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill ${statusTone}">${escapeHtml(getStatusLabel(entry.status))}</span>
          <span class="pill neutral">${escapeHtml(entry.type)}</span>
          ${renderRatingPill(entry.rating)}
          ${entry.memberDecisionLabel ? `<span class="pill ${decisionTone}">${escapeHtml(entry.memberDecisionLabel)}</span>` : ""}
        </div>
      </div>
      <p>${escapeHtml(entry.content)}</p>
      <p class="timeline-meta">${escapeHtml(entry.date ? formatDate(entry.date) : "Ohne fixes Datum")} | ${escapeHtml(formatDateTime(entry.createdAt))}</p>
      ${entry.adminNote ? `<p class="helper-text">Leitungsnotiz: ${escapeHtml(entry.adminNote)}</p>` : ""}
      ${
        entry.memberDecision === "pending"
          ? `
            <form class="card-actions" data-form="request-decision" data-request-id="${escapeHtml(entry.id)}">
              <button type="submit" class="small" value="accepted">Passt fuer mich</button>
              <button type="submit" class="ghost small" value="declined">So nicht moeglich</button>
            </form>
          `
          : ""
      }
    </article>
  `;
}

function renderAdminRequestCard(entry) {
  const statusTone = entry.status === "beruecksichtigt" ? "success" : entry.status === "in_planung" ? "amber" : "rose";
  const decisionTone = entry.memberDecision === "accepted" ? "success" : entry.memberDecision === "declined" ? "rose" : "amber";

  return `
    <article class="request-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill ${statusTone}">${escapeHtml(getStatusLabel(entry.status))}</span>
          <span class="pill neutral">${escapeHtml(entry.type)}</span>
          ${renderRatingPill(entry.rating)}
          ${entry.memberDecisionLabel ? `<span class="pill ${decisionTone}">${escapeHtml(entry.memberDecisionLabel)}</span>` : ""}
        </div>
      </div>
      <div>
        <h3>${escapeHtml(entry.userName)}</h3>
        <p class="timeline-meta">${escapeHtml(entry.date ? formatDate(entry.date) : "Ohne fixes Datum")} | ${escapeHtml(formatDateTime(entry.createdAt))}</p>
      </div>
      <p>${escapeHtml(entry.content)}</p>
      ${entry.memberDecisionAt ? `<p class="helper-text">Antwort vom Mitglied: ${escapeHtml(entry.memberDecisionLabel || "-")} am ${escapeHtml(formatDateTime(entry.memberDecisionAt))}</p>` : ""}

      <form data-form="request-admin" data-request-id="${escapeHtml(entry.id)}">
        <div class="field">
          <label for="status-${escapeHtml(entry.id)}">Status</label>
          <select id="status-${escapeHtml(entry.id)}" name="status">
            ${buildStatusOptions(entry.status)}
          </select>
        </div>
        <div class="field">
          <label for="adminNote-${escapeHtml(entry.id)}">Notiz fuer den Moderator</label>
          <textarea id="adminNote-${escapeHtml(entry.id)}" name="adminNote" placeholder="Kurze Rueckmeldung oder Bestaetigung">${escapeHtml(entry.adminNote || "")}</textarea>
        </div>
        <button type="submit" class="ghost small">Rueckmeldung speichern</button>
      </form>
    </article>
  `;
}

function renderEventsPanel() {
  const events = getCommunityData().events || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Eventplan</p>
          <h2>Kommende SONARA-Events</h2>
          <p class="section-copy">Welten, Hosts und Zeiten bleiben fuer Mitglieder und Staff an einem Ort sichtbar.</p>
        </div>
      </div>

      ${
        canManagePortal()
          ? `
            <form class="stack-form event-editor" data-form="event-create">
              <div class="form-grid">
                <div class="field">
                  <label for="eventTitle">Titel</label>
                  <input id="eventTitle" name="title" type="text" required>
                </div>
                <div class="field">
                  <label for="eventDateLabel">Zeitpunkt</label>
                  <input id="eventDateLabel" name="dateLabel" type="text" placeholder="Freitag · 20:00 Uhr" required>
                </div>
                <div class="field">
                  <label for="eventWorld">Welt</label>
                  <input id="eventWorld" name="world" type="text" required>
                </div>
                <div class="field">
                  <label for="eventHost">Host</label>
                  <input id="eventHost" name="host" type="text" placeholder="Optional">
                </div>
                <div class="field span-all">
                  <label for="eventSummary">Kurzbeschreibung</label>
                  <textarea id="eventSummary" name="summary" required></textarea>
                </div>
              </div>
              <button type="submit">Event speichern</button>
            </form>
          `
          : ""
      }

      <div class="event-grid">
        ${events.length ? events.map((event) => renderEventCard(event)).join("") : renderEmptyState("Noch keine Events", "Sobald neue Termine feststehen, erscheinen sie hier.")}
      </div>
    </section>
  `;
}

function renderEventCard(event) {
  return `
    <article class="mini-card event-card">
      <div class="status-row">
        <span class="pill amber">Event</span>
        <span class="timeline-meta">${escapeHtml(event.dateLabel || "-")}</span>
      </div>
      <div>
        <h3>${escapeHtml(event.title)}</h3>
        <p class="timeline-meta">${escapeHtml(event.world)} | Host: ${escapeHtml(event.host)}</p>
      </div>
      <p>${escapeHtml(event.summary)}</p>
      ${
        canManagePortal()
          ? `
            <form class="card-actions" data-form="event-delete" data-event-id="${escapeHtml(event.id)}">
              <button type="submit" class="danger small">Event loeschen</button>
            </form>
          `
          : ""
      }
    </article>
  `;
}

function renderFeedReactionButton(post, emoji, icon) {
  const reacted = (post.reactions?.[emoji] || []).includes(state.session?.id);
  const count = (post.reactions?.[emoji] || []).length;
  return `
    <form data-form="feed-reaction" data-post-id="${escapeHtml(post.id)}" data-emoji="${escapeHtml(emoji)}">
      <button type="submit" class="${reacted ? "" : "ghost"} small reaction-button">
        <span>${escapeHtml(icon)}</span>
        <span>${escapeHtml(String(count))}</span>
      </button>
    </form>
  `;
}

function renderFeedPostCard(post) {
  const canDelete = post.authorId === state.session?.id || canManagePortal();
  return `
    <article class="request-card feed-post-card">
      <div class="profile-head">
        ${post.authorAvatarUrl ? `<div class="avatar profile-avatar"><img src="${escapeHtml(post.authorAvatarUrl)}" alt="${escapeHtml(post.authorName)}" class="avatar-image"></div>` : renderUserAvatar({ vrchatName: post.authorName }, "profile-avatar")}
        <div>
          <h3>${escapeHtml(post.authorName)}</h3>
          <p class="timeline-meta">${escapeHtml(formatDateTime(post.createdAt))}</p>
        </div>
      </div>
      ${post.content ? `<p>${escapeHtml(post.content)}</p>` : ""}
      ${post.imageUrl ? `<img src="${escapeHtml(post.imageUrl)}" alt="Feed Bild von ${escapeHtml(post.authorName)}" class="feed-image">` : ""}
      <div class="card-actions reaction-row">
        ${renderFeedReactionButton(post, "like", "👍")}
        ${renderFeedReactionButton(post, "heart", "❤️")}
        ${renderFeedReactionButton(post, "fire", "🔥")}
        ${renderFeedReactionButton(post, "star", "⭐")}
        ${renderFeedReactionButton(post, "laugh", "😂")}
        ${
          canDelete
            ? `
              <form data-form="feed-delete" data-post-id="${escapeHtml(post.id)}">
                <button type="submit" class="danger small">Loeschen</button>
              </form>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderFeedPanel() {
  const posts = state.data?.feedPosts || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community Feed</p>
          <h2>Bilder, Momente und Reaktionen</h2>
          <p class="section-copy">Mitglieder koennen hier Bilder oder kurze Posts teilen, durchscrollen und direkt reagieren.</p>
        </div>
      </div>

      <form class="stack-form" data-form="feed-post">
        <div class="form-grid">
          <div class="field span-all">
            <label for="feedContent">Beitrag</label>
            <textarea id="feedContent" name="content" placeholder="Was moechtest du mit der Community teilen?"></textarea>
          </div>
          <div class="field">
            <label for="feedImageFile">Bild</label>
            <input id="feedImageFile" name="imageFile" type="file" accept="image/*">
          </div>
        </div>
        <button type="submit">Im Feed posten</button>
      </form>

      <div class="stack-list feed-list">
        ${posts.length ? posts.map((post) => renderFeedPostCard(post)).join("") : renderEmptyState("Noch kein Feed", "Sobald Mitglieder etwas posten, erscheint es hier.")}
      </div>
    </section>
  `;
}

function renderDashboardTabs(activeTab) {
  const common = [
    { id: "overview", label: "Dashboard" },
    { id: "feed", label: "Feed" },
    { id: "community", label: "Community" },
    { id: "calendar", label: "Kalender" },
    { id: "events", label: "Events" },
    { id: "news", label: "News" },
    { id: "creators", label: "Creator" },
    { id: "forum", label: "Forum" },
    { id: "chat", label: "Chat" },
    { id: "profile", label: "Profil" }
  ];

  let tabs = common;
  if (canManagePortal()) {
    tabs = [...common, { id: "feedback", label: "Feedback" }, { id: "planning", label: "Planung" }, { id: "capacity", label: "Auslastung" }, { id: "team", label: "Team" }, { id: "time", label: "Zeiten" }, { id: "settings", label: "Einstellungen" }];
  } else if (canAccessStaffArea()) {
    tabs = [...common, { id: "schedule", label: "Meine Schichten" }, { id: "feedback", label: "Feedback" }, { id: "time", label: "Zeiten" }];
  } else {
    tabs = [...common, { id: "feedback", label: "Feedback" }];
  }

  return `
    <nav class="panel tab-bar" aria-label="Hauptbereiche">
      ${tabs
        .map(
          (tab) => `
            <button type="button" class="tab-chip ${tab.id === activeTab ? "active" : ""}" data-action="set-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderManagerDashboard(activeTab) {
  switch (activeTab) {
    case "feed":
      return renderFeedPanel();
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "calendar":
      return renderShiftCalendarPanel();
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(true);
    case "creators":
      return renderCreatorsPanel(true);
    case "forum":
      return renderForumPanel(true);
    case "feedback":
      return renderFeedbackAdminPanel();
    case "planning":
      return [renderPlannerPanel(), renderSwapPanel(true), renderRequestAdminPanel()].join("");
    case "capacity":
      return renderCapacityPanel();
    case "team":
      return [renderWarningAdminPanel(), renderTeamPanelV2()].join("");
    case "chat":
      return renderChatWorkspace("manager");
    case "time":
      return renderAttendancePanel(true);
    case "profile":
      return renderProfilePanel(true);
    case "settings":
      return [renderSettingsPanel(), renderDiscordPanel(), renderVrchatAnalyticsPanel()].join("");
    case "overview":
    default:
      return [renderNotificationsPanel(), renderFeedPanel(), renderWarningAdminPanel(), renderNewsSpotlightPanel(), renderCreatorsPanel(false), renderRequestAdminPanel()].join("");
  }
}

function renderModeratorDashboard(activeTab) {
  switch (activeTab) {
    case "feed":
      return renderFeedPanel();
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "calendar":
      return renderShiftCalendarPanel();
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(false);
    case "creators":
      return renderCreatorsPanel(false);
    case "forum":
      return renderForumPanel(false);
    case "schedule":
      return [renderMySchedulePanel(), renderSwapPanel(false)].join("");
    case "feedback":
      return renderFeedbackMemberPanel();
    case "chat":
      return renderChatWorkspace("staff");
    case "time":
      return renderAttendancePanel(false);
    case "profile":
      return renderProfilePanel(false);
    case "overview":
    default:
      return [renderNotificationsPanel(), renderFeedPanel(), renderNewsSpotlightPanel(), renderMySchedulePanel(), renderCreatorsPanel(false)].join("");
  }
}

function renderMemberDashboard(activeTab) {
  switch (activeTab) {
    case "feed":
      return renderFeedPanel();
    case "community":
      return [renderCommunityOverviewPanel(), renderCommunityRulesPanel(), renderCommunityTeamPanel()].join("");
    case "calendar":
      return renderShiftCalendarPanel();
    case "events":
      return renderEventsPanel();
    case "news":
      return renderNewsPanel(false);
    case "creators":
      return renderCreatorsPanel(false);
    case "forum":
      return renderForumPanel(false);
    case "feedback":
      return renderFeedbackMemberPanel();
    case "chat":
      return renderChatWorkspace("member");
    case "profile":
      return renderProfilePanel(false);
    case "overview":
    default:
      return [renderNotificationsPanel(), renderFeedPanel(), renderNewsSpotlightPanel(), renderCreatorsPanel(false), renderCommunityOverviewPanel()].join("");
  }
}

function normalizeActiveTab(tab) {
  const allowed = canManagePortal()
    ? ["overview", "feed", "community", "calendar", "events", "news", "creators", "forum", "feedback", "planning", "capacity", "team", "chat", "time", "profile", "settings"]
    : canAccessStaffArea()
      ? ["overview", "feed", "community", "calendar", "events", "news", "creators", "forum", "schedule", "feedback", "chat", "time", "profile"]
      : ["overview", "feed", "community", "calendar", "events", "news", "creators", "forum", "feedback", "chat", "profile"];

  return allowed.includes(tab) ? tab : "overview";
}

function renderEventsPanel() {
  const events = getCommunityData().events || [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Eventplan</p>
          <h2>Kommende SONARA-Events</h2>
          <p class="section-copy">Wochentermine und einmalige Events bleiben hier sichtbar, erzeugen Hinweise und tauchen im Kalender automatisch mit auf.</p>
        </div>
      </div>

      ${
        canManagePortal()
          ? `
            <form class="stack-form event-editor" data-form="event-create">
              <div class="form-grid">
                <div class="field">
                  <label for="eventTitle">Titel</label>
                  <input id="eventTitle" name="title" type="text" required>
                </div>
                <div class="field">
                  <label for="eventScheduleType">Rhythmus</label>
                  <select id="eventScheduleType" name="scheduleType">
                    <option value="single">Einmalig</option>
                    <option value="weekly">Woechentlich</option>
                  </select>
                </div>
                <div class="field">
                  <label for="eventDate">Datum fuer einmalige Events</label>
                  <input id="eventDate" name="eventDate" type="date">
                </div>
                <div class="field">
                  <label for="eventWeekday">Wochentag fuer Wochentermine</label>
                  <select id="eventWeekday" name="weekday">
                    ${buildEventWeekdayOptions()}
                  </select>
                </div>
                <div class="field">
                  <label for="eventTime">Uhrzeit</label>
                  <input id="eventTime" name="eventTime" type="time" required>
                </div>
                <div class="field">
                  <label for="eventWorld">Welt</label>
                  <input id="eventWorld" name="world" type="text" required>
                </div>
                <div class="field">
                  <label for="eventHost">Host</label>
                  <input id="eventHost" name="host" type="text" placeholder="Optional">
                </div>
                <div class="field checkbox-field">
                  <label class="checkbox-row" for="eventReminderEnabled">
                    <input id="eventReminderEnabled" name="reminderEnabled" type="checkbox" checked>
                    <span>Erinnerungen aktivieren</span>
                  </label>
                  <p class="helper-text">Wird in Hinweisen und im Kalender sichtbar.</p>
                </div>
                <div class="field span-all">
                  <label for="eventSummary">Kurzbeschreibung</label>
                  <textarea id="eventSummary" name="summary" required></textarea>
                </div>
              </div>
              <p class="pill-note">Einmalige Events brauchen Datum und Uhrzeit. Wochentermine brauchen Wochentag und Uhrzeit und erscheinen dann jede Woche automatisch im Kalender und in den Hinweisen.</p>
              <button type="submit">Event speichern</button>
            </form>
          `
          : ""
      }

      <div class="event-grid">
        ${events.length ? events.map((event) => renderEventCard(event)).join("") : renderEmptyState("Noch keine Events", "Sobald neue Termine feststehen, erscheinen sie hier.")}
      </div>
    </section>
  `;
}

function renderEventCard(event) {
  return `
    <article class="mini-card event-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill amber">Event</span>
          <span class="pill neutral">${escapeHtml(event.scheduleLabel || (event.scheduleType === "weekly" ? "Woechentlich" : "Einmalig"))}</span>
          ${event.reminderEnabled ? '<span class="pill teal">Erinnerung aktiv</span>' : ""}
        </div>
        <span class="timeline-meta">${escapeHtml(event.dateLabel || "-")}</span>
      </div>
      <div>
        <h3>${escapeHtml(event.title)}</h3>
        <p class="timeline-meta">${escapeHtml(event.world)} | Host: ${escapeHtml(event.host)}</p>
      </div>
      <p>${escapeHtml(event.summary)}</p>
      ${event.nextOccurrenceAt ? `<p class="helper-text">Naechster Termin: ${escapeHtml(formatDateTime(event.nextOccurrenceAt))}</p>` : ""}
      ${
        canManagePortal()
          ? `
            <form class="card-actions" data-form="event-delete" data-event-id="${escapeHtml(event.id)}">
              <button type="submit" class="danger small">Event loeschen</button>
            </form>
          `
          : ""
      }
    </article>
  `;
}

function buildEventWeekdayOptions(selectedValue = "") {
  return [
    { value: "", label: "Wochentag waehlen" },
    { value: "1", label: "Montag" },
    { value: "2", label: "Dienstag" },
    { value: "3", label: "Mittwoch" },
    { value: "4", label: "Donnerstag" },
    { value: "5", label: "Freitag" },
    { value: "6", label: "Samstag" },
    { value: "0", label: "Sonntag" }
  ]
    .map((entry) => `<option value="${entry.value}" ${String(selectedValue) === entry.value ? "selected" : ""}>${escapeHtml(entry.label)}</option>`)
    .join("");
}

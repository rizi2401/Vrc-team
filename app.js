const root = document.getElementById("app");

const ROLE_LABELS = {
  member: "Mitglied",
  moderator: "Moderator",
  moderation_lead: "Moderationsleitung",
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
const AVAILABILITY_DAYS = [
  { id: "mo", shortLabel: "Mo", fullLabel: "Montag" },
  { id: "di", shortLabel: "Di", fullLabel: "Dienstag" },
  { id: "mi", shortLabel: "Mi", fullLabel: "Mittwoch" },
  { id: "do", shortLabel: "Do", fullLabel: "Donnerstag" },
  { id: "fr", shortLabel: "Fr", fullLabel: "Freitag" },
  { id: "sa", shortLabel: "Sa", fullLabel: "Samstag" },
  { id: "so", shortLabel: "So", fullLabel: "Sonntag" }
];
const CHAT_TRIM_OPTIONS = [20, 30, 40, 50];
const SONARA_ART_PATH = "/sonara-crest.png";
const CREATOR_MIN_FOLLOWERS = 200;
let portalRefreshTimer = 0;
const pendingSubmitForms = new WeakSet();

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
    plannerDraft: null,
    pendingPortalRefresh: false,
    pendingRender: false,
    formEditingUntil: 0,
    lastActionSucceeded: false,
    selectedCreatorId: ""
  }
};

root.addEventListener("submit", handleSubmitProxy);
root.addEventListener("click", handleClick);
root.addEventListener("input", handleInput);
root.addEventListener("change", handleChange);
root.addEventListener("focusout", handleFocusOut);

boot();

async function handleSubmitProxy(event) {
  const form = event.target;
  const formName = form?.dataset?.form;
  if (!formName) return;

  if (pendingSubmitForms.has(form)) {
    event.preventDefault();
    return;
  }

  pendingSubmitForms.add(form);
  setFormSubmittingState(form, true);
  state.ui.lastActionSucceeded = false;

  try {
    await handleSubmit(event);
    if (state.ui.lastActionSucceeded) {
      if (shouldClearFormDraftAfterSuccess(formName)) {
        clearPersistentFormDraft(form);
      }
      clearAvatarDraft(getAvatarDraftKey(form));
    }
  } finally {
    state.ui.lastActionSucceeded = false;
    setFormSubmittingState(form, false);
    pendingSubmitForms.delete(form);
    void flushPendingPortalRefresh();
  }
}

function setFormSubmittingState(form, isSubmitting) {
  if (!form) return;

  if (isSubmitting) {
    form.dataset.submitting = "true";
  } else {
    delete form.dataset.submitting;
  }

  const controls = form.querySelectorAll('button, input[type="submit"]');
  controls.forEach((control) => {
    if (isSubmitting) {
      control.dataset.wasDisabled = control.disabled ? "true" : "false";
      control.disabled = true;
      return;
    }

    const wasDisabled = control.dataset.wasDisabled === "true";
    control.disabled = wasDisabled;
    delete control.dataset.wasDisabled;
  });
}

function getPersistentFormDraftStore() {
  if (!state.ui.formDrafts) state.ui.formDrafts = {};
  return state.ui.formDrafts;
}

function buildPersistentFormDraftKey(formName, metadata = {}) {
  const parts = [["form", formName], ...Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== "")];
  return parts
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function getPersistentFormDraftKey(source) {
  const form = source?.tagName === "FORM" ? source : source?.closest?.("form");
  const formName = form?.dataset?.form;
  if (!formName) return "";

  const metadata = Object.fromEntries(
    Object.entries(form.dataset || {}).filter(([key, value]) => key !== "form" && key !== "submitting" && value !== undefined && value !== null && value !== "")
  );

  if (formName === "chat" && !metadata.channel) {
    const channel = form.dataset.channel || form.querySelector('input[name="channel"]')?.value || "";
    if (channel) metadata.channel = channel;
  }

  return buildPersistentFormDraftKey(formName, metadata);
}

function getPersistentFormDraft(sourceOrKey, metadata = {}) {
  const key =
    typeof sourceOrKey === "string"
      ? sourceOrKey.includes("=")
        ? sourceOrKey
        : buildPersistentFormDraftKey(sourceOrKey, metadata)
      : getPersistentFormDraftKey(sourceOrKey);
  return key ? getPersistentFormDraftStore()[key] || null : null;
}

function clearPersistentFormDraft(sourceOrKey, metadata = {}) {
  const key =
    typeof sourceOrKey === "string"
      ? sourceOrKey.includes("=")
        ? sourceOrKey
        : buildPersistentFormDraftKey(sourceOrKey, metadata)
      : getPersistentFormDraftKey(sourceOrKey);
  if (!key) return;
  delete getPersistentFormDraftStore()[key];
  if (!Object.keys(getPersistentFormDraftStore()).length) {
    state.ui.formEditingUntil = 0;
  }
}

function shouldClearFormDraftAfterSuccess(formName) {
  return [
    "login",
    "register",
    "shift",
    "shift-bulk",
    "request",
    "request-admin",
    "announcement",
    "system-notice",
    "event-create",
    "chat",
    "direct-message",
    "forum-thread",
    "forum-reply",
    "feed-post",
    "catalog",
    "warning-create",
    "admin-user-create",
    "user-update",
    "profile-update",
    "availability-update"
  ].includes(String(formName || ""));
}

function isDraftableFormControl(control) {
  if (!control || !control.name || control.disabled) return false;
  if (!["INPUT", "TEXTAREA", "SELECT"].includes(control.tagName)) return false;

  const type = String(control.type || "").toLowerCase();
  if (["hidden", "submit", "button", "reset", "file", "password"].includes(type)) return false;
  return true;
}

function getDraftableControlsByName(form, name) {
  return Array.from(form?.elements || []).filter((control) => isDraftableFormControl(control) && control.name === name);
}

function markFormEditingWindow(durationMs = 5 * 60 * 1000) {
  state.ui.formEditingUntil = Date.now() + Math.max(15000, Number(durationMs || 0));
}

function isFormCurrentlyVisible(form) {
  if (!form || !root.contains(form)) return false;
  if (typeof form.getClientRects === "function" && !form.getClientRects().length) return false;
  return true;
}

function hasVisibleDraftedForm() {
  return Array.from(root.querySelectorAll("form[data-form]")).some((form) => isFormCurrentlyVisible(form) && Boolean(getPersistentFormDraft(form)));
}

function isRecentFormEditingSession() {
  return Number(state.ui.formEditingUntil || 0) > Date.now() && hasVisibleDraftedForm();
}

function rememberViewportScrollPosition() {
  if (typeof window === "undefined") return;
  if (String(state.ui.scrollToShiftId || "").trim()) return;
  state.ui.tabViewportScrollY = window.scrollY;
}

function rememberPersistentFormDraft(form) {
  const key = getPersistentFormDraftKey(form);
  if (!key) return;
  markFormEditingWindow();

  const controls = Array.from(form.elements || []).filter((control) => isDraftableFormControl(control));
  if (!controls.length) {
    clearPersistentFormDraft(key);
    return;
  }

  const names = [...new Set(controls.map((control) => control.name).filter(Boolean))];
  const draft = {};

  for (const name of names) {
    const group = getDraftableControlsByName(form, name);
    if (!group.length) continue;

    const firstType = String(group[0].type || "").toLowerCase();
    if (firstType === "radio") {
      draft[name] = group.find((control) => control.checked)?.value || "";
      continue;
    }

    if (firstType === "checkbox" && group.length > 1) {
      draft[name] = group.filter((control) => control.checked).map((control) => control.value);
      continue;
    }

    if (firstType === "checkbox") {
      draft[name] = Boolean(group[0].checked);
      continue;
    }

    draft[name] = String(group[0].value || "");
  }

  getPersistentFormDraftStore()[key] = draft;
}

function restoreFormDrafts() {
  const forms = root.querySelectorAll("form[data-form]");
  forms.forEach((form) => {
    const draft = getPersistentFormDraft(form);
    if (!draft) return;

    Object.entries(draft).forEach(([name, value]) => {
      const controls = getDraftableControlsByName(form, name);
      if (!controls.length) return;

      const firstType = String(controls[0].type || "").toLowerCase();
      if (firstType === "radio") {
        controls.forEach((control) => {
          control.checked = String(value || "") === String(control.value || "");
        });
        return;
      }

      if (firstType === "checkbox" && controls.length > 1) {
        const values = Array.isArray(value) ? value.map((entry) => String(entry)) : [];
        controls.forEach((control) => {
          control.checked = values.includes(String(control.value || ""));
        });
        return;
      }

      if (firstType === "checkbox") {
        controls[0].checked = Boolean(value);
        return;
      }

      controls[0].value = String(value ?? "");
    });
  });
}

function isFormInteractionLocked() {
  if (isRecentFormEditingSession()) return true;
  if (typeof document === "undefined") return false;

  const activeElement = document.activeElement;
  if (!activeElement || !root.contains(activeElement)) return false;

  const form = activeElement.closest?.("form[data-form]");
  if (!form || form.dataset.submitting === "true") return false;
  return isDraftableFormControl(activeElement);
}

function renderIfFormIdle() {
  if (isFormInteractionLocked()) {
    state.ui.pendingRender = true;
    return;
  }

  state.ui.pendingRender = false;
  rememberViewportScrollPosition();
  render();
}

async function refreshPortalDataFromBackground() {
  if (isFormInteractionLocked()) {
    state.ui.pendingPortalRefresh = true;
    return;
  }

  state.ui.pendingPortalRefresh = false;
  state.ui.pendingRender = false;
  rememberViewportScrollPosition();

  if (state.session) {
    await refreshBootstrap();
  } else {
    await refreshPublicData();
  }

  render();
}

async function flushPendingPortalRefresh() {
  if (isFormInteractionLocked()) return;

  if (state.ui.pendingPortalRefresh) {
    await refreshPortalDataFromBackground();
    return;
  }

  if (state.ui.pendingRender) {
    state.ui.pendingRender = false;
    rememberViewportScrollPosition();
    render();
  }
}

function handleFocusOut() {
  window.setTimeout(() => {
    void flushPendingPortalRefresh();
  }, 0);
}

async function boot() {
  syncNotificationPermission();
  await refreshBootstrap();
  if (!state.session) {
    await refreshPublicData();
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
  state.vrchatOverview = null;
  state.vrchatLoading = false;
  if (showErrors) setFlash("Die VRChat-Datei-Anbindung wurde entfernt.", "info");
  render();
}

async function refreshDiscordStatus(showErrors = true) {
  state.discordStatus = null;
  state.discordLoading = false;
  if (showErrors) setFlash("Der Discord-Webhook-Bereich wurde entfernt.", "info");
  render();
}

async function runDiscordTest() {
  await refreshDiscordStatus(true);
}

async function runVrchatSync() {
  await refreshVrchatOverview(true);
}

async function submitVrchatSecurityCode(code) {
  await refreshVrchatOverview(true);
  return;
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
  const creatorIds = new Set((state.data?.community?.creators || []).map((entry) => entry.id));
  if (state.ui.selectedCreatorId && !creatorIds.has(state.ui.selectedCreatorId)) {
    state.ui.selectedCreatorId = state.data?.community?.creators?.[0]?.id || "";
  }
  if (!canManagePortal()) {
    state.vrchatOverview = null;
    state.vrchatLoading = false;
    state.discordStatus = null;
    state.discordLoading = false;
  }
}

function renderSonaraHero({ eyebrow, title, intro, chips = [] }) {
  return `
    <header class="site-header sonara-header">
      <div class="sonara-scene" aria-hidden="true">
        <span class="sonara-scene-orb sonara-scene-sun"></span>
        <span class="sonara-scene-orb sonara-scene-moon"></span>
        <span class="sonara-scene-spirit sonara-scene-stag"></span>
        <span class="sonara-scene-spirit sonara-scene-owl"></span>
      </div>
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
  const route = getPublicRouteState();
  root.innerHTML = state.session && route.kind !== "creator" ? renderDashboard() : renderPublicPortal();
  restoreFormDrafts();
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

    await refreshPortalDataFromBackground();
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
  const route = getPublicRouteState();
  if (route.kind === "creator") {
    const creator = getPublicCreatorBySlug(route.slug);
    return creator ? renderCreatorPublicPage(creator) : renderCreatorPublicNotFound(route.slug);
  }

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
      return renderSettingsPanel();
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
  const categoryLabel = getNotificationCategoryLabel(entry.category);
  return `
    <article class="mini-card notification-card ${tone}">
      <div class="status-row">
        <span class="pill ${tone === "info" ? "neutral" : tone}">${escapeHtml(categoryLabel)}</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
      </div>
      <div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.body)}</p>
      </div>
    </article>
  `;
}

function getNotificationCategoryLabel(category) {
  const rawCategory = String(category || "").trim();
  if (!rawCategory) return "Hinweis";

  switch (rawCategory.toLowerCase()) {
    case "shift":
      return "Schicht";
    case "request":
      return "R\u00fcckmeldung";
    case "announcement":
      return "Info";
    case "attendance":
      return "Zeiten";
    case "swap":
      return "Tausch";
    case "event":
      return "Event";
    default:
      return rawCategory;
  }
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
                <div class="field-head">
                  <label>Moderatoren auswaehlen</label>
                  <div class="bulk-selector-toolbar">
                    <button type="button" class="ghost small" data-action="bulk-select-all-members">Alle</button>
                    <button type="button" class="ghost small" data-action="bulk-clear-members">Keine</button>
                  </div>
                </div>
                <div class="bulk-checkbox-grid">
                  ${buildBulkMemberChecks(users)}
                </div>
                <p class="helper-text">Ein Moderator = Wochenplanung fuer eine Person. Mehrere Haken = gleiche Schicht fuer alle markierten Moderatoren.</p>
              </div>
              <div class="field">
                <label for="bulkDateStart">Von</label>
                <input id="bulkDateStart" name="dateStart" type="date" value="${escapeHtml(plannerFormValues.date || getLocalDateKey())}" required>
              </div>
              <div class="field">
                <label for="bulkDateEnd">Bis</label>
                <input id="bulkDateEnd" name="dateEnd" type="date" value="${escapeHtml(addDaysToDateKey(plannerFormValues.date || getLocalDateKey(), 6))}" required>
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
                <div class="field-head">
                  <label>Wochentage</label>
                  <div class="bulk-selector-toolbar">
                    <button type="button" class="ghost small" data-action="bulk-weekdays-workdays">Mo-Fr</button>
                    <button type="button" class="ghost small" data-action="bulk-weekdays-all">Alle Tage</button>
                    <button type="button" class="ghost small" data-action="bulk-weekdays-clear">Keine</button>
                  </div>
                </div>
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

function addDaysToDateKey(dateKey, amount) {
  const normalized = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return getLocalDateKey();

  const [year, month, day] = normalized.split("-").map(Number);
  const nextDate = new Date(year, month - 1, day + Number(amount || 0), 12, 0, 0);
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

function buildBulkMemberChecks(users) {
  return users
    .map(
      (user) => `
        <label class="bulk-checkbox-card">
          <input type="checkbox" name="memberIds" value="${escapeHtml(user.id)}">
          <span>
            <strong>${escapeHtml(getPrimaryDisplayName(user))}</strong>
            <small>${escapeHtml(ROLE_LABELS[user.role] || "Moderator")}</small>
          </span>
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
  const totalOvertimeHours = rows.reduce((sum, entry) => sum + entry.overtimeHours, 0);
  const totalOvertimeBankHours = rows.reduce((sum, entry) => sum + entry.overtimeBankHours, 0);
  const missingRows = rows.filter((entry) => !entry.capacityHours && !entry.capacityDays && !entry.availabilitySchedule && !entry.hasAvailabilitySlots);
  const missingNames = missingRows.map((entry) => getPrimaryDisplayName(entry.user));

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Auslastung</p>
          <h2>Stunden und Verfuegbarkeit im Blick</h2>
          <p class="section-copy">Hier siehst du pro Staff-Mitglied diese Woche, letzte Woche und die gesamte Ueberstundenbank. Ausgleich fuer freie Tage oder freie Wochen kannst du direkt hier verbuchen.</p>
        </div>
      </div>

      <p class="pill-note">Bitte bis Samstag die Verfuegbarkeiten fuer die naechste Woche einsammeln. Moderatoren und Leitung tragen das direkt im Profil ein. Ohne Rueckmeldung keine Einplanung; wiederholt fehlend kann zu Verwarnungen fuehren.</p>

      <div class="stats-strip compact-stats">
        ${renderStatCard("Geleistet", formatHoursValue(totalWorkedHours), "Bisher erfasste Stunden diese Woche", "teal")}
        ${renderStatCard("Geplant", formatHoursValue(totalPlannedHours), "Eingetragene Schichtstunden diese Woche", "amber")}
        ${renderStatCard("Kapazitaet", totalCapacityHours ? formatHoursValue(totalCapacityHours) : "-", totalCapacityHours ? "Gemeldete Wochenstunden aus Profilen" : "Noch keine Profilangaben", "sky")}
        ${renderStatCard("Diese Woche ueber Soll", totalOvertimeHours ? formatHoursValue(totalOvertimeHours) : "-", totalOvertimeHours ? "Aktueller Ueberhang in dieser Woche" : "Diese Woche noch kein Ueberhang", totalOvertimeHours ? "rose" : "neutral")}
        ${renderStatCard("Ueberstundenbank", Math.abs(totalOvertimeBankHours) > 0.001 ? formatSignedHoursValue(totalOvertimeBankHours) : "0 Std.", "Gesammelte Ueberstunden inklusive manueller Ausgleichsbuchungen", totalOvertimeBankHours > 0 ? "rose" : totalOvertimeBankHours < 0 ? "amber" : "neutral")}
        ${renderStatCard("Noch offen", totalCapacityHours ? formatHoursValue(openHours) : "-", totalCapacityHours ? "Noch nicht verplante gemeldete Stunden" : "Keine Kapazitaet hinterlegt", "rose")}
      </div>

      ${
        missingRows.length
          ? `
            <p class="pill-note">Rueckmeldung fehlt aktuell bei ${escapeHtml(String(missingRows.length))} Person${missingRows.length === 1 ? "" : "en"}: ${escapeHtml(missingNames.join(", "))}.</p>
            <p class="helper-text">Diese Staff-Mitglieder haben noch keine Stunden, Tage oder Zeitfenster fuer diese Woche eingetragen.</p>
          `
          : '<p class="pill-note">Alle Staff-Rueckmeldungen fuer die aktuelle Woche sind vorhanden.</p>'
      }

      <div class="calendar-members">
        ${
          rows.length
            ? rows.map((entry) => renderCapacityCard(entry)).join("")
            : renderEmptyState("Noch keine Staff-Daten", "Sobald Staff-Mitglieder angelegt sind und ihre Verfuegbarkeit im Profil eintragen, erscheint die Wochenuebersicht hier.")
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
      <p><strong>Diese Woche:</strong> ${escapeHtml(formatHoursValue(entry.workedHours))} an ${escapeHtml(formatCapacityDays(entry.workedDays))}</p>
      <p><strong>Letzte Woche:</strong> ${escapeHtml(formatHoursValue(entry.previousWeekHours || 0))}${entry.capacityHours > 0 ? ` | ${escapeHtml(formatSignedHoursValue(entry.previousWeekBalanceHours || 0))}` : ""}</p>
      <p><strong>Heute:</strong> ${escapeHtml(formatHoursValue(entry.todayWorkedHours || 0))}</p>
      <p><strong>Geplant:</strong> ${escapeHtml(formatHoursValue(entry.plannedHours))} an ${escapeHtml(formatCapacityDays(entry.plannedDays))}</p>
      <p><strong>Verfuegbar:</strong> ${escapeHtml(formatCapacityHours(entry.capacityHours))} / ${escapeHtml(formatCapacityDays(entry.capacityDays))}</p>
      <p><strong>Aktueller Saldo:</strong> ${escapeHtml(entry.capacityHours > 0 ? formatSignedHoursValue(entry.hourBalance) : "Kein Wochenrahmen gesetzt")}</p>
      <p><strong>Ueberstundenbank:</strong> ${escapeHtml(formatSignedHoursValue(entry.overtimeBankHours || 0))}</p>
      ${entry.overtimeHours > 0 ? `<p class="helper-text"><strong>Diese Woche ueber Soll:</strong> ${escapeHtml(formatHoursValue(entry.overtimeHours))}</p>` : ""}
      ${entry.previousWeekOvertimeHours > 0 ? `<p class="helper-text"><strong>Letzte Woche ueber Soll:</strong> ${escapeHtml(formatHoursValue(entry.previousWeekOvertimeHours))}</p>` : ""}
      ${Math.abs(entry.overtimeAdjustmentHours || 0) > 0.001 ? `<p class="helper-text"><strong>Ausgleich gebucht:</strong> ${escapeHtml(formatSignedHoursValue(entry.overtimeAdjustmentHours))}</p>` : ""}
      ${renderAvailabilitySlotList(entry.availabilitySlots, "Noch keine festen Wochenslots eingetragen.")}
      ${
        entry.availabilitySchedule
          ? `<p><strong>Hinweise:</strong> ${escapeHtml(entry.availabilitySchedule)}</p>`
          : ""
      }
      ${entry.availabilityUpdatedAt ? `<p class="timeline-meta">Zuletzt aktualisiert: ${escapeHtml(formatDateTime(entry.availabilityUpdatedAt))}</p>` : ""}
      ${
        plannedDelta === null && dayDelta === null
          ? entry.availabilitySchedule || entry.hasAvailabilitySlots
            ? '<p class="helper-text">Zeitfenster ist eingetragen, aber noch ohne Stunden- oder Tagesrahmen.</p>'
            : '<p class="helper-text">Diese Person hat noch keine Wochen-Kapazitaet im Profil hinterlegt.</p>'
          : `<p class="helper-text">${escapeHtml(buildCapacityDeltaText(plannedDelta, dayDelta))}</p>`
      }
      ${renderOvertimeAdjustmentHistory(entry.recentOvertimeAdjustments || [])}
      ${renderOvertimeAdjustmentForm(entry)}
    </article>
  `;
}

function renderOvertimeAdjustmentHistory(adjustments) {
  if (!adjustments.length) {
    return '<p class="helper-text">Noch kein manueller Ueberstunden-Ausgleich gebucht.</p>';
  }

  return `
    <div class="overtime-adjustment-history">
      ${adjustments
        .map(
          (entry) => `
            <article class="mini-card overtime-adjustment-entry">
              <div class="status-row">
                <span class="pill ${Number(entry.hours || 0) < 0 ? "amber" : "sky"}">${escapeHtml(formatSignedHoursValue(entry.hours || 0))}</span>
                <span class="timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
              </div>
              <p class="timeline-meta">von ${escapeHtml(getOvertimeAdjustmentActorName(entry.createdBy))}</p>
              ${entry.note ? `<p class="helper-text">${escapeHtml(entry.note)}</p>` : ""}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderOvertimeAdjustmentForm(entry) {
  if (!canCoordinateStaff()) return "";

  return `
    <form class="stack-form compact-form overtime-adjustment-form" data-form="overtime-adjustment" data-user-id="${escapeHtml(entry.user.id)}">
      <div class="section-head compact-section-head">
        <div>
          <p class="eyebrow">Ausgleich</p>
          <h3>Ueberstunden verbuchen</h3>
        </div>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="overtimeMode-${escapeHtml(entry.user.id)}">Aktion</label>
          <select id="overtimeMode-${escapeHtml(entry.user.id)}" name="mode">
            <option value="deduct">Von der Bank abziehen</option>
            <option value="credit">Zur Bank hinzufuegen</option>
          </select>
        </div>
        <div class="field">
          <label for="overtimeHours-${escapeHtml(entry.user.id)}">Stunden</label>
          <input id="overtimeHours-${escapeHtml(entry.user.id)}" name="hours" type="number" min="0.5" max="168" step="0.5" placeholder="z. B. 8" required>
        </div>
        <div class="field span-all">
          <label for="overtimeNote-${escapeHtml(entry.user.id)}">Notiz</label>
          <textarea id="overtimeNote-${escapeHtml(entry.user.id)}" name="note" placeholder="z. B. freie Woche, Event-Ausgleich oder manuelle Korrektur"></textarea>
        </div>
      </div>
      <p class="helper-text">Wenn jemand Ueberstunden abbummelt, buchst du hier den Abzug. So bleibt die Bank sauber und du verlierst den Ueberblick nicht.</p>
      <button type="submit" class="small">Ueberstunden buchen</button>
    </form>
  `;
}

function renderAvailabilityReminderPanel() {
  const user = state.session;
  if (!user || user.role === "member") return "";

  const hasAvailability = Boolean(user.availabilitySchedule || Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0));
  const availabilitySlots = getAvailabilitySlots(user);
  const hasStructuredAvailability = hasAvailabilitySlots(availabilitySlots);
  const hasAnyAvailability = Boolean(hasAvailability || hasStructuredAvailability);
  const updatedLabel = user.availabilityUpdatedAt ? formatDateTime(user.availabilityUpdatedAt) : "";

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Verfuegbarkeit</p>
          <h2>Trage deine freien Zeiten direkt hier ein</h2>
          <p class="section-copy">Damit die Auslastung funktioniert, brauchen wir nicht nur Stunden, sondern auch konkrete Zeitfenster. Du kannst das hier direkt speichern, ohne erst ins Profil wechseln zu muessen.</p>
        </div>
        <button type="button" class="ghost small" data-action="set-tab" data-tab="profile">Zum Profil</button>
      </div>

      <p class="pill-note">${escapeHtml(hasAnyAvailability ? "Deine Verfuegbarkeit ist schon hinterlegt. Passe sie hier an, sobald sich fuer die kommende Woche etwas aendert." : "Aktuell fehlt deine Verfuegbarkeit noch. Bitte trage sie direkt hier ein, damit die Leitung dich sinnvoll einplanen kann.")}</p>

      <form class="stack-form" data-form="availability-update">
        <div class="availability-form-shell">
          <div class="availability-form-head">
            <div>
              <p class="eyebrow">Staff-Planung</p>
              <h3>Dein Wochenrahmen</h3>
              <p class="helper-text">Trage deine Woche direkt pro Tag ein. Zusatztipps oder Sonderfaelle kannst du darunter noch als Freitext notieren.</p>
            </div>
            <span class="pill ${hasAnyAvailability ? "success" : "rose"}">${escapeHtml(hasAnyAvailability ? "Eingetragen" : "Bitte ausfuellen")}</span>
          </div>
          <div class="availability-form-grid">
            <div class="field">
              <label for="dashboardWeeklyHoursCapacity">Verfuegbare Stunden pro Woche</label>
              <input id="dashboardWeeklyHoursCapacity" name="weeklyHoursCapacity" type="number" min="0" max="168" step="0.5" value="${escapeHtml(String(user.weeklyHoursCapacity || ""))}" placeholder="z. B. 12">
            </div>
            <div class="field">
              <label for="dashboardWeeklyDaysCapacity">Verfuegbare Tage pro Woche</label>
              <input id="dashboardWeeklyDaysCapacity" name="weeklyDaysCapacity" type="number" min="0" max="7" step="1" value="${escapeHtml(String(user.weeklyDaysCapacity || ""))}" placeholder="z. B. 3">
            </div>
            <div class="field span-all">
              <label>Wochen-Slots</label>
              ${renderAvailabilitySlotsEditor(availabilitySlots, "dashboard-availability")}
              <p class="helper-text">Das ist die eigentliche Verfuegbarkeit fuer die Leitung. So sieht man sauber pro Tag, wann du wirklich kannst.</p>
            </div>
            <div class="field span-all">
              <label for="dashboardAvailabilitySchedule">Zusatzhinweise fuer diese Woche</label>
              <textarea id="dashboardAvailabilitySchedule" name="availabilitySchedule" placeholder="z. B. Mittwoch eventuell spaeter, Samstag nur spontan oder Sonntag nur fuer kurze Absprachen.">${escapeHtml(user.availabilitySchedule || "")}</textarea>
              <p class="helper-text">Hier kommen nur noch Sonderfaelle, Erlaeuterungen oder flexible Hinweise rein.</p>
            </div>
          </div>
        </div>
        <div class="card-actions">
          <button type="submit">Verfuegbarkeit speichern</button>
          <button type="button" class="ghost small" data-action="set-tab" data-tab="profile">Vollstaendiges Profil oeffnen</button>
        </div>
        ${updatedLabel ? `<p class="timeline-meta">Zuletzt gespeichert: ${escapeHtml(updatedLabel)}</p>` : ""}
      </form>
    </section>
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
  const showAvailabilityFields = user.role !== "member";

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

function renderProfileFallback(managerView, error = null) {
  const user = state.session || {};
  const draftKey = "profile-update:";
  const showAvailabilityFields = user.role !== "member";
  const availabilitySlots = getAvailabilitySlots(user);
  const creatorApplication = getCreatorApplicationMeta(user);

  return `
    <section class="panel ${managerView ? "span-12" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Profil</p>
          <h2>Dein Community-Profil</h2>
          <p class="section-copy">Diese abgesicherte Profilansicht bleibt bewusst einfacher, damit Profil und Verfuegbarkeit auf jeden Fall erreichbar bleiben.</p>
        </div>
      </div>

      ${
        error
          ? `<div class="flash flash-warning"><span>${escapeHtml(`Die erweiterte Profilansicht konnte gerade nicht geladen werden. Die Basisfelder bleiben trotzdem verfuegbar. (${error.message || "Profilfehler"})`)}</span></div>`
          : ""
      }

      <div class="profile-panel">
        <div class="profile-preview">
          ${renderUserAvatar(user, "hero-avatar")}
          <div>
            <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
            <p class="timeline-meta">VRChat: ${escapeHtml(user.vrchatName || "-")} | Discord: ${escapeHtml(user.discordName || "-")}</p>
            ${user.bio ? `<p class="helper-text">${escapeHtml(user.bio)}</p>` : ""}
            ${user.contactNote ? `<p class="helper-text">${escapeHtml(user.contactNote)}</p>` : ""}
            ${showAvailabilityFields ? renderAvailabilitySlotList(availabilitySlots, "Noch keine Zeitfenster eingetragen.") : ""}
          </div>
        </div>

        <form class="stack-form" data-form="profile-update">
          <div class="form-grid">
            <div class="field">
              <label for="profileVrchatNameFallback">VRChat-Name</label>
              <input id="profileVrchatNameFallback" name="vrchatName" type="text" value="${escapeHtml(user.vrchatName || "")}" required>
            </div>
            <div class="field">
              <label for="profileDiscordNameFallback">Discord-Name</label>
              <input id="profileDiscordNameFallback" name="discordName" type="text" value="${escapeHtml(user.discordName || "")}" required>
            </div>
            <div class="field">
              <label for="profileAvatarFileFallback">Profilbild</label>
              <input id="profileAvatarFileFallback" name="avatarFile" type="file" accept="image/*">
              ${renderAvatarDraftHint(draftKey, Boolean(user.avatarUrl))}
            </div>
            <div class="field">
              <label for="profilePasswordFallback">Neues Passwort</label>
              <input id="profilePasswordFallback" name="password" type="password" placeholder="Leer lassen = behalten">
            </div>
            <div class="field span-all">
              <label for="profileBioFallback">Kurzprofil</label>
              <textarea id="profileBioFallback" name="bio">${escapeHtml(user.bio || "")}</textarea>
            </div>
            <div class="field span-all">
              <label for="profileContactNoteFallback">Kontakt / Hinweise</label>
              <textarea id="profileContactNoteFallback" name="contactNote">${escapeHtml(user.contactNote || "")}</textarea>
            </div>
            ${
              showAvailabilityFields
                ? `
                  <div class="field">
                    <label for="profileWeeklyHoursCapacityFallback">Verfuegbare Stunden pro Woche</label>
                    <input id="profileWeeklyHoursCapacityFallback" name="weeklyHoursCapacity" type="number" min="0" max="168" step="0.5" value="${escapeHtml(String(user.weeklyHoursCapacity || ""))}">
                  </div>
                  <div class="field">
                    <label for="profileWeeklyDaysCapacityFallback">Verfuegbare Tage pro Woche</label>
                    <input id="profileWeeklyDaysCapacityFallback" name="weeklyDaysCapacity" type="number" min="0" max="7" step="1" value="${escapeHtml(String(user.weeklyDaysCapacity || ""))}">
                  </div>
                  <div class="field span-all">
                    <label>Zeitfenster fuer diese Woche</label>
                    ${renderAvailabilitySlotsEditor(availabilitySlots, "profile-fallback-availability")}
                  </div>
                  <div class="field span-all">
                    <label for="profileAvailabilityScheduleFallback">Zusatzhinweise</label>
                    <textarea id="profileAvailabilityScheduleFallback" name="availabilitySchedule">${escapeHtml(user.availabilitySchedule || "")}</textarea>
                  </div>
                `
                : ""
            }
            <div class="field">
              <label for="profileCreatorBlurbFallback">Creator-Text</label>
              <input id="profileCreatorBlurbFallback" name="creatorBlurb" type="text" value="${escapeHtml(user.creatorBlurb || "")}">
            </div>
            ${
              creatorApplication.approved
                ? `
                  <div class="field">
                    <label for="profileCreatorVisibleFallback">Im Creator-Bereich zeigen</label>
                    <input id="profileCreatorVisibleFallback" name="creatorVisible" type="checkbox" ${user.creatorVisible ? "checked" : ""}>
                  </div>
                `
                : ""
            }
            <div class="field span-all">
              <label for="profileCreatorCommunityNameFallback">Community-Name</label>
              <input id="profileCreatorCommunityNameFallback" name="creatorCommunityName" type="text" value="${escapeHtml(user.creatorCommunityName || "")}">
            </div>
            <div class="field">
              <label for="profileCreatorSlugFallback">Slash-Adresse</label>
              <input id="profileCreatorSlugFallback" name="creatorSlug" type="text" value="${escapeHtml(user.creatorSlug || "")}">
            </div>
            <div class="field">
              <label for="profileCreatorCommunityInviteUrlFallback">Einstiegslink</label>
              <input id="profileCreatorCommunityInviteUrlFallback" name="creatorCommunityInviteUrl" type="url" value="${escapeHtml(user.creatorCommunityInviteUrl || "")}">
            </div>
            <div class="field span-all">
              <label for="profileCreatorCommunitySummaryFallback">Kurzbeschreibung deiner Community</label>
              <textarea id="profileCreatorCommunitySummaryFallback" name="creatorCommunitySummary">${escapeHtml(user.creatorCommunitySummary || "")}</textarea>
            </div>
            <div class="field">
              <label for="profileCreatorPresenceFallback">Sonara Live Status</label>
              <select id="profileCreatorPresenceFallback" name="creatorPresence">
                <option value="offline" ${user.creatorPresence === "offline" ? "selected" : ""}>Zurzeit ruhig</option>
                <option value="live" ${user.creatorPresence === "live" ? "selected" : ""}>Ich bin gerade live</option>
                <option value="new-release" ${user.creatorPresence === "new-release" ? "selected" : ""}>Ich habe etwas Neues hochgeladen</option>
              </select>
            </div>
            <div class="field">
              <label for="profileCreatorPresenceUrlFallback">Direkter Link</label>
              <input id="profileCreatorPresenceUrlFallback" name="creatorPresenceUrl" type="url" value="${escapeHtml(user.creatorPresenceUrl || "")}">
            </div>
            <div class="field span-all">
              <label for="profileCreatorPresenceTextFallback">Kurztext fuer Sonara Live</label>
              <textarea id="profileCreatorPresenceTextFallback" name="creatorPresenceText">${escapeHtml(user.creatorPresenceText || "")}</textarea>
            </div>
            <div class="field span-all">
              <label for="profileCreatorLinksFallback">Creator-Links</label>
              <textarea id="profileCreatorLinksFallback" name="creatorLinks">${escapeHtml(renderCreatorLinksText(user))}</textarea>
            </div>
          </div>
          <button type="submit">Profil speichern</button>
        </form>
      </div>
    </section>
  `;
}

function renderProfileWorkspace(managerView) {
  try {
    return renderProfilePanel(managerView);
  } catch (error) {
    console.error("Profilansicht konnte nicht geladen werden:", error);
    return renderProfileFallback(managerView, error);
  }
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
      const vrchatLink = getVrchatLinkFlowMeta();
      const succeeded = await performAction(
        () =>
          api("/api/login", {
            method: "POST",
            body: JSON.stringify({
              identifier: formData.get("identifier"),
              password: formData.get("password"),
              linkSource: vrchatLink?.source || ""
            })
          }),
        vrchatLink ? "VRChat-Verknuepfung abgeschlossen. Du bist jetzt im Portal." : "Willkommen im Portal."
      );
      if (succeeded && vrchatLink) {
        completeVrchatLinkFlow();
        render();
      }
      break;
    }

    case "register": {
      const formData = new FormData(form);
      const vrchatLink = getVrchatLinkFlowMeta();
      const password = String(formData.get("password") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (password !== confirmPassword) {
        setFlash("Die Passwoerter stimmen nicht ueberein.", "danger");
        render();
        return;
      }

      const avatarUrl = await readImageFileInput(form.querySelector('input[name="avatarFile"]'));
      const succeeded = await performAction(
        () =>
          api("/api/register", {
            method: "POST",
            body: JSON.stringify({
              vrchatName: formData.get("vrchatName"),
              discordName: formData.get("discordName"),
              bio: formData.get("bio"),
              avatarUrl: avatarUrl || "",
              password,
              linkSource: vrchatLink?.source || ""
            })
          }),
        vrchatLink ? "Konto wurde erstellt und direkt mit deinem VRChat-Link verbunden." : "Zugang wurde erstellt."
      );
      if (succeeded && vrchatLink) {
        completeVrchatLinkFlow();
        render();
      }
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

    case "chat-clear": {
      const channel = String(form.dataset.channel || "community");
      const label = channel === "staff" ? "Staff-Chat" : "Community-Chat";
      if (!window.confirm(`Den ${label} wirklich komplett leeren?`)) {
        return;
      }

      await performAction(
        () =>
          api("/api/chat/clear", {
            method: "POST",
            body: JSON.stringify({ channel })
          }),
        `${label} wurde komplett geleert.`,
        "warning"
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
              imageUrl: imageUrl || "",
              creatorCommunityId: formData.get("creatorCommunityId")
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

    case "direct-message-clear": {
      if (!window.confirm("Alle Direktnachrichten wirklich komplett leeren?")) {
        return;
      }

      await performAction(
        () =>
          api("/api/direct-messages/clear", {
            method: "POST",
            body: "{}"
          }),
        "Alle Direktnachrichten wurden entfernt.",
        "warning"
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

    case "availability-update": {
      const { payload } = buildAvailabilityPayload(form);
      await performAction(
        () =>
          api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Verfuegbarkeit wurde aktualisiert."
      );
      break;
    }

    case "overtime-adjustment": {
      const userId = form.dataset.userId;
      const formData = new FormData(form);
      const mode = String(formData.get("mode") || "deduct");
      await performAction(
        () =>
          api(`/api/admin/users/${encodeURIComponent(userId)}/overtime-adjustments`, {
            method: "POST",
            body: JSON.stringify({
              mode,
              hours: formData.get("hours"),
              note: formData.get("note")
            })
          }),
        mode === "deduct" ? "Ueberstunden-Ausgleich wurde abgezogen." : "Ueberstunden wurden gutgeschrieben."
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
    const summaryRows = buildAttendanceSummaryRows();

    return `
      <section class="panel span-12">
        <div class="section-head">
          <div>
            <p class="eyebrow">Stempelzeiten</p>
            <h2>Wer arbeitet gerade und wer hat seine Schicht gemacht?</h2>
          </div>
        </div>

        <div class="attendance-summary-grid">
          ${
            summaryRows.length
              ? summaryRows.map((entry) => renderAttendanceSummaryCard(entry)).join("")
              : renderEmptyState("Noch keine Stunden", "Sobald das Team Zeiten stempelt, erscheinen hier Wochen- und Tageswerte pro Person.")
          }
        </div>

        <div class="attendance-admin-grid">
          <div class="stack-list attendance-column">
            <h3>Gerade aktiv</h3>
            ${
              liveEntries.length
                ? liveEntries.map((entry) => renderActiveEntry(entry, false)).join("")
                : renderEmptyState("Niemand aktiv", "Sobald jemand einstempelt, wird er hier gelistet.")
            }
          </div>

          <div class="stack-list attendance-column">
            <h3>Letzte Stempelungen</h3>
            ${history.length ? history.map((entry) => renderTimeEntry(entry, false)).join("") : renderEmptyState("Noch keine Eintraege", "Sobald Einsaetze gestempelt wurden, erscheinen sie hier.")}
          </div>

          <div class="stack-list attendance-column">
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
    <section class="panel span-12 attendance-member-panel">
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

function renderAttendanceSummaryCard(entry) {
  return `
    <article class="mini-card attendance-summary-card">
      <div class="status-row">
        <span class="pill ${entry.overtimeHours > 0 || entry.overtimeBankHours > 0 ? "rose" : entry.liveEntry ? "teal" : "neutral"}">${escapeHtml(entry.overtimeHours > 0 ? "Ueber Soll" : entry.liveEntry ? "Live" : "Diese Woche")}</span>
        <span class="timeline-meta">${escapeHtml(ROLE_LABELS[entry.user.role] || entry.user.role)}</span>
      </div>
      <h3>${escapeHtml(getPrimaryDisplayName(entry.user))}</h3>
      <p><strong>Diese Woche:</strong> ${escapeHtml(formatHoursValue(entry.weekHours))}</p>
      <p><strong>Letzte Woche:</strong> ${escapeHtml(formatHoursValue(entry.previousWeekHours || 0))}${entry.capacityHours > 0 ? ` | ${escapeHtml(formatSignedHoursValue(entry.previousWeekBalanceHours || 0))}` : ""}</p>
      <p><strong>Heute:</strong> ${escapeHtml(formatHoursValue(entry.todayHours))}</p>
      <p><strong>Wochenrahmen:</strong> ${escapeHtml(entry.capacityHours > 0 ? formatHoursValue(entry.capacityHours) : "Keine Angabe")}</p>
      <p><strong>Aktueller Saldo:</strong> ${escapeHtml(entry.capacityHours > 0 ? formatSignedHoursValue(entry.balanceHours) : "Kein Soll gesetzt")}</p>
      <p><strong>Ueberstundenbank:</strong> ${escapeHtml(formatSignedHoursValue(entry.overtimeBankHours || 0))}</p>
      ${
        entry.overtimeHours > 0
          ? `<p class="helper-text">Diese Person liegt aktuell ${escapeHtml(formatHoursValue(entry.overtimeHours))} ueber ihrem Wochenrahmen.</p>`
          : entry.previousWeekOvertimeHours > 0
            ? `<p class="helper-text">Letzte Woche kamen ${escapeHtml(formatHoursValue(entry.previousWeekOvertimeHours))} an Ueberstunden zusammen.</p>`
          : entry.liveEntry
            ? `<p class="helper-text">Aktiv seit ${escapeHtml(formatTime(entry.liveEntry.checkInAt))}</p>`
          : '<p class="helper-text">Aktuell nicht eingestempelt.</p>'
      }
      ${Math.abs(entry.overtimeAdjustmentHours || 0) > 0.001 ? `<p class="helper-text">Ausgleich bisher ${escapeHtml(formatSignedHoursValue(entry.overtimeAdjustmentHours))}.</p>` : ""}
    </article>
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
        <p class="timeline-meta">${escapeHtml(`${formatShiftWindow(entry)} | ${entry.shiftType} | ${entry.world} | ${entry.task}`)}</p>
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
      <p>${escapeHtml(entry.shift ? `${formatShiftWindow(entry.shift)} | ${entry.shift.shiftType} | ${entry.shift.world} | ${entry.shift.task}` : "Schicht wurde geloescht")}</p>
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
      <p>${escapeHtml(entry.shift ? `${formatShiftWindow(entry.shift)} | ${entry.shift.shiftType} | ${entry.shift.world}` : "Keine Schichtreferenz mehr")}</p>
      <p class="timeline-meta">${escapeHtml(`${formatTime(entry.checkInAt)} bis ${entry.checkOutAt ? formatTime(entry.checkOutAt) : "offen"}`)}</p>
    </article>
  `;
}

function renderSettingsPanel() {
  const notice = state.data?.systemNotice || {
    enabled: false,
    tone: "warning",
    title: "",
    body: "",
    contactHint: "",
    updatedAt: "",
    updatedByName: ""
  };

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

    <section class="panel span-8">
      <div class="section-head">
        <div>
          <p class="eyebrow">Systemhinweis</p>
          <h2>Hinweis bei Stoerungen oder Ausfaellen</h2>
          <p class="section-copy">Wenn etwas im Portal hakt, kannst du hier sofort eine sichtbare Nachricht fuer alle setzen, inklusive kurzer Kontaktinfo.</p>
        </div>
        ${
          notice.enabled
            ? `<span class="pill ${notice.tone === "danger" ? "rose" : notice.tone === "info" ? "sky" : "amber"}">Aktiv</span>`
            : '<span class="pill neutral">Inaktiv</span>'
        }
      </div>

      <form class="stack-form" data-form="system-notice">
        <div class="form-grid">
          <div class="field">
            <label for="systemNoticeTitle">Titel</label>
            <input id="systemNoticeTitle" name="title" type="text" value="${escapeHtml(notice.title || "")}" placeholder="z. B. Kurzfristiger Hinweis zum Portal">
          </div>
          <div class="field">
            <label for="systemNoticeTone">Ton</label>
            <select id="systemNoticeTone" name="tone">
              <option value="info" ${notice.tone === "info" ? "selected" : ""}>Info</option>
              <option value="warning" ${notice.tone === "warning" ? "selected" : ""}>Warnung</option>
              <option value="danger" ${notice.tone === "danger" ? "selected" : ""}>Stoerung</option>
            </select>
          </div>
          <div class="field span-all">
            <label for="systemNoticeBody">Nachricht</label>
            <textarea id="systemNoticeBody" name="body" placeholder="z. B. Das Profil speichert gerade nicht sauber. Bitte meldet euch bis zum Fix direkt privat bei mir.">${escapeHtml(notice.body || "")}</textarea>
          </div>
          <div class="field span-all">
            <label for="systemNoticeContact">Kontakt-Hinweis</label>
            <input id="systemNoticeContact" name="contactHint" type="text" value="${escapeHtml(notice.contactHint || "")}" placeholder="z. B. Wenn etwas klemmt, bitte mir direkt auf Discord schreiben.">
          </div>
          <div class="field checkbox-field">
            <label class="checkbox-row" for="systemNoticeEnabled">
              <input id="systemNoticeEnabled" name="enabled" type="checkbox" ${notice.enabled ? "checked" : ""}>
              <span>Systemhinweis sichtbar schalten</span>
            </label>
            <p class="helper-text">Sobald aktiv, taucht der Hinweis oben im Portal und auf der oeffentlichen Seite auf.</p>
          </div>
        </div>

        ${
          notice.updatedAt
            ? `<p class="timeline-meta">Zuletzt aktualisiert: ${escapeHtml(formatDateTime(notice.updatedAt))}${notice.updatedByName ? ` von ${escapeHtml(notice.updatedByName)}` : ""}</p>`
            : ""
        }

        <div class="card-actions">
          <button type="submit">Systemhinweis speichern</button>
          ${
            notice.enabled
              ? '<button type="button" class="ghost small" data-action="clear-system-notice">Hinweis entfernen</button>'
              : ""
          }
        </div>
      </form>
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

    case "system-notice": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/system-notice", {
            method: "PUT",
            body: JSON.stringify({
              enabled: formData.get("enabled") === "on",
              tone: formData.get("tone"),
              title: formData.get("title"),
              body: formData.get("body"),
              contactHint: formData.get("contactHint")
            })
          }),
        "Systemhinweis wurde aktualisiert."
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

    case "availability-update": {
      const { payload } = buildAvailabilityPayload(form);
      await performAction(
        () =>
          api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Verfuegbarkeit wurde aktualisiert."
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

  const toggleCheckboxes = (selector, predicate) => {
    const form = actionElement.closest("form");
    if (!form) return false;
    const inputs = [...form.querySelectorAll(selector)];
    if (!inputs.length) return false;
    inputs.forEach((input) => {
      input.checked = typeof predicate === "function" ? Boolean(predicate(input)) : Boolean(predicate);
    });
    rememberPersistentFormDraft(form);
    return true;
  };

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

    case "set-creator-focus":
      state.ui.selectedCreatorId = actionElement.dataset.creatorId || "";
      render();
      break;

    case "clear-creator-focus":
      state.ui.selectedCreatorId = "";
      render();
      break;

    case "enable-browser-notifications":
      await requestBrowserNotificationPermission();
      render();
      break;

    case "refresh-vrchat-overview":
      setFlash("Die VRChat-Datei-Anbindung wurde entfernt.", "info");
      state.vrchatOverview = null;
      state.vrchatLoading = false;
      render();
      break;

    case "refresh-discord-status":
      setFlash("Der Discord-Webhook-Bereich wurde entfernt.", "info");
      state.discordStatus = null;
      state.discordLoading = false;
      render();
      break;

    case "run-discord-test":
      setFlash("Der Discord-Webhook-Bereich wurde entfernt.", "info");
      state.discordStatus = null;
      state.discordLoading = false;
      render();
      break;

    case "run-vrchat-sync":
      setFlash("Die VRChat-Datei-Anbindung wurde entfernt.", "info");
      state.vrchatOverview = null;
      state.vrchatLoading = false;
      render();
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

    case "bulk-select-all-members":
      toggleCheckboxes('input[name="memberIds"]', true);
      break;

    case "bulk-clear-members":
      toggleCheckboxes('input[name="memberIds"]', false);
      break;

    case "bulk-weekdays-workdays":
      toggleCheckboxes('input[name="weekdays"]', (input) => ["1", "2", "3", "4", "5"].includes(String(input.value)));
      break;

    case "bulk-weekdays-all":
      toggleCheckboxes('input[name="weekdays"]', true);
      break;

    case "bulk-weekdays-clear":
      toggleCheckboxes('input[name="weekdays"]', false);
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

    case "clear-system-notice":
      if (!window.confirm("Den sichtbaren Systemhinweis wirklich entfernen?")) return;
      await performAction(
        () =>
          api("/api/system-notice", {
            method: "DELETE"
          }),
        "Systemhinweis wurde entfernt.",
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

function isModerationLead() {
  return state.session?.role === "moderation_lead";
}

function canCoordinateStaff() {
  return canManagePortal() || isModerationLead();
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
  if (!canCoordinateStaff()) return "";
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

function getCreatorLinks(user) {
  return (Array.isArray(user?.creatorLinks) ? user.creatorLinks : [])
    .map((entry) => {
      if (typeof entry === "string") {
        const [left, ...rightParts] = entry.split("|");
        const url = String((rightParts.length ? rightParts.join("|") : left) || "").trim();
        const label = String((rightParts.length ? left : "") || "").trim() || url;
        return url ? { label, url } : null;
      }

      if (!entry || typeof entry !== "object") return null;
      const url = String(entry.url || "").trim();
      const label = String(entry.label || "").trim() || url;
      return url ? { label, url } : null;
    })
    .filter(Boolean);
}

function renderCreatorLinksText(user) {
  return getCreatorLinks(user)
    .map((entry) => `${entry.label} | ${entry.url}`)
    .join("\n");
}

function renderCreatorLinkList(user, compact = false) {
  const links = getCreatorLinks(user);
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

function truncateText(value, maxLength = 140) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatMultilineText(value) {
  return escapeHtml(String(value || "").trim()).replace(/\r?\n/g, "<br>");
}

function renderExpandableTextBlock(title, value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return `
    <details class="mystic-expander">
      <summary>${escapeHtml(title)}</summary>
      <div class="mystic-expander-body">
        <p class="helper-text">${formatMultilineText(text)}</p>
      </div>
    </details>
  `;
}

function renderCreatorCard(user, options = {}) {
  const { interactive = false, selected = false } = options;
  const creatorLinks = renderCreatorLinkList(user, true);
  const presence = getCreatorPresenceMeta(user);
  const community = getCreatorCommunityMeta(user);
  const publicPath = buildCreatorPublicPath(user);
  return `
    <article class="team-card creator-card ${selected ? "creator-card-active" : ""}">
      <div class="status-row">
        <span class="pill ${presence.tone}">${escapeHtml(presence.title)}</span>
        ${presence.updatedLabel ? `<span class="timeline-meta">${escapeHtml(presence.updatedLabel)}</span>` : ""}
      </div>
      <div class="profile-head">
        ${renderUserAvatar(user, "profile-avatar")}
        <div class="creator-card-copy">
          <h3>${escapeHtml(community.name)}</h3>
          <p class="timeline-meta">${escapeHtml(getPrimaryDisplayName(user))}</p>
        </div>
      </div>
      <div class="creator-presence-copy">
        <p class="helper-text">${escapeHtml(truncateText(community.summary, 150))}</p>
        ${
          presence.actionUrl
            ? `<a class="creator-action-link" href="${escapeHtml(presence.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(presence.actionLabel)}</a>`
            : ""
        }
      </div>
      ${
        creatorLinks
          ? `
            <div class="creator-card-links">
              <p class="creator-links-label">Plattformen</p>
              ${creatorLinks}
            </div>
          `
          : ""
      }
      ${
        interactive
          ? `
            <div class="card-actions">
              <button type="button" class="ghost small" data-action="set-creator-focus" data-creator-id="${escapeHtml(user.id)}">
                ${selected ? "Gerade im Fokus" : "Creator-Hub oeffnen"}
              </button>
              <a class="creator-action-link" href="${escapeHtml(publicPath)}">Slash-Seite</a>
            </div>
          `
          : `
            <div class="card-actions">
              <a class="creator-action-link" href="${escapeHtml(publicPath)}">Slash-Seite</a>
            </div>
          `
      }
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
      <p>${escapeHtml(reply.content || reply.body || "")}</p>
    </article>
  `;
}

function renderForumThreadCard(thread) {
  const body = thread.content || thread.body || "";
  return `
    <article class="forum-thread-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill sky">${escapeHtml(thread.category || "Allgemein")}</span>
          ${renderCreatorCommunityBadge(thread.creatorCommunityName)}
        </div>
        <span class="timeline-meta">${escapeHtml(formatDateTime(thread.createdAt))}</span>
      </div>
      <h3>${escapeHtml(thread.title)}</h3>
      <p class="timeline-meta">von ${escapeHtml(thread.authorName)}</p>
      <p>${escapeHtml(body)}</p>
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
          <p class="section-copy">Themen koennen allgemein bleiben oder direkt einer Creator-Community zugeordnet werden.</p>
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
          <div class="field">
            <label for="forumCreatorCommunityId">Creator-Community</label>
            <select id="forumCreatorCommunityId" name="creatorCommunityId">
              ${buildCreatorCommunityOptions("", true)}
            </select>
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
  const createDraftKey = "admin-user-create:";
  const pendingCreatorEntries = getCreatorReviewEntries(["pending"]);

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
                  ${renderAvatarDraftHint(createDraftKey, false)}
                </div>
                <div class="field">
                  <label for="newPassword">Startpasswort</label>
                  <input id="newPassword" name="password" type="password" required>
                </div>
                <div class="field">
                  <label for="newCreatorVisible">Nach Freigabe im Creator-Bereich zeigen</label>
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

      ${
        pendingCreatorEntries.length
          ? `
            <div class="creator-review-grid">
              ${pendingCreatorEntries.map((user) => renderCreatorReviewCard(user, "team-queue")).join("")}
            </div>
          `
          : ""
      }

      <div class="wide-team-grid">
        ${users
          .map((user) => {
            const updateDraftKey = `user-update:${user.id}`;
            const shiftCount = (state.data?.shifts || []).filter((entry) => entry.memberId === user.id).length;
            const requestCount = (state.data?.requests || []).filter((entry) => entry.userId === user.id && entry.status !== "beruecksichtigt").length;
            const creatorApplication = getCreatorApplicationMeta(user);
            const activityMeta = getUserActivityMeta(user);
            const availabilitySlots = getAvailabilitySlots(user);
            const compactBio = truncateText(user.bio, 140);
            const compactContact = truncateText(user.contactNote, 140);
            const availabilitySummary =
              user.role !== "member" && (Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0) || user.availabilitySchedule || hasAvailabilitySlots(availabilitySlots))
                ? `
                  <div class="team-user-availability">
                    ${(Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0)) ? `<p class="helper-text">Verfuegbar: ${escapeHtml(formatCapacityHours(user.weeklyHoursCapacity))} / ${escapeHtml(formatCapacityDays(user.weeklyDaysCapacity))}</p>` : ""}
                    ${renderAvailabilitySlotList(availabilitySlots, "")}
                    ${user.availabilitySchedule ? `<p class="helper-text"><strong>Hinweise:</strong> ${escapeHtml(user.availabilitySchedule)}</p>` : ""}
                  </div>
                `
                : "";
            const profileDetails = [
              user.bio ? renderExpandableTextBlock("Kurzprofil lesen", user.bio) : "",
              user.contactNote ? renderExpandableTextBlock("Kontakt und Hinweise", user.contactNote) : "",
              availabilitySummary
                ? `
                  <details class="mystic-expander">
                    <summary>Verfuegbarkeit ansehen</summary>
                    <div class="mystic-expander-body">
                      ${availabilitySummary}
                    </div>
                  </details>
                `
                : "",
              renderCreatorLinkList(user, true)
                ? `
                  <details class="mystic-expander">
                    <summary>Creator-Links</summary>
                    <div class="mystic-expander-body">
                      ${renderCreatorLinkList(user, true)}
                    </div>
                  </details>
                `
                : ""
            ]
              .filter(Boolean)
              .join("");

            return `
              <article class="request-card team-user-card">
                <div class="status-row">
                  <div class="chip-list">
                    <span class="pill ${user.role === "admin" ? "amber" : user.role === "planner" ? "sky" : user.role === "moderation_lead" ? "amber" : user.role === "moderator" ? "teal" : "neutral"}">${escapeHtml(ROLE_LABELS[user.role])}</span>
                    ${user.isBlocked ? '<span class="pill rose">Gesperrt</span>' : '<span class="pill success">Aktiv</span>'}
                    <span class="pill ${creatorApplication.tone}">${escapeHtml(creatorApplication.title)}</span>
                    <span class="pill ${activityMeta.tone}">${escapeHtml(activityMeta.title)}</span>
                  </div>
                  <span class="timeline-meta">${escapeHtml(String(shiftCount))} Schichten | ${escapeHtml(String(requestCount))} offen</span>
                </div>
                <div class="profile-head">
                  ${renderUserAvatar(user, "profile-avatar")}
                  <div class="team-user-copy">
                    <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
                    <p class="timeline-meta">Discord: ${escapeHtml(user.discordName || "-")}</p>
                    <p class="timeline-meta">Zuletzt online: ${escapeHtml(activityMeta.seenLabel)}</p>
                    <p class="timeline-meta">Letzter Login: ${escapeHtml(activityMeta.loginLabel)}</p>
                    ${user.isBlocked ? `<p class="helper-text"><strong>Gesperrt:</strong> ${escapeHtml(user.blockReason || "Kein Grund angegeben.")}</p>` : ""}
                    ${compactBio ? `<p class="helper-text team-user-teaser">${escapeHtml(compactBio)}</p>` : ""}
                    ${compactContact ? `<p class="helper-text team-user-teaser">${escapeHtml(compactContact)}</p>` : ""}
                    ${user.role !== "member" && (Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0)) ? `<p class="helper-text">Verfuegbar: ${escapeHtml(formatCapacityHours(user.weeklyHoursCapacity))} / ${escapeHtml(formatCapacityDays(user.weeklyDaysCapacity))}</p>` : ""}
                  </div>
                </div>
                ${profileDetails}

                ${
                  canManagePortal() && (creatorApplication.status !== "none" || user.creatorVisible)
                    ? `
                      <details class="mystic-expander editor-expander">
                        <summary>Creator-Pruefung ansehen</summary>
                        <div class="mystic-expander-body">
                          ${renderCreatorReviewCard(user, "team-card")}
                        </div>
                      </details>
                    `
                    : ""
                }

                ${
                  canManagePortal()
                    ? `
                      <details class="mystic-expander editor-expander">
                        <summary>Account bearbeiten</summary>
                        <div class="mystic-expander-body">
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
                                ${renderAvatarDraftHint(updateDraftKey, Boolean(user.avatarUrl))}
                              </div>
                              <div class="field">
                                <label for="password-${escapeHtml(user.id)}">Neues Passwort</label>
                                <input id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Leer lassen = behalten">
                              </div>
                              <div class="field">
                                <label for="creatorVisible-${escapeHtml(user.id)}">Nach Freigabe im Creator-Bereich zeigen</label>
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
                                user.role !== "member"
                                  ? `
                                    <div class="span-all availability-form-shell compact">
                                      <div class="availability-form-head">
                                        <div>
                                          <p class="eyebrow">Verfuegbarkeit</p>
                                          <h3>Wochenrahmen fuer die Planung</h3>
                                        </div>
                                      </div>
                                      <div class="availability-form-grid">
                                        <div class="field">
                                          <label for="weeklyHours-${escapeHtml(user.id)}">Stunden pro Woche</label>
                                          <input id="weeklyHours-${escapeHtml(user.id)}" name="weeklyHoursCapacity" type="number" min="0" max="168" step="0.5" value="${escapeHtml(String(user.weeklyHoursCapacity || ""))}">
                                        </div>
                                        <div class="field">
                                          <label for="weeklyDays-${escapeHtml(user.id)}">Tage pro Woche</label>
                                          <input id="weeklyDays-${escapeHtml(user.id)}" name="weeklyDaysCapacity" type="number" min="0" max="7" step="1" value="${escapeHtml(String(user.weeklyDaysCapacity || ""))}">
                                        </div>
                                        <div class="field span-all">
                                          <label>Wochen-Slots</label>
                                          ${renderAvailabilitySlotsEditor(availabilitySlots, `team-availability-${user.id}`)}
                                          <p class="helper-text">Bitte bis Samstag eintragen. Die Eingaben bleiben auch bei Live-Updates stabil bestehen.</p>
                                        </div>
                                        <div class="field span-all">
                                          <label for="availability-${escapeHtml(user.id)}">Zusatzhinweise fuer diese Woche</label>
                                          <textarea id="availability-${escapeHtml(user.id)}" name="availabilitySchedule" placeholder="z. B. Freitag spaeter oder Sonntag nur spontan.">${escapeHtml(user.availabilitySchedule || "")}</textarea>
                                        </div>
                                      </div>
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
                        </div>
                      </details>
                    `
                    : ""
                }

                ${
                  canCoordinateStaff() && user.id !== state.session?.id
                    ? `
                      <details class="mystic-expander editor-expander warning-expander">
                        <summary>Verwarnung senden</summary>
                        <div class="mystic-expander-body">
                          <form class="stack-form" data-form="warning-create" data-user-id="${escapeHtml(user.id)}">
                            <div class="field">
                              <label for="warning-${escapeHtml(user.id)}">Verwarnung an ${escapeHtml(getPrimaryDisplayName(user))}</label>
                              <textarea id="warning-${escapeHtml(user.id)}" name="reason" placeholder="Begruendung"></textarea>
                            </div>
                            <button type="submit" class="ghost small">Verwarnung senden</button>
                          </form>
                        </div>
                      </details>
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
            ${
              user.vrchatLinkedAt
                ? `<p class="helper-text">VRChat-Link aktiv seit ${escapeHtml(formatDateTime(user.vrchatLinkedAt))}${user.vrchatLinkSource ? ` ueber ${escapeHtml(formatVrchatLinkSourceLabel(user.vrchatLinkSource))}` : ""}.</p>`
                : ""
            }
            ${user.bio ? `<p class="helper-text">${escapeHtml(user.bio)}</p>` : ""}
            ${user.contactNote ? `<p class="helper-text">${escapeHtml(user.contactNote)}</p>` : ""}
            ${(Number(user.weeklyHoursCapacity || 0) || Number(user.weeklyDaysCapacity || 0)) ? `<p class="helper-text">Verfuegbar: ${escapeHtml(formatCapacityHours(user.weeklyHoursCapacity))} / ${escapeHtml(formatCapacityDays(user.weeklyDaysCapacity))}</p>` : ""}
            ${renderCreatorLinkList(user, true)}
          </div>
        </div>

        ${
          showAvailabilityFields
            ? `
              <article class="mini-card">
                <h3>Verfuegbarkeit fuer die Planung</h3>
                <p class="helper-text">Genau hier tragen Moderatoren und Leitung ihre freien Stunden, Tage und konkreten Zeitfenster fuer die kommende Woche ein. Diese Angaben landen danach direkt im Bereich Auslastung der Leitung.</p>
              </article>
            `
            : ""
        }

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
    renderIfFormIdle();
  });

  stream.addEventListener("chat", async () => {
    await refreshPortalDataFromBackground();
  });

  stream.addEventListener("portal", async () => {
    await refreshPortalDataFromBackground();
  });

  stream.addEventListener("error", () => {
    state.ui.liveChatConnected = false;
    closeChatStream(false);
    window.setTimeout(() => {
      if (!state.session) return;
      syncChatStream();
    }, 2500);
    renderIfFormIdle();
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
  const users = (state.data?.users || []).filter((entry) => entry.role !== "member");
  const week = getCurrentWeekRange();
  const today = getCurrentDayRange();

  return users
    .map((user) => {
      const overtime = buildUserOvertimeSummary(user);
      const workedHours = overtime.currentWeek.workedHours;
      const todayWorkedHours = calculateWorkedHoursForRange(user.id, today);
      const workedDays = calculateWorkedDaysForWeek(user.id, week);
      const plannedHours = calculatePlannedHoursForWeek(user.id, week);
      const plannedDays = calculatePlannedDaysForWeek(user.id, week);
      const capacityHours = Number(user.weeklyHoursCapacity || 0);
      const capacityDays = Number(user.weeklyDaysCapacity || 0);
      const availabilitySchedule = String(user.availabilitySchedule || "").trim();
      const availabilitySlots = getAvailabilitySlots(user);
      const hasAvailabilitySlotData = hasAvailabilitySlots(availabilitySlots);
      const availabilityUpdatedAt = String(user.availabilityUpdatedAt || "").trim();
      const hourBalance = overtime.currentWeek.balanceHours;
      const overtimeHours = overtime.currentWeek.overtimeHours;
      const overHours = capacityHours > 0 && plannedHours > capacityHours;
      const overDays = capacityDays > 0 && plannedDays > capacityDays;
      const fullyPlanned =
        (capacityHours > 0 && plannedHours >= capacityHours) ||
        (capacityDays > 0 && plannedDays >= capacityDays);
      const hasAvailability = Boolean(availabilitySchedule || hasAvailabilitySlotData || capacityHours || capacityDays);

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
        todayWorkedHours,
        workedDays,
        plannedHours,
        plannedDays,
        capacityHours,
        capacityDays,
        hourBalance,
        overtimeHours,
        previousWeekHours: overtime.previousWeek.workedHours,
        previousWeekBalanceHours: overtime.previousWeek.balanceHours,
        previousWeekOvertimeHours: overtime.previousWeek.overtimeHours,
        overtimeBankHours: overtime.bankHours,
        overtimeAccruedHours: overtime.accruedHours,
        overtimeAdjustmentHours: overtime.adjustmentHours,
        availableCompHours: overtime.availableCompHours,
        recentOvertimeAdjustments: overtime.recentAdjustments,
        availabilitySchedule,
        availabilitySlots,
        hasAvailabilitySlots: hasAvailabilitySlotData,
        availabilityUpdatedAt,
        statusLabel,
        statusTone
      };
    })
    .sort((left, right) => left.user.vrchatName.localeCompare(right.user.vrchatName, "de"));
}

function buildAttendanceSummaryRows() {
  const users = (state.data?.users || []).filter((entry) => entry.role !== "member");
  const week = getCurrentWeekRange();
  const today = getCurrentDayRange();
  const entries = state.data?.timeEntries || [];

  return users
    .map((user) => {
      const overtime = buildUserOvertimeSummary(user);
      const weekHours = overtime.currentWeek.workedHours;
      const capacityHours = Number(user.weeklyHoursCapacity || 0);
      const overtimeHours = overtime.currentWeek.overtimeHours;
      const balanceHours = overtime.currentWeek.balanceHours;

      return {
        user,
        weekHours,
        todayHours: calculateWorkedHoursForRange(user.id, today),
        capacityHours,
        overtimeHours,
        balanceHours,
        previousWeekHours: overtime.previousWeek.workedHours,
        previousWeekBalanceHours: overtime.previousWeek.balanceHours,
        previousWeekOvertimeHours: overtime.previousWeek.overtimeHours,
        overtimeBankHours: overtime.bankHours,
        overtimeAccruedHours: overtime.accruedHours,
        overtimeAdjustmentHours: overtime.adjustmentHours,
        recentOvertimeAdjustments: overtime.recentAdjustments,
        liveEntry: entries.find((entry) => entry.userId === user.id && !entry.checkOutAt) || null
      };
    })
    .sort(
      (left, right) =>
        Number(Boolean(right.liveEntry)) - Number(Boolean(left.liveEntry)) ||
        right.overtimeBankHours - left.overtimeBankHours ||
        right.overtimeHours - left.overtimeHours ||
        right.weekHours - left.weekHours ||
        getPrimaryDisplayName(left.user).localeCompare(getPrimaryDisplayName(right.user), "de")
    );
}

function getWeekRange(referenceDate = new Date()) {
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

function getCurrentWeekRange(referenceDate = new Date()) {
  return getWeekRange(referenceDate);
}

function getPreviousWeekRange(referenceDate = new Date()) {
  const currentWeek = getWeekRange(referenceDate);
  const previousWeekAnchor = new Date(currentWeek.start);
  previousWeekAnchor.setDate(previousWeekAnchor.getDate() - 1);
  return getWeekRange(previousWeekAnchor);
}

function getCurrentDayRange(referenceDate = new Date()) {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start,
    end,
    startKey: getLocalDateKey(start),
    endKey: getLocalDateKey(end)
  };
}

function getWeekRangeLabel(range) {
  const lastDay = new Date(range.end);
  lastDay.setDate(lastDay.getDate() - 1);
  return `${formatDate(range.startKey)} bis ${formatDate(getLocalDateKey(lastDay))}`;
}

function getAllTrackedWeekRangesForUser(userId, referenceDate = new Date()) {
  const entries = (state.data?.timeEntries || []).filter((entry) => entry.userId === userId);
  const currentWeek = getWeekRange(referenceDate);
  if (!entries.length) return [currentWeek];

  let earliest = null;
  for (const entry of entries) {
    const timestamp = new Date(entry.checkInAt);
    if (!Number.isFinite(timestamp.getTime())) continue;
    if (!earliest || timestamp < earliest) earliest = timestamp;
  }

  if (!earliest) return [currentWeek];

  const ranges = [];
  let cursor = getWeekRange(earliest).start;
  while (cursor < currentWeek.end) {
    const range = getWeekRange(cursor);
    ranges.push(range);
    cursor = new Date(range.end);
  }

  return ranges;
}

function getUserOvertimeAdjustments(user) {
  return Array.isArray(user?.overtimeAdjustments)
    ? user.overtimeAdjustments.filter((entry) => Math.abs(Number(entry?.hours || 0)) > 0.001)
    : [];
}

function getOvertimeAdjustmentActorName(actorId) {
  const actor = (state.data?.users || []).find((entry) => entry.id === actorId);
  return actor ? getPrimaryDisplayName(actor) : "Leitung";
}

function buildUserOvertimeSummary(user) {
  const capacityHours = Number(user?.weeklyHoursCapacity || 0);
  const currentWeek = getCurrentWeekRange();
  const previousWeek = getPreviousWeekRange();
  const trackedWeeks = getAllTrackedWeekRangesForUser(user.id);
  const weeklyRows = trackedWeeks.map((range) => {
    const workedHours = calculateWorkedHoursForWeek(user.id, range);
    const balanceHours = capacityHours > 0 ? workedHours - capacityHours : 0;
    const overtimeHours = capacityHours > 0 ? Math.max(0, balanceHours) : 0;

    return {
      ...range,
      label: getWeekRangeLabel(range),
      workedHours,
      balanceHours,
      overtimeHours
    };
  });

  const currentWeekRow =
    weeklyRows.find((entry) => entry.startKey === currentWeek.startKey) || {
      ...currentWeek,
      label: getWeekRangeLabel(currentWeek),
      workedHours: calculateWorkedHoursForWeek(user.id, currentWeek),
      balanceHours: capacityHours > 0 ? calculateWorkedHoursForWeek(user.id, currentWeek) - capacityHours : 0,
      overtimeHours: capacityHours > 0 ? Math.max(0, calculateWorkedHoursForWeek(user.id, currentWeek) - capacityHours) : 0
    };
  const previousWeekRow =
    weeklyRows.find((entry) => entry.startKey === previousWeek.startKey) || {
      ...previousWeek,
      label: getWeekRangeLabel(previousWeek),
      workedHours: calculateWorkedHoursForWeek(user.id, previousWeek),
      balanceHours: capacityHours > 0 ? calculateWorkedHoursForWeek(user.id, previousWeek) - capacityHours : 0,
      overtimeHours: capacityHours > 0 ? Math.max(0, calculateWorkedHoursForWeek(user.id, previousWeek) - capacityHours) : 0
    };

  const adjustments = getUserOvertimeAdjustments(user);
  const adjustmentHours = adjustments.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  const accruedHours = weeklyRows.reduce((sum, entry) => sum + entry.overtimeHours, 0);
  const bankHours = accruedHours + adjustmentHours;

  return {
    currentWeek: currentWeekRow,
    previousWeek: previousWeekRow,
    weeklyRows,
    accruedHours,
    adjustmentHours,
    bankHours,
    availableCompHours: Math.max(0, bankHours),
    recentAdjustments: adjustments.slice(0, 3)
  };
}

function calculateWorkedHoursForRange(userId, range) {
  return (state.data?.timeEntries || [])
    .filter((entry) => entry.userId === userId)
    .reduce((sum, entry) => sum + calculateEntryOverlapHours(entry, range), 0);
}

function calculateWorkedHoursForWeek(userId, week) {
  return calculateWorkedHoursForRange(userId, week);
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
  const start = timeToMinutes(shift.startTime || "");
  const end = timeToMinutes(shift.endTime || "");
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

function formatSignedHoursValue(value) {
  const numeric = Number(value || 0);
  if (Math.abs(numeric) < 0.001) return "0 Std.";
  return `${numeric > 0 ? "+" : "-"}${formatHoursValue(Math.abs(numeric))}`;
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

function getUserActivityMeta(user) {
  const lastSeenAt = String(user?.lastSeenAt || "");
  const lastLoginAt = String(user?.lastLoginAt || "");
  const lastSeenAtMs = Date.parse(lastSeenAt);
  const recentlyActive = Number.isFinite(lastSeenAtMs) && Date.now() - lastSeenAtMs <= 10 * 60 * 1000;

  return {
    tone: recentlyActive ? "success" : lastSeenAt ? "neutral" : "rose",
    title: recentlyActive ? "Vor Kurzem online" : lastSeenAt ? "Zuletzt online" : "Noch kein Besuch",
    seenLabel: lastSeenAt ? formatDateTime(lastSeenAt) : "Noch kein Aktivitaetssignal",
    loginLabel: lastLoginAt ? formatDateTime(lastLoginAt) : "Noch kein Login gespeichert"
  };
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
  return ["member", "moderator", "moderation_lead", "planner", "admin"]
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

      await performAction(
        () =>
          api("/api/planning/bulk-shifts", {
            method: "POST",
            body: JSON.stringify({ entries })
          }),
        `${entries.length} Schichten wurden gesammelt angelegt.`
      );
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

    case "chat-trim": {
      const channel = String(form.dataset.channel || "community");
      const count = Number(event.submitter?.value || 0);
      if (!CHAT_TRIM_OPTIONS.includes(count)) return;

      const label = channel === "staff" ? "Staff-Chat" : "Community-Chat";
      if (!window.confirm(`Die letzten ${count} Nachrichten im ${label} wirklich entfernen?`)) return;

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

    case "chat-clear": {
      const channel = String(form.dataset.channel || "community");
      const label = channel === "staff" ? "Staff-Chat" : "Community-Chat";
      if (!window.confirm(`Den ${label} wirklich komplett leeren?`)) return;

      await performAction(
        () =>
          api("/api/chat/clear", {
            method: "POST",
            body: JSON.stringify({ channel })
          }),
        `${label} wurde komplett geleert.`,
        "warning"
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

    case "direct-message-trim": {
      const count = Number(event.submitter?.value || 0);
      if (!CHAT_TRIM_OPTIONS.includes(count)) return;
      if (!window.confirm(`Die letzten ${count} Direktnachrichten wirklich entfernen?`)) return;

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

    case "direct-message-clear": {
      if (!window.confirm("Alle Direktnachrichten wirklich komplett leeren?")) return;

      await performAction(
        () =>
          api("/api/direct-messages/clear", {
            method: "POST",
            body: "{}"
          }),
        "Alle Direktnachrichten wurden entfernt.",
        "warning"
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
              imageUrl: imageUrl || "",
              creatorCommunityId: formData.get("creatorCommunityId")
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
      if (!window.confirm("Diesen Feed-Beitrag wirklich loeschen?")) return;

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

    case "forum-thread": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/forum-threads", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              category: formData.get("category"),
              body: formData.get("content"),
              creatorCommunityId: formData.get("creatorCommunityId")
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

    case "creator-application": {
      const formData = new FormData(form);
      await performAction(
        () =>
          api("/api/creator-application", {
            method: "POST",
            body: JSON.stringify({
              creatorPrimaryPlatform: formData.get("creatorPrimaryPlatform"),
              creatorFollowerCount: formData.get("creatorFollowerCount"),
              creatorProofUrl: formData.get("creatorProofUrl"),
              creatorApplicationNote: formData.get("creatorApplicationNote")
            })
          }),
        "Creator-Bewerbung wurde eingereicht."
      );
      break;
    }

    case "creator-review": {
      const userId = form.dataset.userId;
      const formData = new FormData(form);
      await performAction(
        () =>
          api(`/api/admin/creator-applications/${encodeURIComponent(userId)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: formData.get("status"),
              creatorPrimaryPlatform: formData.get("creatorPrimaryPlatform"),
              creatorFollowerCount: formData.get("creatorFollowerCount"),
              creatorProofUrl: formData.get("creatorProofUrl"),
              creatorApplicationNote: formData.get("creatorApplicationNote"),
              creatorReviewNote: formData.get("creatorReviewNote"),
              overrideMinimum: formData.get("overrideMinimum") === "on"
            })
          }),
        "Creator-Freigabe wurde aktualisiert."
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
              creatorCommunityName: payload.creatorCommunityName,
              creatorCommunitySummary: payload.creatorCommunitySummary,
              creatorCommunityInviteUrl: payload.creatorCommunityInviteUrl,
              creatorPresence: payload.creatorPresence,
              creatorPresenceText: payload.creatorPresenceText,
              creatorPresenceUrl: payload.creatorPresenceUrl,
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

    case "availability-update": {
      const { payload } = buildAvailabilityPayload(form);
      await performAction(
        () =>
          api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(payload)
          }),
        "Verfuegbarkeit wurde aktualisiert."
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
  return ["moderator", "moderation_lead", "planner", "admin"].includes(state.session?.role);
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

function getSystemNotice() {
  const notice = state.data?.systemNotice || state.publicData?.systemNotice || null;
  if (!notice?.enabled || !String(notice.body || "").trim()) return null;
  return notice;
}

function renderSystemNoticeBanner() {
  const notice = getSystemNotice();
  if (!notice) return "";

  const flashClass =
    notice.tone === "danger"
      ? "flash-danger"
      : notice.tone === "info"
        ? "flash-info"
        : "flash-warning";

  return `
    <section class="flash ${flashClass} system-notice-banner">
      <div class="system-notice-copy">
        <strong>${escapeHtml(notice.title || "Wichtiger Hinweis")}</strong>
        <span>${escapeHtml(notice.body)}</span>
        ${notice.contactHint ? `<span class="timeline-meta">${escapeHtml(notice.contactHint)}</span>` : ""}
        ${
          notice.updatedAt
            ? `<span class="timeline-meta">Aktualisiert ${escapeHtml(formatDateTime(notice.updatedAt))}${notice.updatedByName ? ` von ${escapeHtml(notice.updatedByName)}` : ""}</span>`
            : ""
        }
      </div>
    </section>
  `;
}

function getPublicRouteState() {
  const currentUrl = new URL(window.location.href);
  const pathname = String(currentUrl.pathname || "/").trim() || "/";
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const vrchatSource = normalizeVrchatLinkSourceValue(currentUrl.searchParams.get("source") || currentUrl.searchParams.get("vrchatLink"));
  const creatorMatch = normalizedPath.match(/^\/creator\/([^/]+)$/);
  if (creatorMatch) {
    return {
      kind: "creator",
      slug: decodeURIComponent(creatorMatch[1] || "").trim().toLowerCase(),
      vrchatSource: ""
    };
  }

  if (normalizedPath === "/vrchat-link") {
    return {
      kind: "vrchat-link",
      slug: "",
      vrchatSource
    };
  }

  return {
    kind: "home",
    slug: "",
    vrchatSource: ""
  };
}

function normalizeVrchatLinkSourceValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || ["1", "true", "yes", "browser"].includes(normalized)) return "vrchat-browser";
  if (["chat", "vrchat-chat"].includes(normalized)) return "vrchat-chat";
  if (["world", "vrchat-world"].includes(normalized)) return "vrchat-world";
  return "vrchat-browser";
}

function getVrchatLinkFlowMeta() {
  const route = getPublicRouteState();
  if (route.kind !== "vrchat-link") return null;

  const source = route.vrchatSource || "vrchat-browser";
  const variants = {
    "vrchat-browser": {
      eyebrow: "VRChat-Verknuepfung",
      title: "Mit SONARA verbinden",
      intro: "Wenn du aus VRChat kommst, melde dich hier an oder lege dein Konto an. Danach landest du direkt im Portal.",
      sourceLabel: "VRChat Browser"
    },
    "vrchat-chat": {
      eyebrow: "VRChat Chat-Link",
      title: "Chat-Link mit SONARA verbinden",
      intro: "Du bist ueber einen VRChat- oder Discord-Chat-Link hier gelandet. Logge dich ein, dann ist dein Portal direkt bereit.",
      sourceLabel: "Chat-Link"
    },
    "vrchat-world": {
      eyebrow: "VRChat Welt-Link",
      title: "Welt mit SONARA verbinden",
      intro: "Dieses Fenster wurde aus deiner Welt geoeffnet. Melde dich jetzt an, danach landest du automatisch in deinem Portal-Profil.",
      sourceLabel: "Welt-Panel"
    }
  };

  return {
    source,
    ...(variants[source] || variants["vrchat-browser"])
  };
}

function completeVrchatLinkFlow() {
  state.ui.activeTab = "profile";
  if (window.location.pathname === "/vrchat-link" && window.history?.replaceState) {
    window.history.replaceState({}, "", "/");
  }
}

function formatVrchatLinkSourceLabel(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "vrchat-chat") return "Chat-Link";
  if (normalized === "vrchat-world") return "Welt-Panel";
  if (normalized === "vrchat-browser") return "VRChat Browser";
  return "VRChat";
}

function buildCreatorPublicPath(user) {
  const slug = String(user?.creatorSlug || user?.creatorCommunityName || user?.vrchatName || "").trim().toLowerCase();
  return slug ? `/creator/${encodeURIComponent(slug)}` : "/";
}

function getPublicCreatorBySlug(slug) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) return null;
  return getCreatorEntries().find((entry) => String(entry.creatorSlug || "").trim().toLowerCase() === normalized) || null;
}

function getPublicCreatorFeedPosts(creatorId, limit = 6) {
  const source = (state.data?.feedPosts || state.publicData?.feedPosts || []).filter(
    (post) => post.creatorCommunityId === creatorId || post.authorId === creatorId
  );
  return Number.isFinite(limit) ? source.slice(0, limit) : source;
}

function getPublicCreatorThreads(creatorId, limit = 6) {
  const source = (state.data?.forumThreads || state.publicData?.forumThreads || []).filter(
    (thread) => thread.creatorCommunityId === creatorId || thread.authorId === creatorId
  );
  return Number.isFinite(limit) ? source.slice(0, limit) : source;
}

function renderCreatorPublicPage(creator) {
  const community = getCreatorCommunityMeta(creator);
  const presence = getCreatorPresenceMeta(creator);
  const feedPosts = getPublicCreatorFeedPosts(creator.id, 4);
  const forumThreads = getPublicCreatorThreads(creator.id, 4);
  const announcements = getAnnouncementFeed().slice(0, 3);

  return `
    <div class="app-shell">
      ${renderSonaraHero({
        eyebrow: "SONARA Creator",
        title: community.name,
        intro: community.summary,
        chips: [getPrimaryDisplayName(creator), presence.title, creator.creatorSlug ? `/creator/${creator.creatorSlug}` : ""].filter(Boolean)
      })}

      ${renderFlash()}
      ${renderSystemNoticeBanner()}

      <div class="dashboard-shell creator-public-shell">
        <section class="panel creator-public-summary">
          <div class="section-head">
            <div>
              <p class="eyebrow">Creator Seite</p>
              <h2>${escapeHtml(community.name)}</h2>
              <p class="section-copy">Das ist die eigene kleine Creator-Seite innerhalb von SONARA. Hier landen Einstieg, Status und die letzten Inhalte an einem festen Ort.</p>
            </div>
            <div class="chip-list">
              <span class="pill ${presence.tone}">${escapeHtml(presence.title)}</span>
              ${creator.creatorSlug ? `<span class="pill neutral">/creator/${escapeHtml(creator.creatorSlug)}</span>` : ""}
            </div>
          </div>

          <div class="creator-public-grid">
            <article class="mini-card">
              <div class="profile-head">
                ${renderUserAvatar(creator, "hero-avatar")}
                <div class="creator-card-copy">
                  <h3>${escapeHtml(getPrimaryDisplayName(creator))}</h3>
                  <p class="timeline-meta">${escapeHtml(creator.creatorBlurb || creator.contactNote || "Creator aus SONARA")}</p>
                </div>
              </div>
              <p class="helper-text">${escapeHtml(presence.summary)}</p>
              ${renderCreatorLinkList(creator, true)}
              <div class="creator-community-actions">
                ${
                  community.inviteUrl
                    ? `<a class="creator-action-link" href="${escapeHtml(community.inviteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(community.inviteLabel)}</a>`
                    : ""
                }
                ${
                  presence.actionUrl
                    ? `<a class="creator-action-link" href="${escapeHtml(presence.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(presence.actionLabel)}</a>`
                    : ""
                }
                <a class="creator-action-link" href="/">Zurueck zu Sonara</a>
              </div>
            </article>

            <article class="mini-card">
              <p class="eyebrow">Creator Feed</p>
              <h3>Letzte Momente</h3>
              <div class="stack-list compact-stack">
                ${
                  feedPosts.length
                    ? feedPosts.map((post) => renderCompactCreatorFeedPost(post)).join("")
                    : renderEmptyState("Noch keine Feed-Momente", "Sobald dieser Creator etwas teilt, landet es hier auf der Seite.")
                }
              </div>
            </article>
          </div>
        </section>

        <section class="panel span-12">
          <div class="section-head">
            <div>
              <p class="eyebrow">Themenraum</p>
              <h2>Threads aus dieser Creator-Ecke</h2>
            </div>
          </div>
          <div class="creator-public-columns">
            <div class="stack-list compact-stack">
              ${
                forumThreads.length
                  ? forumThreads.map((thread) => renderCompactCreatorForumThread(thread)).join("")
                  : renderEmptyState("Noch keine Themen", "Sobald diese Creator-Community eigene Themen bekommt, tauchen sie hier auf.")
              }
            </div>
            <div class="stack-list compact-stack">
              <div class="section-head compact-section-head">
                <div>
                  <p class="eyebrow">Sonara News</p>
                  <h3>Was rundherum laeuft</h3>
                </div>
              </div>
              ${
                announcements.length
                  ? announcements
                      .map(
                        (entry) => `
                          <article class="mini-card creator-community-activity-card">
                            <div class="status-row">
                              <span class="pill ${entry.pinned ? "amber" : "neutral"}">${entry.pinned ? "Wichtig" : "News"}</span>
                              <span class="timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
                            </div>
                            <h3>${escapeHtml(entry.title)}</h3>
                            <p class="helper-text">${escapeHtml(truncateText(entry.body, 220))}</p>
                          </article>
                        `
                      )
                      .join("")
                  : renderEmptyState("Noch keine News", "Sobald SONARA neue Hinweise veroeffentlicht, tauchen sie hier auf.")
              }
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderCreatorPublicNotFound(slug) {
  return `
    <div class="app-shell">
      ${renderSonaraHero({
        eyebrow: "Creator Seite",
        title: "Creator nicht gefunden",
        intro: "Entweder ist dieser Creator noch nicht freigegeben oder der Slash-Link stimmt noch nicht.",
        chips: slug ? [`/creator/${slug}`] : []
      })}
      <div class="auth-layout public-grid">
        <section class="panel">
          ${renderEmptyState("Diese Creator-Seite gibt es noch nicht", "Pruefe den Slug, warte auf die Creator-Freigabe oder geh zur Hauptseite zurueck.")}
          <div class="card-actions">
            <a class="creator-action-link" href="/">Zur Sonara Startseite</a>
          </div>
        </section>
      </div>
    </div>
  `;
}

function getChatFeed(mode = "community") {
  if (mode === "staff") {
    return state.data?.staffChatMessages || state.data?.chatMessages || [];
  }
  return state.data?.communityChatMessages || [];
}

function renderStatsStrip() {
  if (canCoordinateStaff()) {
    const memberCount = (state.data?.users || []).filter((entry) => entry.role === "member").length;
    const moderatorCount = (state.data?.users || []).filter((entry) => entry.role === "moderator" || entry.role === "moderation_lead").length;
    const liveEntries = (state.data?.timeEntries || []).filter((entry) => !entry.checkOutAt).length;
    const openRequests = (state.data?.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
    const nextWeekShifts = getSortedShifts(state.data?.shifts || []).filter((entry) => daysBetween(getLocalDateKey(), entry.date) <= 7);

    return `
      <section class="stats-strip">
        ${renderStatCard("Mitglieder", memberCount, "Registrierte Community-Accounts", "teal")}
        ${renderStatCard("Moderatoren", moderatorCount, "Aktive Staff-Mitglieder", "amber")}
        ${renderStatCard("Schichten", nextWeekShifts.length, "Eins\u00e4tze in den n\u00e4chsten 7 Tagen", "amber")}
        ${renderStatCard("Offenes Feedback", openRequests, "R\u00fcckmeldungen warten auf Sichtung", "rose")}
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
        ${renderStatCard("N\u00e4chste Schicht", nextShift ? `${formatDate(nextShift.date)} | ${formatShiftWindow(nextShift)}` : "-", nextShift ? `${nextShift.shiftType} | ${nextShift.world}` : "Noch nichts geplant", "teal")}
        ${renderStatCard("Meine Eins\u00e4tze", myShifts.length, "Aktuell in deinem Plan", "amber")}
        ${renderStatCard("Offene Notizen", openRequests, "R\u00fcckmeldungen mit offenem Status", "rose")}
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
      ${renderStatCard("Feedback", openRequests, "Deine offenen R\u00fcckmeldungen", "rose")}
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
  const eventDraft = getPersistentFormDraft("event-create") || {};
  const eventScheduleType = eventDraft.scheduleType === "weekly" ? "weekly" : "single";
  const singleEvent = eventScheduleType === "single";

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
  const route = getPublicRouteState();
  if (route.kind === "creator") {
    const creator = getPublicCreatorBySlug(route.slug);
    return creator ? renderCreatorPublicPage(creator) : renderCreatorPublicNotFound(route.slug);
  }

  const community = getCommunityData();
  const stats = community.stats || {};
  const creators = (community.creators || []).slice(0, 3);
  const vrchatLink = getVrchatLinkFlowMeta();
  const eyebrow = vrchatLink?.eyebrow || "SONARA Community Portal";
  const title = vrchatLink?.title || "Community, Team und Creator an einem Ort";
  const intro = vrchatLink?.intro || "News, Events, Creator-Links und der Mitgliederbereich liegen hier kompakt zusammen.";
  const chips = vrchatLink
    ? [vrchatLink.sourceLabel, `${stats.members || 0} Mitglieder`, "Portal-Link aktiv"]
    : [`${stats.members || 0} Mitglieder`, `${stats.liveCreators || 0} live`, `${(community.events || []).length} Events`];
  const loginButtonLabel = vrchatLink ? "Anmelden und verbinden" : "Einloggen";
  const registerButtonLabel = vrchatLink ? "Konto anlegen und verbinden" : "Zugang erstellen";

  return `
    <div class="app-shell">
      ${renderSonaraHero({
        eyebrow,
        title,
        intro,
        chips
      })}

      ${renderFlash()}
      ${renderSystemNoticeBanner()}

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
            vrchatLink
              ? `
                <article class="mini-card">
                  <div class="section-head compact-section-head">
                    <div>
                      <p class="eyebrow">VRChat Flow</p>
                      <h3>So laeuft die Verknuepfung</h3>
                    </div>
                    <span class="pill amber">${escapeHtml(vrchatLink.sourceLabel)}</span>
                  </div>
                  <p class="helper-text">1. Die Welt oder der Chat oeffnet diesen Link. 2. Du meldest dich hier an oder registrierst dich. 3. Danach landest du automatisch in deinem SONARA-Profil.</p>
                  <p class="helper-text">Die eigentliche Welt kann spaeter einfach genau diese URL oeffnen: <strong>/vrchat-link</strong> oder <strong>/vrchat-link?source=world</strong>.</p>
                </article>
              `
              : ""
          }

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

          ${renderLivePreviewPanel(4)}
        </section>

        <div class="auth-stack public-auth-stack">
          <form class="panel auth-card" data-form="login">
            <div>
              <p class="eyebrow">${vrchatLink ? "VRChat Login" : "Login"}</p>
              <h3>${vrchatLink ? "Mit deinem SONARA-Konto verbinden" : "Einloggen"}</h3>
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
            ${vrchatLink ? '<p class="login-note">Nach dem Login springst du direkt in dein Portal-Profil.</p>' : ""}
            <button type="submit">${loginButtonLabel}</button>
          </form>

          <form class="panel auth-card" data-form="register">
            <div>
              <p class="eyebrow">${vrchatLink ? "Neu verbinden" : "Registrierung"}</p>
              <h3>${vrchatLink ? "Noch kein Konto? Direkt hier anlegen" : "Konto anlegen"}</h3>
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
            ${vrchatLink ? '<p class="login-note">Nach der Registrierung wird dein neues Konto direkt mit diesem VRChat-Link markiert und eingeloggt.</p>' : ""}
            <button type="submit">${registerButtonLabel}</button>
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
  } else if (canCoordinateStaff()) {
    tabs = [...common, { id: "feedback", label: "Feedback" }, { id: "planning", label: "Planung" }, { id: "capacity", label: "Auslastung" }, { id: "team", label: "Team" }, { id: "time", label: "Zeiten" }];
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
      return renderNewsPanel(canManagePortal());
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
      return renderProfileWorkspace(true);
    case "settings":
      return renderSettingsPanel();
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
      return renderProfileWorkspace(false);
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
      return renderProfileWorkspace(false);
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

  rememberViewportScrollPosition();
  render();
}

async function performAction(callback, successMessage = "", successTone = "success") {
  let succeeded = false;

  try {
    const payload = await callback();
    if (payload?.session || payload?.data) applyPayload(payload);
    if (successMessage) setFlash(successMessage, successTone);
    if (canManagePortal() && !state.vrchatOverview) {
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

  state.ui.lastActionSucceeded = succeeded;
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
    availabilitySlots: readAvailabilitySlotsFromForm(form),
    creatorBlurb: formData.get("creatorBlurb"),
    creatorLinks: formData.get("creatorLinks"),
    creatorVisible: formData.get("creatorVisible") === "on",
    creatorSlug: formData.get("creatorSlug"),
    creatorCommunityName: formData.get("creatorCommunityName"),
    creatorCommunitySummary: formData.get("creatorCommunitySummary"),
    creatorCommunityInviteUrl: formData.get("creatorCommunityInviteUrl"),
    creatorPresence: formData.get("creatorPresence"),
    creatorPresenceText: formData.get("creatorPresenceText"),
    creatorPresenceUrl: formData.get("creatorPresenceUrl")
  };

  if (draft?.dataUrl) {
    payload.avatarUrl = draft.dataUrl;
  } else {
    const avatarData = await readImageFileInput(form.querySelector('input[name="avatarFile"]'));
    if (avatarData) payload.avatarUrl = avatarData;
  }

  return { formData, payload, draftKey };
}

function buildAvailabilityPayload(form) {
  const formData = new FormData(form);
  return {
    formData,
    payload: {
      weeklyHoursCapacity: formData.get("weeklyHoursCapacity"),
      weeklyDaysCapacity: formData.get("weeklyDaysCapacity"),
      availabilitySchedule: formData.get("availabilitySchedule"),
      availabilitySlots: readAvailabilitySlotsFromForm(form)
    }
  };
}

function getEmptyAvailabilitySlots() {
  return AVAILABILITY_DAYS.map((day) => ({
    day: day.id,
    enabled: false,
    startTime: "",
    endTime: "",
    note: ""
  }));
}

function normalizeClientAvailabilitySlots(value) {
  let source = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (value && typeof value === "object") {
    source = Object.values(value);
  }

  const byDay = new Map(
    source
      .map((entry) => [String(entry?.day || "").trim().toLowerCase(), entry])
      .filter(([day]) => AVAILABILITY_DAYS.some((entry) => entry.id === day))
  );

  return getEmptyAvailabilitySlots().map((slot) => {
    const raw = byDay.get(slot.day) || {};
    const startTime = normalizeTimeValue(raw.startTime);
    const endTime = normalizeTimeValue(raw.endTime);
    const note = String(raw.note || "").trim().slice(0, 160);
    const enabled = Boolean(raw.enabled || startTime || endTime || note);
    return {
      day: slot.day,
      enabled,
      startTime,
      endTime,
      note
    };
  });
}

function getAvailabilitySlots(user) {
  return normalizeClientAvailabilitySlots(user?.availabilitySlots);
}

function readAvailabilitySlotsFromForm(form) {
  return AVAILABILITY_DAYS.map((day) => ({
    day: day.id,
    enabled: form.querySelector(`[name="availability-${day.id}-enabled"]`)?.checked || false,
    startTime: normalizeTimeValue(form.querySelector(`[name="availability-${day.id}-start"]`)?.value || ""),
    endTime: normalizeTimeValue(form.querySelector(`[name="availability-${day.id}-end"]`)?.value || ""),
    note: String(form.querySelector(`[name="availability-${day.id}-note"]`)?.value || "").trim().slice(0, 160)
  }));
}

function hasAvailabilitySlots(slots) {
  return normalizeClientAvailabilitySlots(slots).some((slot) => slot.enabled && (slot.startTime || slot.endTime || slot.note));
}

function formatAvailabilitySlotValue(slot) {
  const parts = [];
  if (slot.startTime || slot.endTime) {
    parts.push([slot.startTime || "--:--", slot.endTime || "--:--"].join(" - "));
  }
  if (slot.note) parts.push(slot.note);
  return parts.join(" | ");
}

function renderAvailabilitySlotList(slots, emptyText = "Noch keine Zeitfenster eingetragen.") {
  const activeSlots = normalizeClientAvailabilitySlots(slots).filter((slot) => slot.enabled && (slot.startTime || slot.endTime || slot.note));
  if (!activeSlots.length) return emptyText ? `<p class="helper-text">${escapeHtml(emptyText)}</p>` : "";

  return `
    <div class="availability-slot-list">
      ${activeSlots
        .map((slot) => {
          const day = AVAILABILITY_DAYS.find((entry) => entry.id === slot.day);
          return `
            <div class="availability-slot-pill">
              <span class="availability-slot-day">${escapeHtml(day?.shortLabel || slot.day)}</span>
              <span>${escapeHtml(formatAvailabilitySlotValue(slot))}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAvailabilitySlotsEditor(slots, idPrefix = "availability") {
  const normalized = normalizeClientAvailabilitySlots(slots);

  return `
    <div class="availability-slot-editor">
      ${normalized
        .map((slot) => {
          const day = AVAILABILITY_DAYS.find((entry) => entry.id === slot.day) || { shortLabel: slot.day, fullLabel: slot.day };
          return `
            <div class="availability-slot-row">
              <label class="availability-slot-toggle" for="${escapeHtml(`${idPrefix}-${slot.day}-enabled`)}">
                <input id="${escapeHtml(`${idPrefix}-${slot.day}-enabled`)}" name="availability-${slot.day}-enabled" type="checkbox" ${slot.enabled ? "checked" : ""}>
                <span>${escapeHtml(day.fullLabel)}</span>
              </label>
              <div class="availability-slot-times">
                <input id="${escapeHtml(`${idPrefix}-${slot.day}-start`)}" name="availability-${slot.day}-start" type="time" value="${escapeHtml(slot.startTime || "")}">
                <span class="timeline-meta">bis</span>
                <input id="${escapeHtml(`${idPrefix}-${slot.day}-end`)}" name="availability-${slot.day}-end" type="time" value="${escapeHtml(slot.endTime || "")}">
              </div>
              <input
                id="${escapeHtml(`${idPrefix}-${slot.day}-note`)}"
                name="availability-${slot.day}-note"
                type="text"
                value="${escapeHtml(slot.note || "")}"
                placeholder="optional: flexibel, spaeter, nur kurz ..."
              >
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function handleInput(event) {
  const form = event.target?.closest?.("form[data-form]");
  if (!form) return;
  markFormEditingWindow();
  rememberPersistentFormDraft(form);
}

async function handleChange(event) {
  const form = event.target?.closest?.("form[data-form]");
  const fileInput = event.target.closest('input[type="file"][name="avatarFile"]');
  if (fileInput) {
    await captureAvatarDraft(fileInput);
    return;
  }

  if (form) {
    markFormEditingWindow();
    rememberPersistentFormDraft(form);
  }

  const changeElement = event.target.closest("[data-change]");
  if (!changeElement) return;

  switch (changeElement.dataset.change) {
    case "shift-preset":
      applyShiftPreset(changeElement);
      if (form) rememberPersistentFormDraft(form);
      break;

    case "event-schedule-type":
      render();
      break;

    default:
      break;
  }
}

function renderProfilePanel(managerView) {
  const user = state.session;
  const draftKey = "profile-update:";
  const showAvailabilityFields = user.role !== "member";
  const creatorPresence = getCreatorPresenceMeta(user);
  const creatorCommunity = getCreatorCommunityMeta(user);
  const creatorApplication = getCreatorApplicationMeta(user);
  const availabilitySlots = getAvailabilitySlots(user);

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
            ${showAvailabilityFields ? renderAvailabilitySlotList(availabilitySlots, "") : ""}
            ${showAvailabilityFields && user.availabilitySchedule ? `<p class="helper-text"><strong>Hinweise:</strong> ${escapeHtml(user.availabilitySchedule)}</p>` : ""}
            ${showAvailabilityFields && user.availabilityUpdatedAt ? `<p class="timeline-meta">Zuletzt aktualisiert: ${escapeHtml(formatDateTime(user.availabilityUpdatedAt))}</p>` : ""}
            <div class="creator-presence-inline">
              <span class="pill ${creatorPresence.tone}">${escapeHtml(creatorPresence.title)}</span>
              <span class="pill ${creatorApplication.tone}">${escapeHtml(creatorApplication.title)}</span>
              ${creatorPresence.updatedLabel ? `<span class="timeline-meta">${escapeHtml(creatorPresence.updatedLabel)}</span>` : ""}
            </div>
            <p class="timeline-meta">${escapeHtml(creatorCommunity.name)}</p>
            <p class="helper-text">${escapeHtml(creatorCommunity.summary)}</p>
            ${
              creatorCommunity.inviteUrl
                ? `<a class="creator-action-link" href="${escapeHtml(creatorCommunity.inviteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(creatorCommunity.inviteLabel)}</a>`
                : ""
            }
            <p class="helper-text">${escapeHtml(creatorPresence.summary)}</p>
            <p class="helper-text">${escapeHtml(creatorApplication.summary)}</p>
            ${
              creatorPresence.actionUrl
                ? `<a class="creator-action-link" href="${escapeHtml(creatorPresence.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(creatorPresence.actionLabel)}</a>`
              : ""
            }
            ${renderCreatorLinkList(user, true)}
          </div>
        </div>

        ${
          showAvailabilityFields
            ? `
              <article class="mini-card">
                <h3>Verfuegbarkeit fuer die Planung</h3>
                <p class="helper-text">Hier tragen Moderatoren und Leitung ihre freien Stunden, Tage und konkreten Zeitfenster fuer die kommende Woche ein. Genau diese Angaben landen danach direkt in der Auslastung.</p>
              </article>
            `
            : ""
        }

        <article class="mini-card creator-presence-preview">
          <div class="status-row">
            <span class="pill ${creatorPresence.tone}">${escapeHtml(creatorPresence.title)}</span>
            ${creatorPresence.actionPlatform ? `<span class="timeline-meta">${escapeHtml(creatorPresence.actionPlatform.name)}</span>` : ""}
          </div>
          <h3>Sonara Live Status</h3>
          <p class="helper-text">Wenn du streamst oder etwas Neues droppst, erscheint es hier fuer die Community. Plattformen erkennt das Portal direkt aus deinen Creator-Links.</p>
          <p class="helper-text">${escapeHtml(creatorPresence.summary)}</p>
          ${
            creatorPresence.actionUrl
              ? `<a class="creator-action-link" href="${escapeHtml(creatorPresence.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(creatorPresence.actionLabel)}</a>`
              : '<p class="helper-text">Noch kein direkter Creator-Link aktiv. Sobald du unten einen Status und Link pflegst, tauchst du im Sonara-Live-Bereich auf.</p>'
          }
        </article>

        <article class="mini-card creator-presence-preview">
          <div class="status-row">
            <span class="pill neutral">Creator Hub</span>
            ${creatorCommunity.inviteUrl ? '<span class="timeline-meta">Mit Einstieg</span>' : '<span class="timeline-meta">Unter einem Dach</span>'}
          </div>
          <h3>${escapeHtml(creatorCommunity.name)}</h3>
          <p class="helper-text">${escapeHtml(creatorCommunity.summary)}</p>
          ${user.creatorSlug ? `<p class="timeline-meta">Seite: ${escapeHtml(`/creator/${user.creatorSlug}`)}</p>` : ""}
          ${
            creatorCommunity.inviteUrl
              ? `<a class="creator-action-link" href="${escapeHtml(creatorCommunity.inviteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(creatorCommunity.inviteLabel)}</a>`
              : '<p class="helper-text">Wenn du magst, kannst du deiner Community hier einen eigenen Eingang geben, etwa einen Discord-, Twitch- oder Sammellink.</p>'
          }
          ${user.creatorSlug ? `<a class="creator-action-link" href="${escapeHtml(buildCreatorPublicPath(user))}">Slash-Seite ansehen</a>` : ""}
        </article>

        <section class="availability-form-shell creator-application-shell">
          <div class="availability-form-head">
            <div>
              <p class="eyebrow">Creator-Pruefung</p>
              <h3>Freischaltung fuer deinen eigenen Creator-Hub</h3>
              <p class="helper-text">Damit nicht jeder sich einfach selbst zum Creator macht, landet dein Bereich erst nach einer kurzen Pruefung im Netzwerk. Aktuell ist ${escapeHtml(String(CREATOR_MIN_FOLLOWERS))}+ Follower die grobe Einstiegsschwelle.</p>
            </div>
            <span class="pill ${creatorApplication.tone}">${escapeHtml(creatorApplication.title)}</span>
          </div>
          <div class="creator-application-copy">
            <p class="helper-text">${escapeHtml(creatorApplication.summary)}</p>
            <div class="chip-list">
              <span class="pill ${creatorApplication.thresholdMet ? "success" : "rose"}">${escapeHtml(creatorApplication.thresholdLabel)}</span>
              ${creatorApplication.primaryPlatform ? `<span class="pill neutral">${escapeHtml(creatorApplication.primaryPlatform)}</span>` : ""}
              ${creatorApplication.reviewedLabel ? `<span class="timeline-meta">${escapeHtml(creatorApplication.reviewedLabel)}</span>` : ""}
            </div>
            ${creatorApplication.reviewNote ? `<p class="helper-text"><strong>Rueckmeldung:</strong> ${escapeHtml(creatorApplication.reviewNote)}</p>` : ""}
          </div>
          <form class="stack-form creator-application-form" data-form="creator-application">
            <div class="creator-presence-form-grid">
              <div class="field">
                <label for="profileCreatorPrimaryPlatform">Hauptplattform</label>
                <input id="profileCreatorPrimaryPlatform" name="creatorPrimaryPlatform" type="text" value="${escapeHtml(user.creatorPrimaryPlatform || "")}" placeholder="TikTok, Twitch, YouTube ...">
              </div>
              <div class="field">
                <label for="profileCreatorFollowerCount">Follower</label>
                <input id="profileCreatorFollowerCount" name="creatorFollowerCount" type="number" min="0" step="1" value="${escapeHtml(String(user.creatorFollowerCount || ""))}" placeholder="z. B. 520">
              </div>
              <div class="field span-all">
                <label for="profileCreatorProofUrl">Nachweis-Link</label>
                <input id="profileCreatorProofUrl" name="creatorProofUrl" type="url" value="${escapeHtml(user.creatorProofUrl || "")}" placeholder="Profil, Kanal oder Linktree mit sichtbaren Zahlen">
              </div>
              <div class="field span-all">
                <label for="profileCreatorApplicationNote">Kurze Einordnung fuer die Leitung</label>
                <textarea id="profileCreatorApplicationNote" name="creatorApplicationNote" placeholder="Worum geht es bei deinem Content und was soll dein Hub hier spaeter sammeln?">${escapeHtml(user.creatorApplicationNote || "")}</textarea>
              </div>
            </div>
            <button type="submit">${creatorApplication.pending ? "Bewerbung aktualisieren" : creatorApplication.rejected ? "Erneut pruefen lassen" : "Creator-Pruefung absenden"}</button>
          </form>
        </section>

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
                  <div class="span-all availability-form-shell">
                    <div class="availability-form-head">
                      <div>
                        <p class="eyebrow">Verfuegbarkeit</p>
                        <h3>Dein Wochenrahmen fuer die Planung</h3>
                        <p class="helper-text">Hier kannst du dir in Ruhe Stunden, Tage und konkrete Zeitfenster fuer die kommende Woche eintragen. Live-Updates halten deine offenen Eingaben jetzt fest.</p>
                      </div>
                      <span class="pill neutral">Staff-Planung</span>
                    </div>
                    <div class="availability-form-grid">
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
                        ${renderAvailabilitySlotsEditor(availabilitySlots, "profile-availability")}
                        <p class="helper-text">Bitte trage hier moeglichst konkret pro Tag ein, wann du Zeit hast. Die Leitung plant damit direkt weiter, deshalb bleiben deine Eingaben jetzt auch bei Hintergrund-Updates stabil stehen.</p>
                      </div>
                      <div class="field span-all">
                        <label for="profileAvailabilitySchedule">Zusatzhinweise fuer diese Woche</label>
                        <textarea id="profileAvailabilitySchedule" name="availabilitySchedule" placeholder="z. B. Freitag eventuell spaeter oder Sonntag nur spontan erreichbar.">${escapeHtml(user.availabilitySchedule || "")}</textarea>
                        <p class="helper-text">Hier kommen nur noch Hinweise dazu, nicht mehr die Haupt-Zeitfenster.</p>
                      </div>
                    </div>
                  </div>
                `
                : ""
            }
            <div class="field">
              <label for="profileCreatorBlurb">Creator-Text</label>
              <input id="profileCreatorBlurb" name="creatorBlurb" type="text" value="${escapeHtml(user.creatorBlurb || "")}" placeholder="z. B. Musik, Clips, Streams">
            </div>
            ${
              creatorApplication.approved
                ? `
                  <div class="field">
                    <label for="profileCreatorVisible">Im Creator-Bereich zeigen</label>
                    <input id="profileCreatorVisible" name="creatorVisible" type="checkbox" ${user.creatorVisible ? "checked" : ""}>
                  </div>
                `
                : `
                  <div class="field">
                    <label>Creator-Freigabe</label>
                    <div class="input-like">
                      <span class="pill ${creatorApplication.tone}">${escapeHtml(creatorApplication.title)}</span>
                    </div>
                  </div>
                `
            }
            <div class="span-all availability-form-shell creator-presence-shell">
              <div class="availability-form-head">
                <div>
                  <p class="eyebrow">Creator Community</p>
                  <h3>Dein kleiner Bereich unter dem grossen Dach</h3>
                  <p class="helper-text">Du kannst deinen Hub hier schon vorbereiten. Sichtbar fuer andere wird er aber erst, sobald die Creator-Pruefung durch ist.</p>
                </div>
                <span class="pill neutral">Creator Hub</span>
              </div>
              <div class="creator-presence-form-grid">
                <div class="field">
                  <label for="profileCreatorCommunityName">Name deiner Community</label>
                  <input id="profileCreatorCommunityName" name="creatorCommunityName" type="text" value="${escapeHtml(user.creatorCommunityName || "")}" placeholder="z. B. House of Mika">
                </div>
                <div class="field">
                  <label for="profileCreatorSlug">Slash-Adresse</label>
                  <input id="profileCreatorSlug" name="creatorSlug" type="text" value="${escapeHtml(user.creatorSlug || "")}" placeholder="z. B. house-of-mika">
                </div>
                <div class="field">
                  <label for="profileCreatorCommunityInviteUrl">Einstiegslink</label>
                  <input id="profileCreatorCommunityInviteUrl" name="creatorCommunityInviteUrl" type="url" value="${escapeHtml(user.creatorCommunityInviteUrl || "")}" placeholder="Discord, Linktree, TikTok oder eigener Sammellink">
                </div>
                <div class="field span-all">
                  <label for="profileCreatorCommunitySummary">Kurzbeschreibung deiner Community</label>
                  <textarea id="profileCreatorCommunitySummary" name="creatorCommunitySummary" placeholder="Worum geht es bei dir, was erwartet Leute in deinem Bereich und weshalb sollten sie dort mitlesen?">${escapeHtml(user.creatorCommunitySummary || "")}</textarea>
                  <p class="helper-text">Dieser Text erscheint spaeter direkt im Creator-Hub und auf deiner Slash-Seite. Die URL wird automatisch auf `/creator/dein-slug` gebaut.</p>
                </div>
              </div>
            </div>
            <div class="span-all availability-form-shell creator-presence-shell">
              <div class="availability-form-head">
                <div>
                  <p class="eyebrow">Sonara Live</p>
                  <h3>Dein aktueller Creator-Moment</h3>
                  <p class="helper-text">Hier setzt du manuell, ob du gerade live bist oder etwas Neues hochgeladen hast. Die Website erkennt deine Plattformen aus den Links und baut daraus die passenden Schnellwege. Oeffentlich spielt das aber erst nach der Freigabe eine Rolle.</p>
                </div>
                <span class="pill ${creatorPresence.tone}">${escapeHtml(creatorPresence.title)}</span>
              </div>
              <div class="creator-presence-form-grid">
                <div class="field">
                  <label for="profileCreatorPresence">Status</label>
                  <select id="profileCreatorPresence" name="creatorPresence">
                    <option value="offline" ${creatorPresence.status === "offline" ? "selected" : ""}>Zurzeit ruhig</option>
                    <option value="live" ${creatorPresence.status === "live" ? "selected" : ""}>Ich bin gerade live</option>
                    <option value="new-release" ${creatorPresence.status === "new-release" ? "selected" : ""}>Ich habe etwas Neues hochgeladen</option>
                  </select>
                </div>
                <div class="field">
                  <label for="profileCreatorPresenceUrl">Direkter Link</label>
                  <input id="profileCreatorPresenceUrl" name="creatorPresenceUrl" type="url" value="${escapeHtml(user.creatorPresenceUrl || "")}" placeholder="TikTok Live, Twitch, neues Video oder Profil-Link">
                </div>
                <div class="field span-all">
                  <label for="profileCreatorPresenceText">Kurztext fuer Sonara Live</label>
                  <textarea id="profileCreatorPresenceText" name="creatorPresenceText" placeholder="z. B. Heute Abend TikTok Live ab 20 Uhr oder neuer Clip ist online.">${escapeHtml(user.creatorPresenceText || "")}</textarea>
                  <p class="helper-text">Das ist die kurze Notiz, die Mitglieder bei Sonara Live und in ihren Benachrichtigungen sehen.</p>
                </div>
              </div>
            </div>
            <div class="field span-all">
              <label for="profileCreatorLinks">Creator-Links</label>
              <textarea id="profileCreatorLinks" name="creatorLinks" placeholder="Discord | https://...&#10;TikTok | https://...&#10;Twitch | https://...&#10;YouTube | https://...">${escapeHtml(renderCreatorLinksText(user))}</textarea>
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

function getEntryTimestampMs(entry) {
  const rawValue = entry?.createdAt || entry?.updatedAt || entry?.checkInAt || "";
  const timestamp = Date.parse(String(rawValue || ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function dedupeRecentEntries(entries, buildFingerprint, timeWindowMs = 15000) {
  const seen = [];

  return (entries || []).filter((entry) => {
    const fingerprint = String(buildFingerprint(entry) || entry?.id || "").trim();
    if (!fingerprint) return true;

    const entryTime = getEntryTimestampMs(entry);
    const duplicate = seen.some((candidate) => {
      if (candidate.fingerprint !== fingerprint) return false;
      if (!Number.isFinite(candidate.entryTime) || !Number.isFinite(entryTime)) return true;
      return Math.abs(candidate.entryTime - entryTime) <= timeWindowMs;
    });

    if (!duplicate) {
      seen.push({ fingerprint, entryTime });
    }

    return !duplicate;
  });
}

function getFeedPosts() {
  return dedupeRecentEntries(
    state.data?.feedPosts || [],
    (entry) => `${entry.authorId || ""}|${entry.creatorCommunityId || ""}|${entry.content || ""}|${entry.imageUrl || ""}`
  );
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
  const creatorActivity = Array.isArray(community.creatorActivity)
    ? community.creatorActivity
    : creators.filter((entry) => getCreatorPresenceMeta(entry).status !== "offline");
  const liveCreators = Array.isArray(community.liveCreators)
    ? community.liveCreators
    : creatorActivity.filter((entry) => getCreatorPresenceMeta(entry).status === "live");

  return {
    team: Array.isArray(community.team) ? community.team : [],
    creators,
    creatorActivity,
    liveCreators,
    events: Array.isArray(community.events) ? community.events : [],
    rules: Array.isArray(community.rules) ? community.rules : [],
    faq: Array.isArray(community.faq) ? community.faq : [],
    stats: {
      ...(community.stats || {}),
      creators: creators.length,
      liveCreators: liveCreators.length,
      creatorActivity: creatorActivity.length
    }
  };
}

function getChatFeed(mode = "community") {
  const source =
    mode === "staff"
      ? (state.data?.staffChatMessages || []).length
        ? state.data.staffChatMessages
        : (state.data?.chatMessages || []).filter((entry) => entry.channel === "staff")
      : (state.data?.communityChatMessages || []).length
        ? state.data.communityChatMessages
        : (state.data?.chatMessages || []).filter((entry) => entry.channel !== "staff");

  return dedupeRecentEntries(
    source,
    (entry) => `${entry.authorId || ""}|${entry.channel || mode}|${entry.relatedShiftId || entry.relatedShift?.id || ""}|${entry.content || ""}`
  );
}

function renderCreatorsPanel(managerView) {
  const creators = getCreatorEntries();
  const creatorActivity = getCreatorActivityEntries(4);
  const selectedCreator = getSelectedCreatorEntry(creators);
  const pendingApplications = canManagePortal() ? getCreatorReviewEntries(["pending"]) : [];

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Creator</p>
          <h2>Content Creator aus SONARA</h2>
          <p class="section-copy">Hier fuehlt sich der Creator-Bereich eher wie ein kleines Netzwerk unter einem Dach an, statt nur wie eine lose Liste.</p>
        </div>
        <div class="chip-list">
          <span class="pill neutral">${escapeHtml(String(creators.length))} Creator-Hubs</span>
          ${pendingApplications.length ? `<span class="pill amber">${escapeHtml(String(pendingApplications.length))} Pruefungen offen</span>` : ""}
        </div>
      </div>
      ${
        managerView
          ? `<p class="helper-text">Creator pflegen ihre Hub-Daten weiterhin im Profil. Freigaben selbst laufen jetzt getrennt ueber die Creator-Pruefung, damit niemand sich den Bereich einfach selbst zuschalten kann.</p>`
          : ""
      }
      ${
        creatorActivity.length
          ? `
            <div class="live-creator-grid compact-live-grid">
              ${creatorActivity.map((entry) => renderLiveCreatorCard(entry)).join("")}
            </div>
          `
          : ""
      }
      ${
        pendingApplications.length
          ? `
            <div class="creator-review-grid">
              ${pendingApplications.map((entry) => renderCreatorReviewCard(entry, "creator-tab")).join("")}
            </div>
          `
          : ""
      }
      ${
        creators.length
          ? `
            <div class="creator-stage-shell">
              <aside class="creator-rail">
                <div class="section-head compact-section-head">
                  <div>
                    <p class="eyebrow">Creator-Navigation</p>
                    <h3>Wen willst du gerade oeffnen?</h3>
                  </div>
                </div>
                <div class="creator-rail-list">
                  ${creators.map((entry) => renderCreatorRailButton(entry, entry.id === selectedCreator?.id)).join("")}
                </div>
              </aside>

              <div class="creator-spotlight">
                ${
                  selectedCreator
                    ? `
                      <div class="creator-spotlight-shell">
                        <div class="status-row">
                          <div class="chip-list">
                            <span class="pill neutral">Creator-Hub</span>
                            <span class="pill ${getCreatorPresenceMeta(selectedCreator).tone}">${escapeHtml(getCreatorPresenceMeta(selectedCreator).title)}</span>
                          </div>
                          ${
                            creators.length > 1
                              ? `<button type="button" class="ghost small" data-action="clear-creator-focus">Zurueck auf Anfang</button>`
                              : ""
                          }
                        </div>
                        ${renderCreatorCommunityHub(selectedCreator)}
                      </div>
                    `
                    : renderEmptyState("Noch kein Creator-Hub", "Sobald Creator freigegeben sind, kannst du ihre Bereiche hier fokussiert oeffnen.")
                }
              </div>
            </div>

            <div class="team-grid creator-network-grid">
              ${creators.map((entry) => renderCreatorCard(entry, { interactive: true, selected: entry.id === selectedCreator?.id })).join("")}
            </div>
          `
          : renderEmptyState(
              "Noch keine freigegebenen Creator",
              `Creator tauchen hier erst nach einer Pruefung auf. Aktuell liegt die Einstiegsschwelle bei ${CREATOR_MIN_FOLLOWERS}+ Followern.`
            )
      }
    </section>
  `;
}

function renderLivePreviewPanel(limit = 4, spanClass = "span-12") {
  const activityEntries = getCreatorActivityEntries(limit);
  const liveCount = activityEntries.filter((entry) => getCreatorPresenceMeta(entry).status === "live").length;
  const releaseCount = activityEntries.filter((entry) => getCreatorPresenceMeta(entry).status === "new-release").length;

  return `
    <section class="panel ${spanClass} live-preview-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Sonara Live</p>
          <h2>Was bei den Creatorn gerade laeuft</h2>
          <p class="section-copy">Streams und frische Uploads tauchen hier direkt auf, sobald Creator ihren Status im Profil setzen.</p>
        </div>
        <div class="chip-list">
          <span class="pill amber">${escapeHtml(String(liveCount))} live</span>
          <span class="pill sky">${escapeHtml(String(releaseCount))} neu</span>
        </div>
      </div>
      ${
        activityEntries.length
          ? `<div class="live-creator-grid">${activityEntries.map((entry) => renderLiveCreatorCard(entry)).join("")}</div>`
          : renderEmptyState("Noch kein Creator aktiv", "Sobald jemand streamt oder einen neuen Upload teilt, erscheint der Hinweis hier fuer die Community.")
      }
    </section>
  `;
}

function renderLivePanel() {
  const creators = getCreatorEntries();
  const activityEntries = getCreatorActivityEntries();
  const liveEntries = activityEntries.filter((entry) => getCreatorPresenceMeta(entry).status === "live");
  const releaseEntries = activityEntries.filter((entry) => getCreatorPresenceMeta(entry).status === "new-release");
  const leadLive = liveEntries[0] || null;
  const leadRelease = releaseEntries[0] || null;
  const leadLiveMeta = leadLive ? getCreatorPresenceMeta(leadLive) : null;
  const leadReleaseMeta = leadRelease ? getCreatorPresenceMeta(leadRelease) : null;

  return `
    <section class="panel span-12 live-stage-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Sonara Live</p>
          <h2>Streams, Uploads und Creator-Signale</h2>
          <p class="section-copy">Hier buendelt SONARA alle aktuellen Creator-Momente. Plattformen werden aus den Creator-Links erkannt, waehrend Creator ihren Live- oder Upload-Status gezielt selbst setzen.</p>
        </div>
        <div class="chip-list">
          <span class="pill amber">${escapeHtml(String(liveEntries.length))} live</span>
          <span class="pill sky">${escapeHtml(String(releaseEntries.length))} neu</span>
          <span class="pill neutral">${escapeHtml(String(creators.length))} Creator</span>
        </div>
      </div>

      <div class="live-stage-grid">
        <article class="mini-card live-stage-card live-stage-card-sun">
          <p class="eyebrow">Gerade offen</p>
          <h3>${escapeHtml(leadLive ? `${getPrimaryDisplayName(leadLive)} sendet gerade` : "Gerade kein Stream aktiv")}</h3>
          <p class="helper-text">${escapeHtml(leadLiveMeta ? leadLiveMeta.summary : "Sobald jemand live geht, landet der Stream hier direkt als schneller Einstieg fuer die Community.")}</p>
          ${
            leadLiveMeta?.actionUrl
              ? `<a class="creator-action-link" href="${escapeHtml(leadLiveMeta.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(leadLiveMeta.actionLabel)}</a>`
              : ""
          }
        </article>

        <article class="mini-card live-stage-card live-stage-card-moon">
          <p class="eyebrow">Frisch erschienen</p>
          <h3>${escapeHtml(leadRelease ? `Neu von ${getPrimaryDisplayName(leadRelease)}` : "Noch kein neuer Upload markiert")}</h3>
          <p class="helper-text">${escapeHtml(leadReleaseMeta ? leadReleaseMeta.summary : "Creator koennen hier neue Videos, Musik oder Clips direkt mit einem Link in den Fokus setzen.")}</p>
          ${
            leadReleaseMeta?.actionUrl
              ? `<a class="creator-action-link" href="${escapeHtml(leadReleaseMeta.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(leadReleaseMeta.actionLabel)}</a>`
              : ""
          }
        </article>
      </div>
    </section>

    ${renderLivePreviewPanel(6)}

    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Creator Radar</p>
          <h2>Alle Creator auf einen Blick</h2>
          <p class="section-copy">Hier bleiben Profile, Plattformen und Status dauerhaft sichtbar, auch wenn gerade niemand live ist.</p>
        </div>
      </div>
      <div class="team-grid">
        ${creators.length ? creators.map((entry) => renderCreatorCard(entry)).join("") : renderEmptyState("Noch keine Creator", "Sobald Creator Links oder einen Kurztext im Profil pflegen, erscheinen sie hier.")}
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
      <div class="chat-tool-stack">
        <form class="chat-tools" data-form="chat-trim" data-channel="${escapeHtml(mode)}">
          <span class="helper-text">Verlauf kuerzen</span>
          <div class="trim-actions">
            ${CHAT_TRIM_OPTIONS.map((count) => `<button type="submit" class="ghost small" value="${count}">${count}</button>`).join("")}
          </div>
        </form>
        <form class="chat-tools" data-form="chat-clear" data-channel="${escapeHtml(mode)}">
          <button type="submit" class="danger small">Alles loeschen</button>
        </form>
      </div>
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

      <form class="stack-form" data-form="chat" data-channel="${escapeHtml(mode)}">
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
      <div class="chat-tool-stack">
        <form class="chat-tools" data-form="direct-message-trim">
          <span class="helper-text">Verlauf kuerzen</span>
          <div class="trim-actions">
            ${CHAT_TRIM_OPTIONS.map((count) => `<button type="submit" class="ghost small" value="${count}">${count}</button>`).join("")}
          </div>
        </form>
        <form class="chat-tools" data-form="direct-message-clear">
          <button type="submit" class="danger small">Alles loeschen</button>
        </form>
      </div>
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
  const messages = dedupeRecentEntries(
    state.data?.directMessages || [],
    (entry) => `${entry.senderId || ""}|${entry.recipientId || ""}|${entry.content || ""}`
  );
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

function getCreatorPresenceTimestamp(user) {
  const timestamp = Date.parse(String(user?.creatorPresenceUpdatedAt || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCreatorPresenceMeta(user) {
  const status = user?.creatorPresence === "live" ? "live" : user?.creatorPresence === "new-release" ? "new-release" : "offline";
  const linkEntries = getCreatorLinks(user).map((entry) => ({
    ...entry,
    platform: getCreatorPlatformMeta(entry)
  }));
  const preferredPlatforms =
    status === "live"
      ? ["Twitch", "TikTok", "YouTube", "Instagram", "Discord"]
      : ["YouTube", "TikTok", "Spotify", "SoundCloud", "Instagram", "X", "Discord"];
  const matchedLink = linkEntries.find((entry) => preferredPlatforms.includes(entry.platform.name)) || linkEntries[0] || null;
  const explicitActionUrl = String(user?.creatorPresenceUrl || "").trim();
  const actionPlatform = explicitActionUrl ? getCreatorPlatformMeta({ label: "", url: explicitActionUrl }) : matchedLink?.platform || null;
  const summary =
    String(user?.creatorPresenceText || "").trim() ||
    String(user?.creatorBlurb || "").trim() ||
    String(user?.contactNote || "").trim() ||
    "Creator-Profil";

  return {
    status,
    title: status === "live" ? "Jetzt live" : status === "new-release" ? "Neu hochgeladen" : "Zurzeit ruhig",
    tone: status === "live" ? "amber" : status === "new-release" ? "sky" : "neutral",
    summary,
    actionUrl: explicitActionUrl || matchedLink?.url || "",
    actionLabel: status === "live" ? "Live oeffnen" : status === "new-release" ? "Neuen Upload ansehen" : matchedLink ? "Creator oeffnen" : "",
    actionPlatform,
    updatedLabel: user?.creatorPresenceUpdatedAt ? `Aktualisiert ${formatDateTime(user.creatorPresenceUpdatedAt)}` : "",
    linkEntries
  };
}

function getCreatorCommunityMeta(user) {
  const communityName = String(user?.creatorCommunityName || "").trim() || `${getPrimaryDisplayName(user)} Community`;
  const summary =
    String(user?.creatorCommunitySummary || "").trim() ||
    String(user?.creatorBlurb || "").trim() ||
    String(user?.contactNote || "").trim() ||
    "Ein eigener Bereich fuer Updates, Posts und Themen dieser Creator-Community.";
  const inviteUrl = String(user?.creatorCommunityInviteUrl || "").trim();

  return {
    name: communityName,
    summary,
    inviteUrl,
    inviteLabel: inviteUrl ? "Community oeffnen" : ""
  };
}

function getCreatorApplicationMeta(user) {
  const status = String(user?.creatorApplicationStatus || "none").trim().toLowerCase();
  const followerCount = Number(user?.creatorFollowerCount || 0);
  const thresholdMet = followerCount >= CREATOR_MIN_FOLLOWERS;
  const primaryPlatform = String(user?.creatorPrimaryPlatform || "").trim();
  const proofUrl = String(user?.creatorProofUrl || "").trim();
  const applicationNote = String(user?.creatorApplicationNote || "").trim();
  const reviewNote = String(user?.creatorReviewNote || "").trim();
  const reviewedLabel = user?.creatorReviewedAt ? `Zuletzt geprueft ${formatDateTime(user.creatorReviewedAt)}` : "";

  const variants = {
    approved: {
      title: "Creator freigeschaltet",
      tone: "success",
      summary: "Dein Creator-Hub ist fuer die Community freigegeben und kann jetzt sichtbar wachsen."
    },
    pending: {
      title: "Creator-Pruefung laeuft",
      tone: "amber",
      summary: "Deine Creator-Bewerbung liegt gerade bei Leitung oder Admin zur Pruefung."
    },
    rejected: {
      title: "Creator-Bewerbung pausiert",
      tone: "rose",
      summary: "Die Bewerbung braucht noch etwas Nacharbeit, bevor sie freigeschaltet werden kann."
    },
    none: {
      title: "Noch nicht als Creator freigegeben",
      tone: "neutral",
      summary: `Reiche hier erst deine Creator-Pruefung ein. Aktuell sind mindestens ${CREATOR_MIN_FOLLOWERS} Follower vorgesehen.`
    }
  };

  const variant = variants[status] || variants.none;

  return {
    status,
    followerCount,
    thresholdMet,
    primaryPlatform,
    proofUrl,
    applicationNote,
    reviewNote,
    reviewedLabel,
    ...variant,
    thresholdLabel: `${followerCount || 0} / ${CREATOR_MIN_FOLLOWERS}+ Follower`,
    approved: status === "approved",
    pending: status === "pending",
    rejected: status === "rejected"
  };
}

function getManagedUsers() {
  const users = state.data?.users || [];
  return Array.isArray(users) ? users : [];
}

function getCreatorReviewEntries(statuses = ["pending"]) {
  const statusSet = new Set((Array.isArray(statuses) ? statuses : [statuses]).map((entry) => String(entry || "").trim().toLowerCase()));
  return getManagedUsers()
    .filter((user) => statusSet.has(String(user?.creatorApplicationStatus || "none").trim().toLowerCase()))
    .slice()
    .sort((left, right) => getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de"));
}

function getSelectedCreatorEntry(creators) {
  const selectedId = String(state.ui.selectedCreatorId || "").trim();
  return creators.find((entry) => entry.id === selectedId) || creators[0] || null;
}

function renderCreatorRailButton(user, selected = false) {
  const community = getCreatorCommunityMeta(user);
  const presence = getCreatorPresenceMeta(user);

  return `
    <button
      type="button"
      class="creator-rail-button ${selected ? "active" : ""}"
      data-action="set-creator-focus"
      data-creator-id="${escapeHtml(user.id)}"
    >
      <span class="creator-rail-eyebrow">${escapeHtml(getPrimaryDisplayName(user))}</span>
      <strong>${escapeHtml(community.name)}</strong>
      <span class="creator-rail-summary">${escapeHtml(truncateText(community.summary, 88))}</span>
      <span class="pill ${presence.tone}">${escapeHtml(presence.title)}</span>
    </button>
  `;
}

function buildCreatorCommunityOptions(selectedId = "", includeGeneral = true) {
  const options = [];
  const creators = getCreatorEntries();

  if (includeGeneral) {
    options.push(`<option value="">Allgemeine Community</option>`);
  }

  for (const creator of creators) {
    options.push(
      `<option value="${escapeHtml(creator.id)}" ${creator.id === selectedId ? "selected" : ""}>${escapeHtml(getCreatorCommunityMeta(creator).name)}</option>`
    );
  }

  return options.join("");
}

function getCreatorCommunityFeedPosts(creatorId, limit = 3) {
  const posts = getFeedPosts().filter((post) => post.creatorCommunityId === creatorId || post.authorId === creatorId);
  return Number.isFinite(limit) ? posts.slice(0, limit) : posts;
}

function getCreatorCommunityThreads(creatorId, limit = 3) {
  const threads = (state.data?.forumThreads || []).filter((thread) => thread.creatorCommunityId === creatorId || thread.authorId === creatorId);
  return Number.isFinite(limit) ? threads.slice(0, limit) : threads;
}

function renderCreatorCommunityBadge(name) {
  return name ? `<span class="pill neutral">${escapeHtml(name)}</span>` : "";
}

function renderCompactCreatorFeedPost(post) {
  const body = truncateText(post.content || "", 180);
  return `
    <article class="mini-card creator-community-activity-card">
      <div class="status-row">
        <span class="pill sky">Feed</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(post.createdAt))}</span>
      </div>
      <h3>${escapeHtml(post.authorName)}</h3>
      ${post.creatorCommunityName ? `<p class="timeline-meta">${escapeHtml(post.creatorCommunityName)}</p>` : ""}
      ${body ? `<p class="helper-text">${escapeHtml(body)}</p>` : ""}
      ${post.imageUrl ? `<img src="${escapeHtml(post.imageUrl)}" alt="Beitrag von ${escapeHtml(post.authorName)}" class="feed-image">` : ""}
    </article>
  `;
}

function renderCompactCreatorForumThread(thread) {
  const body = truncateText(thread.content || thread.body || "", 200);
  return `
    <article class="mini-card creator-community-activity-card">
      <div class="status-row">
        <span class="pill amber">${escapeHtml(thread.category || "Thema")}</span>
        <span class="timeline-meta">${escapeHtml(formatDateTime(thread.createdAt))}</span>
      </div>
      <h3>${escapeHtml(thread.title)}</h3>
      <p class="timeline-meta">von ${escapeHtml(thread.authorName)} | ${(thread.replies || []).length} Antworten</p>
      ${thread.creatorCommunityName ? `<p class="timeline-meta">${escapeHtml(thread.creatorCommunityName)}</p>` : ""}
      <p class="helper-text">${escapeHtml(body)}</p>
    </article>
  `;
}

function renderCreatorCommunityHub(user) {
  const presence = getCreatorPresenceMeta(user);
  const community = getCreatorCommunityMeta(user);
  const feedPosts = getCreatorCommunityFeedPosts(user.id, 2);
  const forumThreads = getCreatorCommunityThreads(user.id, 2);
  const publicPath = buildCreatorPublicPath(user);

  return `
    <article class="request-card creator-community-hub">
      <div class="creator-community-shell">
        <div class="creator-community-head">
          <div class="profile-head">
            ${renderUserAvatar(user, "profile-avatar")}
            <div class="creator-card-copy">
              <h3>${escapeHtml(community.name)}</h3>
              <p class="timeline-meta">${escapeHtml(getPrimaryDisplayName(user))}</p>
            </div>
          </div>
          <div class="chip-list">
            <span class="pill ${presence.tone}">${escapeHtml(presence.title)}</span>
            <span class="pill neutral">${escapeHtml(String(feedPosts.length))} Feed</span>
            <span class="pill neutral">${escapeHtml(String(forumThreads.length))} Threads</span>
          </div>
        </div>

        <div class="creator-community-copy">
          <p class="helper-text">${escapeHtml(community.summary)}</p>
          <div class="creator-community-actions">
            ${
              community.inviteUrl
                ? `<a class="creator-action-link" href="${escapeHtml(community.inviteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(community.inviteLabel)}</a>`
                : ""
            }
            ${
              presence.actionUrl
                ? `<a class="creator-action-link" href="${escapeHtml(presence.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(presence.actionLabel)}</a>`
                : ""
            }
            <a class="creator-action-link" href="${escapeHtml(publicPath)}">Slash-Seite oeffnen</a>
          </div>
          ${renderCreatorLinkList(user, true)}
        </div>

        <div class="creator-community-activity-grid">
          <div class="creator-community-column">
            <div class="section-head compact-section-head">
              <div>
                <p class="eyebrow">Community Feed</p>
                <h3>Letzte Momente</h3>
              </div>
            </div>
            <div class="stack-list compact-stack">
              ${
                feedPosts.length
                  ? feedPosts.map((post) => renderCompactCreatorFeedPost(post)).join("")
                  : renderEmptyState("Noch keine Feed-Beitraege", "Sobald in dieser Creator-Community etwas gepostet wird, erscheint es hier.")
              }
            </div>
          </div>

          <div class="creator-community-column">
            <div class="section-head compact-section-head">
              <div>
                <p class="eyebrow">Themenraum</p>
                <h3>Letzte Threads</h3>
              </div>
            </div>
            <div class="stack-list compact-stack">
              ${
                forumThreads.length
                  ? forumThreads.map((thread) => renderCompactCreatorForumThread(thread)).join("")
                  : renderEmptyState("Noch keine Themen", "Sobald jemand dieser Creator-Community ein Thema gibt, landet es hier.")
              }
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCreatorReviewCard(user, scope = "review") {
  const application = getCreatorApplicationMeta(user);
  const prefix = `${scope}-${user.id}`;

  return `
    <article class="mini-card creator-review-card">
      <div class="status-row">
        <div class="chip-list">
          <span class="pill ${application.tone}">${escapeHtml(application.title)}</span>
          <span class="pill ${application.thresholdMet ? "success" : "rose"}">${escapeHtml(application.thresholdLabel)}</span>
        </div>
        ${application.reviewedLabel ? `<span class="timeline-meta">${escapeHtml(application.reviewedLabel)}</span>` : ""}
      </div>
      <div class="profile-head">
        ${renderUserAvatar(user, "profile-avatar")}
        <div class="creator-card-copy">
          <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
          <p class="timeline-meta">${escapeHtml(application.primaryPlatform || "Plattform noch offen")}</p>
        </div>
      </div>
      <p class="helper-text">${escapeHtml(application.summary)}</p>
      ${application.applicationNote ? `<p class="helper-text"><strong>Bewerbung:</strong> ${escapeHtml(application.applicationNote)}</p>` : ""}
      ${application.reviewNote ? `<p class="helper-text"><strong>Review:</strong> ${escapeHtml(application.reviewNote)}</p>` : ""}
      ${
        application.proofUrl
          ? `<a class="creator-action-link" href="${escapeHtml(application.proofUrl)}" target="_blank" rel="noreferrer">Nachweis oeffnen</a>`
          : ""
      }

      <form class="stack-form creator-review-form" data-form="creator-review" data-user-id="${escapeHtml(user.id)}">
        <div class="form-grid">
          <div class="field">
            <label for="creatorStatus-${escapeHtml(prefix)}">Status</label>
            <select id="creatorStatus-${escapeHtml(prefix)}" name="status">
              <option value="pending" ${application.pending ? "selected" : ""}>In Pruefung</option>
              <option value="approved" ${application.approved ? "selected" : ""}>Freigeben</option>
              <option value="rejected" ${application.rejected ? "selected" : ""}>Ablehnen</option>
              <option value="none" ${application.status === "none" ? "selected" : ""}>Zuruecksetzen</option>
            </select>
          </div>
          <div class="field">
            <label for="creatorFollowers-${escapeHtml(prefix)}">Follower</label>
            <input id="creatorFollowers-${escapeHtml(prefix)}" name="creatorFollowerCount" type="number" min="0" step="1" value="${escapeHtml(String(application.followerCount || ""))}">
          </div>
          <div class="field">
            <label for="creatorPlatform-${escapeHtml(prefix)}">Plattform</label>
            <input id="creatorPlatform-${escapeHtml(prefix)}" name="creatorPrimaryPlatform" type="text" value="${escapeHtml(application.primaryPlatform || "")}" placeholder="TikTok, Twitch, YouTube ...">
          </div>
          <div class="field">
            <label for="creatorProof-${escapeHtml(prefix)}">Nachweis-Link</label>
            <input id="creatorProof-${escapeHtml(prefix)}" name="creatorProofUrl" type="url" value="${escapeHtml(application.proofUrl || "")}" placeholder="Profil oder Kanal-Link">
          </div>
          <div class="field span-all">
            <label for="creatorNote-${escapeHtml(prefix)}">Notiz aus der Bewerbung</label>
            <textarea id="creatorNote-${escapeHtml(prefix)}" name="creatorApplicationNote" placeholder="Kurze Einordnung zur Creator-Ecke">${escapeHtml(application.applicationNote || "")}</textarea>
          </div>
          <div class="field span-all">
            <label for="creatorReviewNote-${escapeHtml(prefix)}">Review-Notiz</label>
            <textarea id="creatorReviewNote-${escapeHtml(prefix)}" name="creatorReviewNote" placeholder="Kurze Rueckmeldung fuer die Creator-Pruefung">${escapeHtml(application.reviewNote || "")}</textarea>
          </div>
          <div class="field creator-review-override">
            <label for="creatorOverride-${escapeHtml(prefix)}">Unter ${escapeHtml(String(CREATOR_MIN_FOLLOWERS))} trotzdem freigeben</label>
            <input id="creatorOverride-${escapeHtml(prefix)}" name="overrideMinimum" type="checkbox">
          </div>
        </div>
        <button type="submit" class="ghost small">Creator-Review speichern</button>
      </form>
    </article>
  `;
}

function compareCreatorActivityEntries(left, right) {
  const rank = (entry) => {
    const status = getCreatorPresenceMeta(entry).status;
    if (status === "live") return 0;
    if (status === "new-release") return 1;
    return 2;
  };

  const rankDiff = rank(left) - rank(right);
  if (rankDiff !== 0) return rankDiff;

  const timeDiff = getCreatorPresenceTimestamp(right) - getCreatorPresenceTimestamp(left);
  if (timeDiff !== 0) return timeDiff;

  return getPrimaryDisplayName(left).localeCompare(getPrimaryDisplayName(right), "de");
}

function getCreatorActivityEntries(limit = Number.POSITIVE_INFINITY) {
  const entries = getCreatorEntries()
    .filter((entry) => getCreatorPresenceMeta(entry).status !== "offline")
    .slice()
    .sort(compareCreatorActivityEntries);

  return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
}

function renderLiveCreatorCard(user) {
  const presence = getCreatorPresenceMeta(user);

  return `
    <article class="mini-card live-creator-card live-creator-card-${escapeHtml(presence.status)}">
      <div class="status-row">
        <span class="pill ${presence.tone}">${escapeHtml(presence.title)}</span>
        ${presence.actionPlatform ? `<span class="timeline-meta">${escapeHtml(presence.actionPlatform.name)}</span>` : ""}
      </div>
      <div class="profile-head">
        ${renderUserAvatar(user, "profile-avatar")}
        <div class="creator-card-copy">
          <h3>${escapeHtml(getPrimaryDisplayName(user))}</h3>
          ${presence.updatedLabel ? `<p class="timeline-meta">${escapeHtml(presence.updatedLabel)}</p>` : ""}
        </div>
      </div>
      <p class="helper-text">${escapeHtml(presence.summary)}</p>
      ${renderCreatorLinkList(user, true)}
      ${
        presence.actionUrl
          ? `<a class="creator-action-link" href="${escapeHtml(presence.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(presence.actionLabel)}</a>`
          : ""
      }
    </article>
  `;
}

function renderCreatorLinkList(user, compact = false) {
  const links = getCreatorLinks(user);
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
      ${post.creatorCommunityName ? `<div class="chip-list">${renderCreatorCommunityBadge(post.creatorCommunityName)}</div>` : ""}
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
  const posts = getFeedPosts();

  return `
    <section class="panel span-12">
      <div class="section-head">
        <div>
          <p class="eyebrow">Community Feed</p>
          <h2>Bilder, Momente und Reaktionen</h2>
          <p class="section-copy">Mitglieder koennen hier allgemein posten oder gezielt in die kleinen Creator-Communities hinein schreiben.</p>
        </div>
      </div>

      <form class="stack-form" data-form="feed-post">
        <div class="form-grid">
          <div class="field span-all">
            <label for="feedContent">Beitrag</label>
            <textarea id="feedContent" name="content" placeholder="Was moechtest du mit der Community teilen?"></textarea>
          </div>
          <div class="field">
            <label for="feedCreatorCommunityId">Creator-Community</label>
            <select id="feedCreatorCommunityId" name="creatorCommunityId">
              ${buildCreatorCommunityOptions("", true)}
            </select>
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
    { id: "live", label: "Sonara Live" },
    { id: "forum", label: "Forum" },
    { id: "chat", label: "Chat" },
    { id: "profile", label: "Profil" }
  ];

  let tabs = common;
  if (canManagePortal()) {
    tabs = [...common, { id: "schedule", label: "Meine Schichten" }, { id: "feedback", label: "Feedback" }, { id: "planning", label: "Planung" }, { id: "capacity", label: "Auslastung" }, { id: "team", label: "Team" }, { id: "time", label: "Zeiten" }, { id: "settings", label: "Einstellungen" }];
  } else if (canCoordinateStaff()) {
    tabs = [...common, { id: "schedule", label: "Meine Schichten" }, { id: "feedback", label: "Feedback" }, { id: "planning", label: "Planung" }, { id: "capacity", label: "Auslastung" }, { id: "team", label: "Team" }, { id: "time", label: "Zeiten" }];
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
    case "live":
      return renderLivePanel();
    case "forum":
      return renderForumPanel(true);
    case "schedule":
      return [renderMySchedulePanel(), renderSwapPanel(false)].join("");
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
      return renderProfileWorkspace(true);
    case "settings":
      return renderSettingsPanel();
    case "overview":
    default:
      return [renderNotificationsPanel(), renderFeedPanel(), renderLivePreviewPanel(3), renderAvailabilityReminderPanel(), renderWarningAdminPanel(), renderNewsSpotlightPanel(), renderCreatorsPanel(false), renderRequestAdminPanel()].join("");
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
    case "live":
      return renderLivePanel();
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
      return renderProfileWorkspace(false);
    case "overview":
    default:
      return [renderNotificationsPanel(), renderFeedPanel(), renderLivePreviewPanel(3), renderAvailabilityReminderPanel(), renderNewsSpotlightPanel(), renderMySchedulePanel(), renderCreatorsPanel(false)].join("");
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
    case "live":
      return renderLivePanel();
    case "forum":
      return renderForumPanel(false);
    case "feedback":
      return renderFeedbackMemberPanel();
    case "chat":
      return renderChatWorkspace("member");
    case "profile":
      return renderProfileWorkspace(false);
    case "overview":
    default:
      return [renderNotificationsPanel(), renderFeedPanel(), renderLivePreviewPanel(3), renderNewsSpotlightPanel(), renderCreatorsPanel(false), renderCommunityOverviewPanel()].join("");
  }
}

function normalizeActiveTab(tab) {
  const allowed = canManagePortal()
    ? ["overview", "feed", "community", "calendar", "events", "news", "creators", "live", "forum", "schedule", "feedback", "planning", "capacity", "team", "chat", "time", "profile", "settings"]
    : canCoordinateStaff()
      ? ["overview", "feed", "community", "calendar", "events", "news", "creators", "live", "forum", "schedule", "feedback", "planning", "capacity", "team", "chat", "time", "profile"]
    : canAccessStaffArea()
      ? ["overview", "feed", "community", "calendar", "events", "news", "creators", "live", "forum", "schedule", "feedback", "chat", "time", "profile"]
      : ["overview", "feed", "community", "calendar", "events", "news", "creators", "live", "forum", "feedback", "chat", "profile"];

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
        canCoordinateStaff()
          ? `
            <form class="stack-form event-editor" data-form="event-create">
              <div class="form-grid">
                <div class="field">
                  <label for="eventTitle">Titel</label>
                  <input id="eventTitle" name="title" type="text" value="${escapeHtml(String(eventDraft.title || ""))}" required>
                </div>
                <div class="field">
                  <label for="eventScheduleType">Rhythmus</label>
                  <select id="eventScheduleType" name="scheduleType" data-change="event-schedule-type">
                    <option value="single" ${singleEvent ? "selected" : ""}>Einmalig</option>
                    <option value="weekly" ${singleEvent ? "" : "selected"}>Woechentlich</option>
                  </select>
                </div>
                <div class="field">
                  <label for="eventDate">${singleEvent ? "Datum fuer einmalige Events" : "Datum ist bei Wochenterminen nicht noetig"}</label>
                  <input id="eventDate" name="eventDate" type="date" value="${escapeHtml(String(eventDraft.eventDate || ""))}" ${singleEvent ? "required" : "disabled"}>
                </div>
                <div class="field">
                  <label for="eventWeekday">${singleEvent ? "Wochentag optional" : "Wochentag fuer Wochentermine"}</label>
                  <select id="eventWeekday" name="weekday" ${singleEvent ? "disabled" : "required"}>
                    ${buildEventWeekdayOptions(String(eventDraft.weekday || ""))}
                  </select>
                </div>
                <div class="field">
                  <label for="eventTime">Uhrzeit</label>
                  <input id="eventTime" name="eventTime" type="time" value="${escapeHtml(String(eventDraft.eventTime || ""))}" required>
                </div>
                <div class="field">
                  <label for="eventWorld">Welt</label>
                  <input id="eventWorld" name="world" type="text" value="${escapeHtml(String(eventDraft.world || ""))}" required>
                </div>
                <div class="field">
                  <label for="eventHost">Host</label>
                  <input id="eventHost" name="host" type="text" value="${escapeHtml(String(eventDraft.host || ""))}" placeholder="Optional">
                </div>
                <div class="field checkbox-field">
                  <label class="checkbox-row" for="eventReminderEnabled">
                    <input id="eventReminderEnabled" name="reminderEnabled" type="checkbox" ${eventDraft.reminderEnabled === false ? "" : "checked"}>
                    <span>Erinnerungen aktivieren</span>
                  </label>
                  <p class="helper-text">Wird in Hinweisen und im Kalender sichtbar.</p>
                </div>
                <div class="field span-all">
                  <label for="eventSummary">Kurzbeschreibung</label>
                  <textarea id="eventSummary" name="summary" required>${escapeHtml(String(eventDraft.summary || ""))}</textarea>
                </div>
              </div>
              <p class="pill-note">${singleEvent ? "Einmalige Events brauchen Datum und Uhrzeit. Deine Eingaben bleiben jetzt auch bei automatischen Updates erhalten." : "Wochentermine brauchen Wochentag und Uhrzeit und tauchen danach jede Woche automatisch im Kalender und in den Hinweisen auf."}</p>
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
        canCoordinateStaff()
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

function getShiftDateTime(dateKey, timeValue, fallbackTime = "00:00") {
  const normalizedDate = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return null;

  const normalizedTime = normalizeTimeValue(timeValue) || normalizeTimeValue(fallbackTime) || "00:00";
  const [year, month, day] = normalizedDate.split("-").map(Number);
  const [hours, minutes] = normalizedTime.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getShiftEndDateTime(shift) {
  const startAt = getShiftDateTime(shift?.date, shift?.startTime || "00:00");
  const endAt = getShiftDateTime(shift?.date, shift?.endTime || shift?.startTime || "00:00");
  if (!startAt || !endAt) return null;

  if (endAt <= startAt) {
    return new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
  }

  return endAt;
}

function formatMinutesLabel(totalMinutes) {
  const rounded = Math.max(0, Math.round(Number(totalMinutes || 0)));
  if (rounded < 60) return `${rounded} Minuten`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes ? `${hours} Std. ${minutes} Min.` : `${hours} Std.`;
}

function getShiftReminderState() {
  if (!state.session || !canAccessStaffArea()) return null;

  const now = new Date();
  const shifts = getSortedShifts((state.data?.shifts || []).filter((entry) => entry.memberId === state.session.id));
  const activeEntry = getOpenEntryForViewer();

  if (activeEntry) {
    const activeShift =
      (state.data?.shifts || []).find((entry) => entry.id === activeEntry.shiftId) ||
      activeEntry.shift ||
      null;

    if (activeShift) {
      const endAt = getShiftEndDateTime(activeShift);
      if (endAt) {
        const minutesUntilEnd = Math.round((endAt.getTime() - now.getTime()) / 60000);
        if (minutesUntilEnd <= 0) {
          return {
            kind: "check-out-overdue",
            shiftId: activeShift.id,
            tone: "danger",
            title: "Schicht ist vorbei",
            body: `${formatShiftWindow(activeShift)} · ${activeShift.world}. Bitte jetzt ausstempeln, damit deine Zeit sauber erfasst wird.`,
            actionLabel: "Jetzt ausstempeln",
            action: "check-out",
            notificationKey: `check-out-overdue-${activeShift.id}`,
            repeatMinutes: 5
          };
        }

        if (minutesUntilEnd <= 10) {
          return {
            kind: "check-out-soon",
            shiftId: activeShift.id,
            tone: "warning",
            title: "Schicht endet bald",
            body: `${formatShiftWindow(activeShift)} · ${activeShift.world}. In ${formatMinutesLabel(minutesUntilEnd)} bitte ausstempeln.`,
            actionLabel: "Zum Ausstempeln",
            action: "check-out",
            notificationKey: `check-out-soon-${activeShift.id}`,
            repeatMinutes: 10
          };
        }
      }
    }

    return null;
  }

  const candidates = shifts
    .map((shift) => {
      const startAt = getShiftDateTime(shift.date, shift.startTime || "00:00");
      const endAt = getShiftEndDateTime(shift);
      const latestEntry = getLatestEntryForShift(shift.id);
      return {
        shift,
        startAt,
        endAt,
        latestEntry,
        minutesUntilStart: startAt ? Math.round((startAt.getTime() - now.getTime()) / 60000) : Number.MAX_SAFE_INTEGER,
        minutesSinceStart: startAt ? Math.round((now.getTime() - startAt.getTime()) / 60000) : Number.MAX_SAFE_INTEGER
      };
    })
    .filter((entry) => {
      if (!entry.startAt || !entry.endAt) return false;
      if (entry.latestEntry?.checkOutAt) return false;
      return entry.minutesUntilStart <= 60 && entry.minutesSinceStart <= 180;
    })
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  const overdue = candidates.find((entry) => entry.minutesSinceStart >= 0);
  if (overdue) {
    return {
      kind: "check-in-overdue",
      shiftId: overdue.shift.id,
      tone: "danger",
      title: "Du bist noch nicht eingestempelt",
      body: `${formatDate(overdue.shift.date)} · ${formatShiftWindow(overdue.shift)} · ${overdue.shift.world}. Bitte jetzt einstempeln.`,
      actionLabel: "Jetzt einstempeln",
      action: "check-in",
      notificationKey: `check-in-overdue-${overdue.shift.id}`,
      repeatMinutes: 5
    };
  }

  const upcoming = candidates[0];
  if (upcoming) {
    return {
      kind: "check-in-soon",
      shiftId: upcoming.shift.id,
      tone: "warning",
      title: "Deine Schicht startet bald",
      body: `${formatDate(upcoming.shift.date)} · ${formatShiftWindow(upcoming.shift)} · ${upcoming.shift.world}. Bitte kurz vor Start einstempeln.`,
      actionLabel: "Zum Einstempeln",
      action: "check-in",
      notificationKey: `check-in-soon-${upcoming.shift.id}`,
      repeatMinutes: upcoming.minutesUntilStart <= 15 ? 10 : 20
    };
  }

  return null;
}

function shouldEmitShiftReminderNotification(reminder) {
  if (typeof window === "undefined" || !window.localStorage || !state.session || !reminder?.notificationKey) return false;

  const storageKey = `shift-reminder:${state.session.id}:${reminder.notificationKey}`;
  const lastSentAt = Number(window.localStorage.getItem(storageKey) || 0);
  const intervalMs = Math.max(1, Number(reminder.repeatMinutes || 10)) * 60 * 1000;
  const now = Date.now();

  if (now - lastSentAt < intervalMs) {
    return false;
  }

  window.localStorage.setItem(storageKey, String(now));
  return true;
}

function renderShiftReminderBanner() {
  const reminder = getShiftReminderState();
  if (!reminder) return "";

  const browserSupport = typeof window !== "undefined" && "Notification" in window;
  const flashClass =
    reminder.tone === "danger"
      ? "flash-danger"
      : reminder.tone === "warning"
        ? "flash-warning"
        : "flash-info";

  return `
    <section class="flash ${flashClass} shift-reminder-banner">
      <div class="shift-reminder-copy">
        <strong>${escapeHtml(reminder.title)}</strong>
        <span>${escapeHtml(reminder.body)}</span>
      </div>
      <div class="shift-reminder-actions">
        <button type="button" class="small" data-action="${escapeHtml(reminder.action)}" data-shift-id="${escapeHtml(reminder.shiftId)}">${escapeHtml(reminder.actionLabel)}</button>
        <button type="button" class="ghost small" data-action="set-tab" data-tab="time">Zeiten oeffnen</button>
        ${
          browserSupport && state.ui.notificationPermission !== "granted"
            ? '<button type="button" class="ghost small" data-action="enable-browser-notifications">Browser-Popups aktivieren</button>'
            : ""
        }
      </div>
    </section>
  `;
}

function renderNotificationsPanel() {
  const notifications = state.data?.notifications || [];
  const browserSupport = typeof window !== "undefined" && "Notification" in window;
  const reminder = getShiftReminderState();
  const leadership = canManagePortal();
  const staff = canAccessStaffArea();
  const title = leadership
    ? "Automatische Hinweise f\u00fcr Leitung und Planung"
    : isModerationLead()
      ? "Automatische Hinweise f\u00fcr Moderationsleitung"
    : staff
      ? "Automatische Hinweise f\u00fcr Schichten und Staff-News"
      : "Das Wichtigste aus Community, News und Events";
  const copy = leadership
    ? "Offene R\u00fcckmeldungen, heutige Eins\u00e4tze und laufende Schichten werden hier automatisch zusammengefasst."
    : isModerationLead()
      ? "Auslastung, heutige Eins\u00e4tze und offene Moderationspunkte werden hier automatisch gesammelt."
    : staff
      ? "Schicht-Erinnerungen, Staff-News und n\u00e4chste Eins\u00e4tze werden hier automatisch geb\u00fcndelt."
      : "Angeheftete News und kommende Events werden hier automatisch f\u00fcr dich gesammelt.";
  const emptyBody = leadership
    ? "Sobald neue R\u00fcckmeldungen oder Eins\u00e4tze anstehen, erscheinen sie hier."
    : isModerationLead()
      ? "Sobald neue Moderationshinweise oder Planungsinfos anstehen, erscheinen sie hier."
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
            : '<span class="pill neutral">Browser-Popups nicht verf\u00fcgbar</span>'
        }
      </div>

      ${reminder ? renderShiftReminderBanner() : ""}

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

function emitBrowserNotifications() {
  if (!state.session || state.ui.notificationPermission !== "granted") return;

  const notifications = state.data?.notifications || [];
  const latest = notifications[0];
  if (latest) {
    const key = `seen-notification-${state.session.id}`;
    const seenId = window.localStorage.getItem(key);
    if (seenId !== latest.id) {
      window.localStorage.setItem(key, latest.id);
      new Notification(latest.title, {
        body: latest.body
      });
    }
  }

  const reminder = getShiftReminderState();
  if (reminder && shouldEmitShiftReminderNotification(reminder)) {
    new Notification(reminder.title, {
      body: reminder.body
    });
  }
}

function renderDashboard() {
  const user = state.session;
  const manager = canCoordinateStaff();
  const leadership = canManagePortal();
  const staff = canAccessStaffArea();
  const activeTab = normalizeActiveTab(state.ui.activeTab);

  return `
    ${renderWarningOverlay()}
    <div class="app-shell">
      ${renderSonaraHero({
        eyebrow: leadership ? "Leitung" : isModerationLead() ? "Moderationsleitung" : staff ? "Staff Portal" : "Mitgliederbereich",
        title: `Willkommen ${getPrimaryDisplayName(user)}`,
        intro: leadership ? "Community, Team und Staff laufen hier zusammen." : isModerationLead() ? "Du hast Planung, Auslastung und Moderationsuebersicht an einem Ort." : staff ? "Schichten, Chat und Community kompakt an einem Ort." : "News, Forum, Creator und Community auf einen Blick.",
        chips: [ROLE_LABELS[user.role] || user.role, user.vrchatName || "", user.discordName || ""].filter(Boolean)
      })}
      <div class="dashboard-shell">
        ${renderFlash()}
        ${renderSystemNoticeBanner()}
        ${renderShiftReminderBanner()}
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

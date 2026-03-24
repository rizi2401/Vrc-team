const root = document.getElementById("app");

const ROLE_LABELS = {
  viewer: "Moderator",
  planner: "Planer",
  admin: "Admin"
};

const REQUEST_STATUSES = [
  { value: "offen", label: "Offen" },
  { value: "in_planung", label: "In Planung" },
  { value: "beruecksichtigt", label: "Beruecksichtigt" }
];

const state = {
  session: null,
  data: null,
  ui: {
    editingShiftId: "",
    flash: null
  }
};

root.addEventListener("submit", handleSubmit);
root.addEventListener("click", handleClick);

boot();

async function boot() {
  await refreshBootstrap();
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
      return;
    }
    setFlash(error.message, "danger");
  }
}

function applyPayload(payload) {
  state.session = payload?.session || null;
  state.data = payload?.data || null;
}

function render() {
  root.innerHTML = state.session ? renderDashboard() : renderAuth();
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

function renderAuth() {
  return `
    <div class="app-shell">
      <header class="site-header">
        <div>
          <p class="eyebrow">VRChat Moderation Ops</p>
          <h1>ShiftHub fuer dein Moderations-Team</h1>
        </div>
        <p class="intro">
          Plane Schichten, Welten und Aufgaben, sammle Wuensche vom Team, teile Aenderungen sofort
          aus und halte Ein- und Ausstempelzeiten an einem Ort fest.
        </p>
      </header>

      <div class="auth-layout">
        <section class="panel">
          ${renderFlash()}
          <p class="eyebrow">Portal fuer Leitung und Team</p>
          <h2>Ein Zugang pro Person, persoenlicher Plan pro Moderator.</h2>
          <p class="auth-kicker">
            Teamleitung und Planer verwalten Schichten mit Welt und Aufgabe. Moderatoren sehen nur ihre
            eigenen Einsaetze, geben Wuensche ab, nutzen den Tausch-Chat und stempeln sich fuer ihre
            aktiven Schichten ein und aus.
          </p>

          <div class="feature-grid">
            <article class="feature-card">
              <h3>Persoenliche Schichten</h3>
              <p>Jeder Moderator sieht nur den eigenen Einsatzplan mit Welt, Aufgabe und Notizen.</p>
            </article>
            <article class="feature-card">
              <h3>Wuensche an die Leitung</h3>
              <p>Verfuegbarkeit, Notizen und Schichtwuensche landen direkt im Leitungsbereich.</p>
            </article>
            <article class="feature-card">
              <h3>Infoboard</h3>
              <p>Allgemeine Aenderungen und Hinweise werden sofort fuer das ganze Team sichtbar.</p>
            </article>
            <article class="feature-card">
              <h3>Tausch und Zeiten</h3>
              <p>Chat fuer Schichttausch und Buttons zum Ein- und Ausstempeln fuer mehr Ueberblick.</p>
            </article>
          </div>
        </section>

        <div class="auth-stack">
          <form class="panel auth-card" data-form="login">
            <div>
              <p class="eyebrow">Login</p>
              <h3>Mit bestehendem Zugang anmelden</h3>
            </div>

            <div class="auth-fieldset">
              <div class="field">
                <label for="loginUsername">Benutzername</label>
                <input id="loginUsername" name="username" type="text" autocomplete="username" required>
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
              <p class="eyebrow">Neues Teammitglied</p>
              <h3>Eigenen Zugang anlegen</h3>
            </div>

            <div class="auth-fieldset">
              <div class="field">
                <label for="registerDisplayName">Anzeigename</label>
                <input id="registerDisplayName" name="displayName" type="text" required>
              </div>
              <div class="field">
                <label for="registerUsername">Benutzername</label>
                <input id="registerUsername" name="username" type="text" required>
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

            <p class="login-note">Neue Registrierungen werden automatisch als Moderator angelegt.</p>
            <button type="submit">Zugang erstellen</button>
          </form>

          <section class="panel demo-card">
            <div class="section-head">
              <div>
                <p class="eyebrow">Hinweis</p>
                <h3>Demo-Zugaenge nur im Demo-Store</h3>
              </div>
            </div>

            <div class="demo-list">
              <div class="demo-item">
                <div>
                  <strong>Admin</strong>
                  <p class="subtle">Gilt nur bei frischem oder von einem Admin zurueckgesetztem Demo-Store.</p>
                </div>
                <code>admin / admin123!</code>
              </div>
              <div class="demo-item">
                <div>
                  <strong>Moderator Aiko</strong>
                  <p class="subtle">Nur in der Demo-Initialisierung vorhanden.</p>
                </div>
                <code>aiko / mod123!</code>
              </div>
              <div class="demo-item">
                <div>
                  <strong>Immer moeglich</strong>
                  <p class="subtle">Wenn dein aktueller Datenstand andere Zugaenge hat, lege dir einfach ueber das Formular oben einen neuen Moderator-Account an.</p>
                </div>
                <code>Registrierung ohne Login</code>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const manager = canManagePortal();
  const user = state.session;

  return `
    <div class="app-shell">
      <header class="site-header">
        <div>
          <p class="eyebrow">VRChat Moderation Ops</p>
          <h1>${manager ? "Planung und Teamsteuerung" : "Dein Schichtbereich"}</h1>
        </div>
        <p class="intro">
          ${manager
            ? "Plane Einsaetze, verarbeite Teamwuensche, veroeffentliche Aenderungen und halte Stempelzeiten zentral im Blick."
            : "Hier siehst du nur deine Schichten, deine Notizen an die Leitung, den Tausch-Chat und deine Stempelzeiten."}
        </p>
      </header>

      <div class="dashboard-shell">
        ${renderFlash()}
        <section class="panel toolbar">
          <div class="toolbar-user">
            <div class="avatar">${escapeHtml(getInitials(user.displayName))}</div>
            <div>
              <p class="eyebrow">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
              <h2>${escapeHtml(user.displayName)}</h2>
              <p class="section-copy">
                ${manager
                  ? "Du steuerst Schichten, Team-Infos und Rueckmeldungen."
                  : "Du siehst nur deinen persoenlichen Plan und deine eigenen Daten."}
              </p>
            </div>
          </div>

          <div class="toolbar-actions">
            ${canManageUsers() ? '<button type="button" class="ghost small" data-action="reset-demo">Demo wiederherstellen</button>' : ""}
            <button type="button" class="ghost small" data-action="logout">Abmelden</button>
          </div>
        </section>

        ${renderStatsStrip()}

        <div class="dashboard-grid">
          ${manager ? renderManagerDashboard() : renderModeratorDashboard()}
        </div>
      </div>
    </div>
  `;
}

function renderStatsStrip() {
  if (canManagePortal()) {
    const memberCount = (state.data.users || []).filter((entry) => entry.role === "viewer").length;
    const liveEntries = (state.data.timeEntries || []).filter((entry) => !entry.checkOutAt).length;
    const openRequests = (state.data.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
    const nextWeekShifts = getSortedShifts(state.data.shifts || []).filter((entry) => daysBetween(getLocalDateKey(), entry.date) <= 7);

    return `
      <section class="stats-strip">
        ${renderStatCard("Moderatoren", memberCount, "Registrierte Teammitglieder", "teal")}
        ${renderStatCard("Schichten", nextWeekShifts.length, "Einsaetze in den naechsten 7 Tagen", "amber")}
        ${renderStatCard("Offene Wuensche", openRequests, "Noch nicht komplett eingeplant", "rose")}
        ${renderStatCard("Eingestempelt", liveEntries, "Aktuell aktive Moderatoren", "sky")}
      </section>
    `;
  }

  const myShifts = getSortedShifts(state.data.shifts || []);
  const nextShift = myShifts.find((entry) => entry.date >= getLocalDateKey());
  const openRequests = (state.data.requests || []).filter((entry) => entry.status !== "beruecksichtigt").length;
  const activeEntry = getOpenEntryForViewer();
  const totalHours = (state.data.timeEntries || [])
    .filter((entry) => entry.checkOutAt)
    .reduce((total, entry) => total + Math.max(0, new Date(entry.checkOutAt) - new Date(entry.checkInAt)), 0);

  return `
    <section class="stats-strip">
      ${renderStatCard("Naechste Schicht", nextShift ? formatDate(nextShift.date) : "-", nextShift ? nextShift.shiftType : "Noch nichts geplant", "teal")}
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

function renderManagerDashboard() {
  return [
    renderPlannerPanel(),
    renderTeamPanel(),
    renderRequestAdminPanel(),
    renderAnnouncementsPanel(true),
    renderAttendancePanel(true),
    renderSettingsPanel(),
    renderChatPanel(true)
  ].join("");
}

function renderModeratorDashboard() {
  return [
    renderMySchedulePanel(),
    renderRequestMemberPanel(),
    renderAnnouncementsPanel(false),
    renderAttendancePanel(false),
    renderChatPanel(false)
  ].join("");
}

function renderPlannerPanel() {
  const editingShift = (state.data.shifts || []).find((entry) => entry.id === state.ui.editingShiftId) || null;
  const users = getAssignableUsers();
  const shiftsMarkup = getSortedShifts(state.data.shifts || [])
    .map((shift) => renderShiftCard(shift, { adminView: true }))
    .join("");

  return `
    <section class="panel span-8">
      <div class="section-head">
        <div>
          <p class="eyebrow">Schichtplanung</p>
          <h2>Welten, Aufgaben und Besetzung</h2>
          <p class="section-copy">Neue Eintraege sind sofort im persoenlichen Bereich der Moderatoren sichtbar.</p>
        </div>
        <span class="pill neutral">Auto-Save auf dem Server</span>
      </div>

      <div class="planner-layout">
        <form class="stack-form" data-form="shift">
          <div class="form-grid">
            <div class="field">
              <label for="shiftDate">Datum</label>
              <input id="shiftDate" name="date" type="date" value="${escapeHtml(editingShift?.date || getLocalDateKey())}" required>
            </div>
            <div class="field">
              <label for="shiftMember">Moderator</label>
              <select id="shiftMember" name="memberId" required>
                ${buildUserOptions(users, editingShift?.memberId || "")}
              </select>
            </div>
            <div class="field">
              <label for="shiftType">Schichttyp</label>
              <select id="shiftType" name="shiftType" required>
                ${buildStringOptions(state.data.settings.shiftTypes, editingShift?.shiftType || "", "Schichttyp waehlen")}
              </select>
            </div>
            <div class="field">
              <label for="shiftWorld">Welt</label>
              <input id="shiftWorld" name="world" list="worldOptions" value="${escapeHtml(editingShift?.world || "")}" placeholder="z. B. Community Hub" required>
            </div>
            <div class="field">
              <label for="shiftTask">Aufgabe</label>
              <input id="shiftTask" name="task" list="taskOptions" value="${escapeHtml(editingShift?.task || "")}" placeholder="z. B. Patrouille" required>
            </div>
            <div class="field">
              <label for="shiftNotes">Interne Notiz</label>
              <textarea id="shiftNotes" name="notes" placeholder="Briefing, Besonderheiten oder Ansprechpartner">${escapeHtml(editingShift?.notes || "")}</textarea>
            </div>
          </div>

          <datalist id="worldOptions">${renderDatalistOptions(state.data.settings.worlds)}</datalist>
          <datalist id="taskOptions">${renderDatalistOptions(state.data.settings.tasks)}</datalist>

          <div class="card-actions">
            <button type="submit">${editingShift ? "Aenderung speichern" : "Schicht speichern"}</button>
            ${editingShift ? '<button type="button" class="ghost small" data-action="cancel-shift-edit">Bearbeitung abbrechen</button>' : ""}
          </div>
        </form>

        <div class="planner-hint">
          <h3>Team-Workflow</h3>
          <p>
            Lege hier fest, wer wann welche Welt moderiert und welche Aufgabe uebernimmt.
            Moderatoren sehen spaeter nur ihre eigenen Einsaetze, koennen Wuensche senden und ihre Zeiten erfassen.
          </p>

          <div class="inline-stats">
            <span>${escapeHtml(String((state.data.shifts || []).length))} Schichten gespeichert</span>
            <span>${escapeHtml(String((state.data.settings.worlds || []).length))} Welten im Katalog</span>
            <span>${escapeHtml(String((state.data.requests || []).filter((entry) => entry.status === "offen").length))} neue Rueckmeldungen</span>
          </div>
        </div>
      </div>

      <div class="card-list">
        ${shiftsMarkup || renderEmptyState("Noch keine Schichten", "Lege oben den ersten Einsatz an.")}
      </div>
    </section>
  `;
}

function renderShiftCard(shift, options = {}) {
  const openEntry = getOpenEntryForShift(shift.id);
  const latestEntry = getLatestEntryForShift(shift.id);
  const status = openEntry ? "live" : latestEntry?.checkOutAt ? "complete" : "pending";
  const statusLabel = openEntry ? "Eingestempelt" : latestEntry?.checkOutAt ? "Abgeschlossen" : "Geplant";
  const statusTone = openEntry ? "teal" : latestEntry?.checkOutAt ? "success" : "amber";
  const todayShift = shift.date === getLocalDateKey();

  return `
    <article class="mini-card ${status}">
      <div class="status-row">
        <span class="pill ${todayShift ? "teal" : "neutral"}">${escapeHtml(formatDate(shift.date))}</span>
        <span class="pill ${statusTone}">${escapeHtml(statusLabel)}</span>
      </div>
      <div>
        <h3>${escapeHtml(options.adminView ? shift.memberName : `${shift.shiftType} in ${shift.world}`)}</h3>
        <p>${escapeHtml(options.adminView ? `${shift.shiftType} · ${shift.world}` : `Aufgabe: ${shift.task}`)}</p>
      </div>
      <div class="shift-meta">
        <span class="subtle">${escapeHtml(options.adminView ? `Aufgabe: ${shift.task}` : `Schicht: ${shift.shiftType}`)}</span>
        ${options.adminView ? `<span class="subtle">${escapeHtml(roleLabelForUserId(shift.memberId))}</span>` : ""}
      </div>
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

function renderShiftActionRow(shift, openEntry) {
  const isToday = shift.date === getLocalDateKey();
  const activeElsewhere = getOpenEntryForViewer();
  const blockByOtherShift = activeElsewhere && activeElsewhere.shiftId !== shift.id;

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
    <p class="pill-note">
      ${blockByOtherShift
        ? "Du bist bereits in einer anderen Schicht eingestempelt."
        : isToday
          ? "Stempelbuttons sind fuer heutige Einsaetze aktiv."
          : "Stempeln ist am Einsatztag verfuegbar."}
    </p>
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
            <span class="timeline-meta">${escapeHtml(String(shiftCount))} Schichten · ${escapeHtml(String(requestCount))} offen</span>
          </div>
          <div>
            <h3>${escapeHtml(user.displayName)}</h3>
            <p class="timeline-meta">@${escapeHtml(user.username)}</p>
          </div>
          <form data-form="user-update" data-user-id="${escapeHtml(user.id)}">
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

function renderAdminRequestCard(entry) {
  const statusTone = entry.status === "beruecksichtigt" ? "success" : entry.status === "in_planung" ? "amber" : "rose";

  return `
    <article class="request-card">
      <div class="status-row">
        <span class="pill ${statusTone}">${escapeHtml(getStatusLabel(entry.status))}</span>
        <span class="pill neutral">${escapeHtml(entry.type)}</span>
      </div>
      <div>
        <h3>${escapeHtml(entry.userName)}</h3>
        <p class="timeline-meta">${escapeHtml(entry.date ? formatDate(entry.date) : "Ohne fixes Datum")} · ${escapeHtml(formatDateTime(entry.createdAt))}</p>
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
          <p class="eyebrow">Infoboard</p>
          <h2>Aenderungen fuer das gesamte Team</h2>
          <p class="section-copy">Alles, was sofort sichtbar sein soll: Regeln, Event-Hinweise, Weltwechsel oder interne Updates.</p>
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
              <label class="label-row">
                <input name="pinned" type="checkbox">
                <span>Oben anheften</span>
              </label>
              <button type="submit">Info veroeffentlichen</button>
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

    return `
      <section class="panel span-4">
        <div class="section-head">
          <div>
            <p class="eyebrow">Stempelzeiten</p>
            <h2>Wer ist gerade im Einsatz?</h2>
          </div>
        </div>

        ${
          liveEntries.length
            ? liveEntries.map((entry) => renderActiveEntry(entry, false)).join("")
            : renderEmptyState("Niemand aktiv", "Sobald jemand einstempelt, wird er hier gelistet.")
        }

        <div class="stack-list">
          ${history.length ? history.map((entry) => renderTimeEntry(entry, false)).join("") : ""}
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

function renderActiveEntry(entry, personal) {
  return `
    <div class="active-shift">
      <div class="status-row">
        <span class="pill teal">Live</span>
        <span class="timeline-meta">seit ${escapeHtml(formatTime(entry.checkInAt))}</span>
      </div>
      <h3>${escapeHtml(personal ? "Du bist eingestempelt" : entry.memberName)}</h3>
      <p>${escapeHtml(entry.shift ? `${entry.shift.shiftType} · ${entry.shift.world} · ${entry.shift.task}` : "Schicht wurde geloescht")}</p>
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
      <p>${escapeHtml(entry.shift ? `${entry.shift.shiftType} · ${entry.shift.world}` : "Keine Schichtreferenz mehr")}</p>
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

function renderChatPanel(managerView) {
  const availableShifts = managerView
    ? getSortedShifts(state.data.shifts || [])
    : getSortedShifts(state.data.shifts || []);
  const messages = state.data.chatMessages || [];

  return `
    <section class="panel ${managerView ? "span-8" : "span-12"}">
      <div class="section-head">
        <div>
          <p class="eyebrow">Tausch-Chat</p>
          <h2>Schichten tauschen oder Unterstuetzung anfragen</h2>
          <p class="section-copy">Keine direkte 1:1-Nachricht, sondern ein gemeinsamer Team-Thread fuer schnelle Absprachen.</p>
        </div>
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
            : renderEmptyState("Noch kein Tausch-Thread", "Die erste Team-Nachricht erscheint hier.")
        }
      </div>
    </section>
  `;
}

function renderChatMessage(message) {
  const shiftText = message.relatedShift
    ? `${formatDate(message.relatedShift.date)} · ${message.relatedShift.shiftType} · ${message.relatedShift.world}`
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
          <p class="eyebrow">Wuensche fuer die Leitung</p>
          <h2>Notizen, Verfuegbarkeit, besondere Hinweise</h2>
          <p class="section-copy">Diese Eintraege sieht nur die Teamleitung in ihrer Uebersicht.</p>
        </div>
      </div>

      <form class="stack-form" data-form="request">
        <div class="form-grid">
          <div class="field">
            <label for="requestType">Typ</label>
            <select id="requestType" name="type" required>
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
            <label for="requestContent">Nachricht</label>
            <textarea id="requestContent" name="content" placeholder="Schichtwunsch, Ausfall, Wunschwelt oder andere Info" required></textarea>
          </div>
        </div>
        <button type="submit">An Leitung senden</button>
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
        <span class="pill ${statusTone}">${escapeHtml(getStatusLabel(entry.status))}</span>
        <span class="pill neutral">${escapeHtml(entry.type)}</span>
      </div>
      <p>${escapeHtml(entry.content)}</p>
      <p class="timeline-meta">${escapeHtml(entry.date ? formatDate(entry.date) : "Ohne fixes Datum")} · ${escapeHtml(formatDateTime(entry.createdAt))}</p>
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
              username: formData.get("username"),
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
              displayName: formData.get("displayName"),
              username: formData.get("username"),
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
        memberId: formData.get("memberId"),
        shiftType: formData.get("shiftType"),
        world: formData.get("world"),
        task: formData.get("task"),
        notes: formData.get("notes")
      };

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
              content: formData.get("content")
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
              pinned: formData.get("pinned") === "on"
            })
          }),
        "Neue Info wurde veroeffentlicht."
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
      await performAction(
        () =>
          api("/api/chat", {
            method: "POST",
            body: JSON.stringify({
              relatedShiftId: formData.get("relatedShiftId"),
              content: formData.get("content")
            })
          }),
        "Nachricht im Tausch-Chat gepostet."
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
              displayName: formData.get("displayName"),
              username: formData.get("username"),
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
              password: formData.get("password")
            })
          }),
        "Account wurde aktualisiert."
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
      state.ui.editingShiftId = "";
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
          api("/api/chat", {
            method: "POST",
            body: JSON.stringify({
              relatedShiftId: shift.id,
              content: `Ich suche einen Tausch fuer ${shift.shiftType} am ${formatDate(shift.date)} in ${shift.world}. Bitte hier melden.`
            })
          }),
        "Tausch-Anfrage wurde in den Chat gestellt."
      );
      break;
    }

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

function canManagePortal() {
  return state.session?.role === "planner" || state.session?.role === "admin";
}

function canManageUsers() {
  return state.session?.role === "admin";
}

function getAssignableUsers() {
  return (state.data.users || []).slice().sort((left, right) => left.displayName.localeCompare(right.displayName, "de"));
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
      if (left.shiftType !== right.shiftType) return left.shiftType.localeCompare(right.shiftType, "de");
      return left.world.localeCompare(right.world, "de");
    });
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

function buildUserOptions(users, selectedId) {
  return [
    '<option value="">Moderator waehlen</option>',
    ...users.map(
      (user) => `
        <option value="${escapeHtml(user.id)}" ${user.id === selectedId ? "selected" : ""}>
          ${escapeHtml(user.displayName)} (@${escapeHtml(user.username)})
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
  const label = `${formatDate(shift.date)} · ${shift.shiftType} · ${shift.world}${shift.memberName ? ` · ${shift.memberName}` : ""}`;
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

function formatDuration(milliseconds) {
  if (!milliseconds || milliseconds < 0) return "0h 00m";

  const totalMinutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

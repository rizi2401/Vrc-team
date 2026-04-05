const dashboardData = {
  today: {
    label: "Heute",
    lastUpdated: "01.04.2026, 14:30",
    metrics: [
      {
        label: "Live Score",
        value: "82 / 100",
        note: "Starkes Reward-Interesse, aber Momentum kippt nach Minute 70."
      },
      {
        label: "Highlight-Quote",
        value: "4 starke Clips",
        note: "Vor allem spontane Reaktionen und klare Stakes funktionieren."
      },
      {
        label: "Upgrade-Druck",
        value: "2 Tools faellig",
        note: "OBS ist nah dran, Streamer.bot hinkt fuer Makro-Aktionen hinterher."
      }
    ],
    overview: [
      {
        label: "Reward-Risiko",
        value: "63%",
        note: "Drei Rewards verlieren innerhalb der naechsten 3 Stunden sichtbar Zug."
      },
      {
        label: "Chat-Zugkraft",
        value: "+18%",
        note: "Challenge-Momente treiben Beteiligung klar ueber den Tageswert."
      },
      {
        label: "Avg. Watchtime",
        value: "17m 40s",
        note: "Gut genug fuer Highlight-Recycling, aber zu viele Dellen nach ruhigen Erklaerpassagen."
      }
    ],
    actions: [
      "Belohnung 'One More Try' noch im Stream verbal nachfassen, sonst laeuft sie im letzten Drittel aus.",
      "Vor Boss-Fights kuerzere Setups fahren. Der Chat bleibt bei Stakes, nicht bei Vorerklaerungen.",
      "OBS-Update in den naechsten 48 Stunden einplanen, bevor du neue Overlay-Szenen baust."
    ],
    rewards: [
      {
        name: "One More Try",
        runoutHours: 1.4,
        progress: 34,
        state: "critical",
        redemptions: 21,
        target: 48,
        sentiment: 71,
        note: "Der Hook zieht, aber nur solange der Einsatz sofort sichtbar wird."
      },
      {
        name: "Blindfold Runde",
        runoutHours: 2.2,
        progress: 49,
        state: "warning",
        redemptions: 16,
        target: 30,
        sentiment: 84,
        note: "Hohe Clip-Chance. Funktioniert besonders gut, wenn du den Fail deutlich callst."
      },
      {
        name: "Boss Fight Doppelung",
        runoutHours: 4.9,
        progress: 61,
        state: "stable",
        redemptions: 34,
        target: 50,
        sentiment: 79,
        note: "Lange Haltbarkeit, solange die Session als Event und nicht als Routine wirkt."
      }
    ],
    highlights: [
      {
        id: "highlight-1",
        title: "Blindfold-Fail mit Sofort-Reaktion",
        time: "00:43:12",
        score: 92,
        tags: ["Reaktion", "Clipbar", "Chat-Peak"],
        reason: "Der Chat sprang in 14 Sekunden um 41 Prozent hoch, weil der Fail sofort lesbar und emotional war.",
        worked: [
          "Du hast in der ersten Sekunde sichtbar reagiert, statt die Szene totzuerklaeren.",
          "Die Stakes waren vorher klar, dadurch versteht auch ein Kurzclip den Kontext."
        ],
        improve: [
          "Nach dem Lacher haette ein kurzer Replay-Call fuer Shorts und TikTok noch mehr Value erzeugt.",
          "Der Ausstieg war etwas abrupt. Eine bewusst gesetzte Punchline haette den Moment sauber geschlossen."
        ]
      },
      {
        id: "highlight-2",
        title: "Boss-Anlauf mit Chat-Wette",
        time: "01:12:48",
        score: 87,
        tags: ["Spannung", "Reward-Fit", "Retention"],
        reason: "Starke Mischung aus Risiko und Beteiligung. Zuschauer blieben fuer die Aufloesung deutlich laenger drin.",
        worked: [
          "Die Chat-Wette gab dem Versuch sofort Bedeutung.",
          "Reward und Gameplay waren deckungsgleich. Niemand musste den Witz erklaert bekommen."
        ],
        improve: [
          "Der Vorlauf war 20 bis 30 Sekunden zu lang.",
          "Ein klarer CTA fuer die naechste Einloesung haette die Reward-Kette offen gehalten."
        ]
      },
      {
        id: "highlight-3",
        title: "Community-Roast auf den Build",
        time: "02:06:21",
        score: 79,
        tags: ["Community", "Memes", "Warmup"],
        reason: "Sehr gute Stimmung, aber die Szene lebt mehr im Stream als im isolierten Social Clip.",
        worked: [
          "Die Community war sofort drin und hat neue Gags nachgeschoben.",
          "Du hast Timing gelassen und nicht zu frueh den naechsten Themenblock erzwungen."
        ],
        improve: [
          "Fuer ein externes Highlight fehlt ein klarer Einstiegssatz.",
          "Die Pointe verteilt sich ueber zu viele kleine Momente statt ueber einen grossen Beat."
        ]
      }
    ],
    versions: [
      {
        tool: "OBS Studio",
        installed: "31.0.2",
        latest: "31.0.3",
        gap: "1 Patch",
        severity: "medium",
        source: "Release Feed",
        note: "Kleines Sicherheits- und Stabilitaetsfenster. Update vor dem naechsten Grafikumbau."
      },
      {
        tool: "Streamer.bot",
        installed: "0.2.6",
        latest: "0.2.8",
        gap: "2 Versionen",
        severity: "high",
        source: "Maintainer Track",
        note: "Makro-Aktionen und Reward-Automation sollten hier zuerst nachgezogen werden."
      },
      {
        tool: "Mix It Up",
        installed: "230.0",
        latest: "230.2",
        gap: "1 Minor",
        severity: "low",
        source: "Desktop Poll",
        note: "Kein Blocker, aber sinnvoll fuer saubere Command-Queues."
      }
    ],
    pulse: [
      { label: "0m", intensity: 34 },
      { label: "15m", intensity: 46 },
      { label: "30m", intensity: 58 },
      { label: "45m", intensity: 87 },
      { label: "60m", intensity: 72 },
      { label: "75m", intensity: 62 },
      { label: "90m", intensity: 91 },
      { label: "105m", intensity: 83 },
      { label: "120m", intensity: 60 },
      { label: "135m", intensity: 49 },
      { label: "150m", intensity: 67 },
      { label: "165m", intensity: 52 }
    ]
  },
  week: {
    label: "7 Tage",
    lastUpdated: "01.04.2026, 14:30",
    metrics: [
      {
        label: "Live Score",
        value: "76 / 100",
        note: "Die Woche war solide, aber Reward-Aktivierung startete mehrfach zu spaet."
      },
      {
        label: "Highlight-Quote",
        value: "11 starke Clips",
        note: "Die besten Ausschnitte kamen immer aus Sessions mit klaren Minizielen."
      },
      {
        label: "Upgrade-Druck",
        value: "3 Tools faellig",
        note: "Workflow-Tools driften auseinander. Das kostet Tempo in Live-Momenten."
      }
    ],
    overview: [
      {
        label: "Reward-Risiko",
        value: "58%",
        note: "Vor allem wiederkehrende Rewards verlieren nach dem zweiten Streamabend ihren Reiz."
      },
      {
        label: "Chat-Zugkraft",
        value: "+11%",
        note: "Wenn du Community-Wetten oeffnest, bleibt die Beteiligung stabil."
      },
      {
        label: "Avg. Watchtime",
        value: "15m 05s",
        note: "Die Woche hatte gute Spitzen, aber zu viele ruhige Ueberleitungen."
      }
    ],
    actions: [
      "Reward-Rotation straffer machen. Rewards mit aehnlichem Effekt nicht zwei Streams hintereinander fahren.",
      "Highlight-Sequenzen spaeter im Stream kuerzer antiesen und frueher ausspielen.",
      "Streamer.bot und Mix It Up angleichen, damit Chat- und Trigger-Logik nicht auseinanderlaufen."
    ],
    rewards: [
      {
        name: "Boss auf Zeit",
        runoutHours: 3.1,
        progress: 46,
        state: "warning",
        redemptions: 58,
        target: 104,
        sentiment: 76,
        note: "Zieht gut an, wenn du Countdown und Risiko im Bild haeltst."
      },
      {
        name: "Random Build Order",
        runoutHours: 5.4,
        progress: 53,
        state: "stable",
        redemptions: 49,
        target: 88,
        sentiment: 82,
        note: "Stark fuer Repeat-Viewers. Braucht einen klaren visuellen Reset."
      },
      {
        name: "No Heals Challenge",
        runoutHours: 2.7,
        progress: 29,
        state: "critical",
        redemptions: 33,
        target: 79,
        sentiment: 69,
        note: "Zu erklaerlastig eingefuehrt. Reward-Promise muss in einem Satz sitzen."
      }
    ],
    highlights: [
      {
        id: "week-highlight-1",
        title: "Countdown-Challenge mit echtem Risiko",
        time: "Best of Mittwoch",
        score: 90,
        tags: ["Stakes", "YouTube", "Retention"],
        reason: "Dein staerkster Wochenausschnitt, weil die Geschichte sofort verstanden wird und der Ausgang offen bleibt.",
        worked: [
          "Guter Spannungsbogen mit klarer Uhr und sichtbaren Konsequenzen.",
          "Chat und Gameplay haben sich gegenseitig hochgezogen."
        ],
        improve: [
          "Ein schnellerer Titel-Call waere fuer den Clip-Einstieg noch besser.",
          "Nach der Aufloesung fehlte eine kurze emotionale Nachreaktion."
        ]
      },
      {
        id: "week-highlight-2",
        title: "Spontane Community-Bestrafung",
        time: "Best of Freitag",
        score: 84,
        tags: ["Community", "Shorts", "Reward"],
        reason: "Sehr gute Zuschauerbeteiligung, weil der Reward direkt in Aktion uebersetzt wurde.",
        worked: [
          "Sofortige Umsetzung ohne Leerlauf.",
          "Klarer Witz, der auch ohne Stream-Vorwissen funktioniert."
        ],
        improve: [
          "Noch besser waere ein festes Outro-Signal fuer Social Clips.",
          "Eine kuerzere Vorerklaerung wuerde mehr Schlagkraft geben."
        ]
      },
      {
        id: "week-highlight-3",
        title: "Build-Review mit Meme-Eskalation",
        time: "Best of Sonntag",
        score: 77,
        tags: ["Community", "Inside Joke", "Stream Only"],
        reason: "Im Stream sehr charmant, als externer Clip aber nur bedingt selbsterklaerend.",
        worked: [
          "Du hast die Community nicht uebersteuert und den Bit wachsen lassen.",
          "Guter Warmup fuer laengere Sessions."
        ],
        improve: [
          "Ein klarer Einstiegssatz fehlt.",
          "Der beste Gag kommt zu spaet fuer Kurzformat-Recycling."
        ]
      }
    ],
    versions: [
      {
        tool: "OBS Studio",
        installed: "31.0.1",
        latest: "31.0.3",
        gap: "2 Patches",
        severity: "medium",
        source: "Release Feed",
        note: "Noch okay, aber nicht mit offenen Szene-Aenderungen kombinieren."
      },
      {
        tool: "Streamer.bot",
        installed: "0.2.5",
        latest: "0.2.8",
        gap: "3 Versionen",
        severity: "high",
        source: "Maintainer Track",
        note: "Hier steckt die groesste Friktion in deinem Reward-Workflow."
      },
      {
        tool: "Voicemeeter",
        installed: "3.1.0.1",
        latest: "3.1.1.0",
        gap: "1 Minor",
        severity: "low",
        source: "Audio Poll",
        note: "Optional, aber sinnvoll fuer Audio-Stabilitaet bei langen Sessions."
      }
    ],
    pulse: [
      { label: "Mo", intensity: 48 },
      { label: "Di", intensity: 56 },
      { label: "Mi", intensity: 92 },
      { label: "Do", intensity: 61 },
      { label: "Fr", intensity: 86 },
      { label: "Sa", intensity: 52 },
      { label: "So", intensity: 69 },
      { label: "Mo2", intensity: 58 },
      { label: "Di2", intensity: 73 },
      { label: "Mi2", intensity: 64 },
      { label: "Do2", intensity: 78 },
      { label: "Fr2", intensity: 67 }
    ]
  },
  month: {
    label: "30 Tage",
    lastUpdated: "01.04.2026, 14:30",
    metrics: [
      {
        label: "Live Score",
        value: "81 / 100",
        note: "Das Monatsbild ist stark. Besonders Rewards mit Risiko-Mechanik bleiben tragfaehig."
      },
      {
        label: "Highlight-Quote",
        value: "29 verwertbare Clips",
        note: "Die besten Momente folgen fast immer auf klare Ansagen und sichtbare Stakes."
      },
      {
        label: "Upgrade-Druck",
        value: "1 echter Blocker",
        note: "Dein Stack ist nah dran, aber Reward-Automation braucht eine konsistente Basis."
      }
    ],
    overview: [
      {
        label: "Reward-Risiko",
        value: "41%",
        note: "Das Monatsbild ist stabil. Nur Rewards ohne klare Konsequenz flachen zu frueh ab."
      },
      {
        label: "Chat-Zugkraft",
        value: "+23%",
        note: "Die Community reagiert messbar auf duellartige oder zeitkritische Formate."
      },
      {
        label: "Avg. Watchtime",
        value: "18m 12s",
        note: "Stark genug fuer Longform-Recycling. Deine besten Streams halten Fokus durch sichtbare Ziele."
      }
    ],
    actions: [
      "Die monatlich besten Reward-Typen zu einer festen Rotation verdichten.",
      "Clip-Workflow standardisieren: Titel-Call, kurzer Beat danach, dann erst Segmentwechsel.",
      "Nur einen Automations-Stack fuer Rewards und Chat-Aktionen als Primary Path definieren."
    ],
    rewards: [
      {
        name: "Sudden Death Runde",
        runoutHours: 7.4,
        progress: 68,
        state: "stable",
        redemptions: 144,
        target: 203,
        sentiment: 88,
        note: "Monatssieger, weil Stakes sofort sichtbar und universell verstaendlich sind."
      },
      {
        name: "Controller-Switch",
        runoutHours: 4.1,
        progress: 44,
        state: "warning",
        redemptions: 89,
        target: 174,
        sentiment: 73,
        note: "Funktioniert besser mit festem Timing statt spontanem Einwurf."
      },
      {
        name: "No HUD Run",
        runoutHours: 2.9,
        progress: 27,
        state: "critical",
        redemptions: 51,
        target: 140,
        sentiment: 66,
        note: "Zu abstrakt im Framing. Zuschauer verstehen den Mehrwert erst zu spaet."
      }
    ],
    highlights: [
      {
        id: "month-highlight-1",
        title: "Sudden-Death-Comeback",
        time: "Monatsclip #1",
        score: 95,
        tags: ["YouTube", "Hero Moment", "Retention"],
        reason: "Bester Monatsmoment: starke Geschichte, sichtbarer Druck, klare Aufloesung.",
        worked: [
          "Das Setup war in einem Satz klar.",
          "Deine Reaktion und der Chat Peak kamen exakt im richtigen Fenster."
        ],
        improve: [
          "Ein kurzer verbaler Callback auf die Reward-Herkunft waere fuer Kontextclips hilfreich.",
          "Mini-Delay vor dem Themenwechsel haette den Sieg laenger tragen lassen."
        ]
      },
      {
        id: "month-highlight-2",
        title: "Rage-to-Reset mit Community-Call",
        time: "Monatsclip #2",
        score: 89,
        tags: ["Shorts", "Memetic", "Reward"],
        reason: "Funktioniert plattformuebergreifend, weil der Moment sofort lesbar ist.",
        worked: [
          "Starke Energie und guter Rhythmus zwischen Frust und Humor.",
          "Die Community wurde nicht nur Zuschauer, sondern Teil des Beats."
        ],
        improve: [
          "Das Framing koennte eine halbe Sekunde frueher kommen.",
          "Ein knackigerer Exit wuerde die Wiederholbarkeit verbessern."
        ]
      },
      {
        id: "month-highlight-3",
        title: "Build-Roast als Running Gag",
        time: "Monatsclip #3",
        score: 80,
        tags: ["Community", "Series", "Stream Only"],
        reason: "Im Stream sehr wertvoll fuer Bindung, fuer externe Clips nur mit mehr Kontext ideal.",
        worked: [
          "Gute Community-Naehe und sehr natuerlicher Flow.",
          "Der Running Gag kann eine Serie tragen."
        ],
        improve: [
          "Mehr Kontext am Anfang macht ihn social-tauglicher.",
          "Eine klarere Schlusspointe waere noetig."
        ]
      }
    ],
    versions: [
      {
        tool: "OBS Studio",
        installed: "31.0.2",
        latest: "31.0.3",
        gap: "1 Patch",
        severity: "low",
        source: "Release Feed",
        note: "Monatsweit unkritisch. Bei neuen Szenen trotzdem erst nach Backup updaten."
      },
      {
        tool: "Streamer.bot",
        installed: "0.2.6",
        latest: "0.2.8",
        gap: "2 Versionen",
        severity: "high",
        source: "Maintainer Track",
        note: "Das ist dein groesster Hebel fuer weniger Reibung bei Reward-Ausloesern."
      },
      {
        tool: "Mix It Up",
        installed: "229.9",
        latest: "230.2",
        gap: "1 Major",
        severity: "medium",
        source: "Desktop Poll",
        note: "Nicht sofort kritisch, aber fuer saubere Moderations- und Queue-Logik sinnvoll."
      }
    ],
    pulse: [
      { label: "W1", intensity: 59 },
      { label: "W2", intensity: 71 },
      { label: "W3", intensity: 83 },
      { label: "W4", intensity: 78 },
      { label: "W5", intensity: 88 },
      { label: "W6", intensity: 64 },
      { label: "W7", intensity: 76 },
      { label: "W8", intensity: 81 },
      { label: "W9", intensity: 69 },
      { label: "W10", intensity: 73 },
      { label: "W11", intensity: 86 },
      { label: "W12", intensity: 79 }
    ]
  }
};

const state = {
  range: "today",
  selectedHighlightId: dashboardData.today.highlights[0].id,
  tiktok: {
    loading: true,
    connected: false,
    configured: false,
    needsSetup: false,
    profile: null,
    videos: [],
    statusNote: "Kanalstatus wird geladen."
  }
};

const elements = {
  lastUpdated: document.querySelector("#last-updated"),
  analysisMode: document.querySelector("#analysis-mode"),
  headlineMetrics: document.querySelector("#headline-metrics"),
  overviewBand: document.querySelector("#overview-band"),
  rewardRunway: document.querySelector("#reward-runway"),
  highlightList: document.querySelector("#highlight-list"),
  versionList: document.querySelector("#version-list"),
  coachSummary: document.querySelector("#coach-summary"),
  highlightDetail: document.querySelector("#highlight-detail"),
  pulseChart: document.querySelector("#pulse-chart"),
  priorityActions: document.querySelector("#priority-actions"),
  rangeSwitch: document.querySelector("#range-switch"),
  tiktokAccountCard: document.querySelector("#tiktok-account-card"),
  tiktokVideoGrid: document.querySelector("#tiktok-video-grid"),
  tiktokStatusNote: document.querySelector("#tiktok-status-note"),
  tiktokConnectButton: document.querySelector("#tiktok-connect-button"),
  tiktokDisconnectButton: document.querySelector("#tiktok-disconnect-button")
};

function getActiveDataset() {
  return dashboardData[state.range];
}

function render() {
  const dataset = getActiveDataset();

  elements.lastUpdated.textContent = dataset.lastUpdated;
  elements.analysisMode.textContent = dataset.label;

  renderMetrics(dataset.metrics);
  renderOverview(dataset.overview);
  renderRewards(dataset.rewards);
  renderHighlights(dataset.highlights);
  renderVersions(dataset.versions);
  renderCoachSummary(buildCoachSummary(dataset));
  renderHighlightDetail(getSelectedHighlight(dataset));
  renderPulse(dataset.pulse);
  renderActions(dataset.actions);
  renderTikTokPanel();
  updateRangeButtons();
}

function renderMetrics(metrics) {
  elements.headlineMetrics.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-tile">
          <span class="metric-label">${metric.label}</span>
          <p class="metric-value">${metric.value}</p>
          <p class="metric-note">${metric.note}</p>
        </article>
      `
    )
    .join("");
}

function renderOverview(overview) {
  elements.overviewBand.innerHTML = overview
    .map(
      (item) => `
        <article class="score-tile">
          <span class="metric-label">${item.label}</span>
          <p class="score-value">${item.value}</p>
          <p class="score-note">${item.note}</p>
        </article>
      `
    )
    .join("");
}

function renderRewards(rewards) {
  const sortedRewards = [...rewards].sort((a, b) => a.runoutHours - b.runoutHours);

  elements.rewardRunway.innerHTML = sortedRewards
    .map((reward) => {
      const urgencyCopy =
        reward.state === "critical"
          ? "Sofort nachschieben"
          : reward.state === "warning"
            ? "Im Blick behalten"
            : "Stabil tragen";

      return `
        <article class="reward-item">
          <div class="reward-topline">
            <div>
              <span class="section-kicker">Belohnung</span>
              <h3 class="reward-name">${reward.name}</h3>
            </div>
            <span class="signal-state ${reward.state}">${urgencyCopy}</span>
          </div>

          <div class="reward-bar" aria-hidden="true">
            <div class="reward-bar-fill" style="width: ${reward.progress}%"></div>
          </div>

          <div class="reward-stats">
            <span class="token"><span class="token-label">Laeuft aus in</span><strong>${formatRunout(reward.runoutHours)}</strong></span>
            <span class="token"><span class="token-label">Redeems</span><strong>${reward.redemptions} / ${reward.target}</strong></span>
            <span class="token"><span class="token-label">Stimmung</span><strong>${reward.sentiment}%</strong></span>
          </div>

          <div class="reward-meta">
            <p class="reward-note">${reward.note}</p>
            <span class="section-kicker">Momentum ${reward.progress}%</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderHighlights(highlights) {
  elements.highlightList.innerHTML = highlights
    .map(
      (highlight) => `
        <article
          class="highlight-item ${highlight.id === state.selectedHighlightId ? "active" : ""}"
          data-highlight-id="${highlight.id}"
          tabindex="0"
          role="button"
          aria-pressed="${highlight.id === state.selectedHighlightId}"
        >
          <div class="highlight-topline">
            <div>
              <span class="section-kicker">${highlight.time}</span>
              <h3>${highlight.title}</h3>
            </div>
            <span class="highlight-score">${highlight.score}</span>
          </div>
          <p class="highlight-reason">${highlight.reason}</p>
          <div class="highlight-meta">
            ${highlight.tags.map((tag) => `<span class="micro-tag">${tag}</span>`).join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function renderVersions(versions) {
  const severityLabel = {
    high: "Schnell handeln",
    medium: "Einplanen",
    low: "Beobachten"
  };

  elements.versionList.innerHTML = versions
    .map(
      (version) => `
        <article class="version-item">
          <div class="version-topline">
            <div>
              <span class="version-source">${version.source}</span>
              <h3>${version.tool}</h3>
            </div>
            <div>
              <div class="version-gap">${version.gap}</div>
              <span class="version-severity ${version.severity}">${severityLabel[version.severity]}</span>
            </div>
          </div>
          <div class="version-current">
            <div class="version-row"><span>Installiert</span><strong>${version.installed}</strong></div>
            <div class="version-row"><span>Aktuell</span><strong>${version.latest}</strong></div>
          </div>
          <p class="version-note">${version.note}</p>
        </article>
      `
    )
    .join("");
}

function buildCoachSummary(dataset) {
  const topHighlight = [...dataset.highlights].sort((a, b) => b.score - a.score)[0];
  const rewardPressure = [...dataset.rewards].sort((a, b) => a.runoutHours - b.runoutHours)[0];
  const upgradePressure = [...dataset.versions].sort(severityRank)[0];

  return [
    {
      title: "Was klar funktioniert",
      copy: `${topHighlight.title} ist dein staerkstes Muster. Klare Stakes plus sofort sichtbare Reaktion bringen hier die beste Mischung aus Retention und Clip-Wert.`
    },
    {
      title: "Was gerade abfaellt",
      copy: `${rewardPressure.name} verliert zuerst Tempo. Wenn der Nutzen einer Reward-Einloesung nicht in wenigen Sekunden sichtbar wird, bricht das Redemption-Momentum weg.`
    },
    {
      title: "Was du besser machen kannst",
      copy: `Verkuerze Erklaerphasen vor Highlights und Rewards. ${upgradePressure.tool} sollte ausserdem als naechstes konsolidiert werden, damit deine Live-Ausloeser ohne Reibung sitzen.`
    }
  ];
}

function renderCoachSummary(summaryBlocks) {
  elements.coachSummary.innerHTML = summaryBlocks
    .map(
      (block) => `
        <article class="coach-block">
          <h3>${block.title}</h3>
          <p class="coach-copy">${block.copy}</p>
        </article>
      `
    )
    .join("");
}

function renderHighlightDetail(highlight) {
  elements.highlightDetail.innerHTML = `
    <article class="detail-block">
      <div class="detail-topline">
        <div>
          <span class="section-kicker">${highlight.time}</span>
          <h3>${highlight.title}</h3>
        </div>
        <span class="detail-score">Score ${highlight.score}</span>
      </div>
      <p class="detail-copy">${highlight.reason}</p>
    </article>

    <article class="detail-block">
      <h3>Was gut war</h3>
      <ul class="text-list">
        ${highlight.worked.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </article>

    <article class="detail-block">
      <h3>Was du besser machen kannst</h3>
      <ul class="text-list">
        ${highlight.improve.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </article>
  `;
}

function renderPulse(pulsePoints) {
  elements.pulseChart.innerHTML = pulsePoints
    .map(
      (point, index) => `
        <div class="pulse-bar">
          <div
            class="pulse-stack"
            style="--intensity: ${point.intensity}; --index: ${index}"
            title="${point.label}: ${point.intensity}"
          ></div>
          <span class="pulse-label">${point.label}</span>
        </div>
      `
    )
    .join("");
}

function renderActions(actions) {
  elements.priorityActions.innerHTML = actions.map((action) => `<li>${action}</li>`).join("");
}

function renderTikTokPanel() {
  const tiktokState = state.tiktok;

  elements.tiktokStatusNote.textContent = tiktokState.statusNote;
  elements.tiktokConnectButton.disabled = tiktokState.loading;
  elements.tiktokConnectButton.textContent = tiktokState.loading
    ? "Verbindung wird geladen..."
    : tiktokState.connected
      ? "Neu verbinden"
      : "TikTok verknuepfen";
  elements.tiktokDisconnectButton.classList.toggle("is-hidden", !tiktokState.connected);

  if (tiktokState.connected && tiktokState.profile) {
    renderConnectedTikTokAccount(tiktokState);
    renderTikTokVideos(tiktokState.videos);
    return;
  }

  renderTikTokSetupCard(tiktokState);
  renderTikTokVideos([]);
}

function renderConnectedTikTokAccount(tiktokState) {
  const profile = tiktokState.profile;
  const displayName = escapeHtml(profile.display_name || "TikTok Kanal");
  const openId = escapeHtml(profile.open_id || "nicht verfuegbar");
  const avatarMarkup = profile.avatar_url
    ? `<img class="tiktok-avatar" src="${profile.avatar_url}" alt="${displayName} Avatar" />`
    : `<div class="tiktok-avatar-fallback">${getInitials(profile.display_name)}</div>`;

  elements.tiktokAccountCard.innerHTML = `
    <article class="tiktok-account-card">
      <div class="tiktok-account-head">
        ${avatarMarkup}
        <div class="tiktok-account-meta">
          <span class="section-kicker">Verbunden</span>
          <h3>${displayName}</h3>
          <span class="tiktok-handle">Open ID: ${openId}</span>
        </div>
      </div>
      <div class="tiktok-chip-row">
        <span class="tiktok-chip">Scopes: ${tiktokState.grantedScopes || "user.info.basic,video.list"}</span>
        <span class="tiktok-chip">Videos geladen: ${tiktokState.videos.length}</span>
      </div>
      <p class="detail-copy">
        Dein Kanal ist verbunden. Die neuesten Videos kommen direkt aus der TikTok API
        und koennen hier als Ausgangspunkt fuer Reposts oder Highlight-Vergleiche dienen.
      </p>
    </article>
  `;
}

function renderTikTokSetupCard(tiktokState) {
  const setupNote = tiktokState.needsSetup
    ? `
        <p class="detail-copy">
          Hinterlege auf Render die Variablen <code>PUBLIC_APP_URL</code>,
          <code>TIKTOK_CLIENT_KEY</code>, <code>TIKTOK_CLIENT_SECRET</code> und
          <code>TIKTOK_REDIRECT_URI</code>. Lokal kannst du dieselben Werte ueber eine
          <code>.env</code> auf Basis von <code>.env.example</code> setzen.
        </p>
        <p class="detail-copy">
          Redirect URI fuer die TikTok App: <code>${escapeHtml(tiktokState.redirectUri || "https://your-service.onrender.com/auth/tiktok/callback/")}</code>
        </p>
      `
    : `
        <p class="detail-copy">
          Sobald du auf Verbinden klickst und die Freigabe bestaetigst, erscheinen hier
          dein Kanal und deine letzten TikTok-Videos.
        </p>
      `;

  elements.tiktokAccountCard.innerHTML = `
    <article class="tiktok-setup-card">
      <span class="section-kicker">Noch nicht verbunden</span>
      <h3>${tiktokState.needsSetup ? "TikTok App-Daten fehlen noch" : "TikTok Connect ist bereit"}</h3>
      ${setupNote}
    </article>
  `;
}

function renderTikTokVideos(videos) {
  if (!videos.length) {
    elements.tiktokVideoGrid.innerHTML = `
      <div class="tiktok-empty">
        Noch keine TikTok-Videos im Dashboard. Nach der Verbindung werden hier die letzten
        Clips aus deinem Kanal geladen.
      </div>
    `;
    return;
  }

  elements.tiktokVideoGrid.innerHTML = videos
    .map((video) => {
      const coverMarkup = video.coverImageUrl
        ? `<img class="tiktok-cover" src="${video.coverImageUrl}" alt="${escapeHtml(video.title)}" />`
        : `<div class="tiktok-cover-fallback">TikTok</div>`;

      return `
        <article class="tiktok-video-card">
          ${coverMarkup}
          <div>
            <p class="tiktok-video-title">${escapeHtml(video.title)}</p>
            <div class="tiktok-video-meta">
              <span>${formatSeconds(video.duration)}</span>
              ${
                video.shareUrl
                  ? `<a class="tiktok-link" href="${video.shareUrl}" target="_blank" rel="noreferrer">Oeffnen</a>`
                  : `<span>Nur API-Daten</span>`
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function getSelectedHighlight(dataset) {
  return (
    dataset.highlights.find((highlight) => highlight.id === state.selectedHighlightId) ||
    dataset.highlights[0]
  );
}

function severityRank(a, b) {
  const ranking = { high: 0, medium: 1, low: 2 };
  return ranking[a.severity] - ranking[b.severity];
}

function formatRunout(hours) {
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);

  if (wholeHours <= 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${wholeHours}h`;
  }

  return `${wholeHours}h ${minutes}m`;
}

function updateRangeButtons() {
  const buttons = elements.rangeSwitch.querySelectorAll("[data-range]");

  buttons.forEach((button) => {
    const isActive = button.dataset.range === state.range;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor((totalSeconds || 0) / 60);
  const seconds = (totalSeconds || 0) % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getInitials(label = "TT") {
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getTikTokFeedbackMessage() {
  const params = new URLSearchParams(window.location.search);
  const tiktokState = params.get("tiktok");
  const message = params.get("message");

  if (!tiktokState) {
    return "";
  }

  const decodedMessage = message ? decodeURIComponent(message) : "";
  const messages = {
    connected: "TikTok wurde erfolgreich verbunden.",
    "missing-config": "TikTok ist noch nicht konfiguriert. Trage zuerst die Werte in deine .env ein.",
    error: decodedMessage ? `TikTok Fehler: ${decodedMessage}` : "Beim Verbinden mit TikTok ist ein Fehler aufgetreten."
  };

  const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, document.title, cleanUrl);

  return messages[tiktokState] || "";
}

async function refreshTikTokStatus() {
  const urlFeedback = getTikTokFeedbackMessage();
  state.tiktok = {
    ...state.tiktok,
    loading: true,
    statusNote: urlFeedback || "Kanalstatus wird geladen."
  };
  renderTikTokPanel();

  try {
    const response = await fetch("/api/tiktok/status", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("TikTok-Status konnte nicht geladen werden.");
    }

    const payload = await response.json();
    state.tiktok = {
      loading: false,
      connected: payload.connected,
      configured: payload.configured,
      needsSetup: payload.needsSetup,
      profile: payload.profile || null,
      videos: payload.videos || [],
      grantedScopes: payload.grantedScopes || payload.scopes || "",
      redirectUri: payload.redirectUri,
      statusNote:
        urlFeedback ||
        (payload.connected
          ? "TikTok-Kanal verbunden und synchronisiert."
          : payload.needsSetup
            ? "TikTok App-Daten fehlen noch."
            : payload.error
              ? `TikTok muss neu verbunden werden: ${payload.error}`
              : "Bereit fuer die Verbindung mit deinem TikTok-Kanal.")
    };
  } catch (error) {
    state.tiktok = {
      ...state.tiktok,
      loading: false,
      connected: false,
      statusNote:
        "Server nicht erreichbar. Starte die Seite ueber `node server.js`, damit die TikTok-Verbindung funktioniert."
    };
  }

  renderTikTokPanel();
}

function attachEventListeners() {
  elements.rangeSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) {
      return;
    }

    state.range = button.dataset.range;
    state.selectedHighlightId = dashboardData[state.range].highlights[0].id;
    render();
  });

  elements.highlightList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-highlight-id]");
    if (!item) {
      return;
    }

    state.selectedHighlightId = item.dataset.highlightId;
    render();
  });

  elements.highlightList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const item = event.target.closest("[data-highlight-id]");
    if (!item) {
      return;
    }

    event.preventDefault();
    state.selectedHighlightId = item.dataset.highlightId;
    render();
  });

  elements.tiktokConnectButton.addEventListener("click", () => {
    window.location.href = "/auth/tiktok/start";
  });

  elements.tiktokDisconnectButton.addEventListener("click", async () => {
    elements.tiktokDisconnectButton.disabled = true;

    try {
      await fetch("/api/tiktok/disconnect", {
        method: "POST"
      });

      state.tiktok = {
        ...state.tiktok,
        connected: false,
        profile: null,
        videos: [],
        statusNote: "TikTok wurde getrennt."
      };
      renderTikTokPanel();
      await refreshTikTokStatus();
    } catch (error) {
      state.tiktok = {
        ...state.tiktok,
        statusNote: "TikTok konnte nicht getrennt werden."
      };
      renderTikTokPanel();
    } finally {
      elements.tiktokDisconnectButton.disabled = false;
    }
  });
}

attachEventListeners();
render();
refreshTikTokStatus();

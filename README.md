# VRChat Moderations-Team Portal

Online-MVP fuer dein VRChat-Moderationsteam mit:

- Login und oeffentlicher Registrierung fuer einzelne Teammitglieder
- Rollen `viewer` (Moderator), `planner` (Planung) und `admin` (voller Zugriff)
- Persoenlicher Schichtansicht pro Moderator
- Schichtplanung mit Datum, Welt, Aufgabe und interner Notiz
- Wuenschen und Notizen an die Leitung
- Infoboard fuer allgemeine Aenderungen
- Tausch-Chat fuer Schichten
- Ein- und Ausstempeln mit Zeituebersicht
- Admin-Bereich fuer Benutzer und Rollen

## Lokal starten

```powershell
node server.js
```

Dann im Browser:

```text
http://localhost:3000
```

## Zugang

- Bestehende Benutzer melden sich normal an.
- Neue Moderatoren koennen sich direkt auf der Login-Seite selbst registrieren.
- Die angezeigten Demo-Zugaenge gelten nur fuer einen frischen oder durch einen Admin zurueckgesetzten Demo-Store.

## Wichtige Dateien

- `server.js`: Node-Server, API, Login, Rollen, Persistenz
- `app.js`: Frontend-Logik fuer Login, Planung, Chat und Zeiten
- `styles.css`: UI und responsives Layout
- `data/store.json`: gespeicherte Benutzer- und Portaldaten

## PostgreSQL fuer Scheduling

Die App kann Schichten, Zeiten und Verfuegbarkeiten jetzt parallel in echte PostgreSQL-Tabellen spiegeln:

- `users`
- `shifts`
- `time_entries`
- `availability_slots`
- `overtime_adjustments`

Voraussetzungen:

- `DATABASE_URL` gesetzt
- `pg` installiert

Beim Start erstellt die App die Scheduling-Tabellen automatisch, wenn PostgreSQL erreichbar ist. Wenn die Tabellen noch leer sind, wird der bestehende Portal-Store als erste Quelle uebernommen.

Manueller Backfill:

```powershell
npm run db:scheduling:backfill
```

Optional:

```powershell
npm run db:scheduling:backfill:file
npm run db:scheduling:backfill:portal
```

Hinweis:

- `pgAdmin` ist nur zum Anschauen und Pruefen der Tabellen da
- die Website bleibt die laufende App-Logik
- bei einer kaputten Datenbankverbindung faellt der Start auf den Dateistore zurueck

## Discord Benachrichtigungen

Die App nutzt jetzt einen Bot-Token plus Channel-ID statt nur eines Webhooks.

Wichtige Variablen auf Render:

```text
DISCORD_BOT_TOKEN=...
DISCORD_CHANNEL_ID=...
DISCORD_AUTO_NOTIFICATIONS_ENABLED=1
DISCORD_SHIFT_CHANGE_NOTIFICATIONS_ENABLED=0
DISCORD_SHIFT_REMINDERS_ENABLED=1
DISCORD_SHIFT_REMINDER_LOOKAHEAD_MINUTES=15
DISCORD_SHIFT_REMINDER_INTERVAL_MS=60000
```

Bedeutung:

- `DISCORD_AUTO_NOTIFICATIONS_ENABLED=1`: allgemeine automatische Discord-Nachrichten sind erlaubt
- `DISCORD_SHIFT_CHANGE_NOTIFICATIONS_ENABLED=0`: neue/geaenderte/geloeschte Schichten werden standardmaessig nicht mehr in den Channel gespammt
- `DISCORD_SHIFT_REMINDERS_ENABLED=1`: Moderatoren bekommen Schicht-Erinnerungen
- `DISCORD_SHIFT_REMINDER_LOOKAHEAD_MINUTES=15`: wie viele Minuten vor Schichtstart erinnert wird
- `DISCORD_SHIFT_REMINDER_INTERVAL_MS=60000`: wie oft der Reminder-Sweep laeuft

Hinweise:

- Wenn ein User `discordUserId` gespeichert hat, versucht die App zuerst eine Direktnachricht.
- Ohne `discordUserId` faellt die Erinnerung auf den eingestellten Discord-Channel zurueck.
- Team-Infos koennen weiter automatisch in den Channel gesendet werden.

## Fuer echten Online-Betrieb empfohlen

- HTTPS vor dem Server, z. B. per Nginx oder Cloudflare
- Cookie `Secure` aktivieren, sobald HTTPS genutzt wird
- `data/store.json` spaeter durch eine echte Datenbank ersetzen
- Session-Speicher persistent machen, z. B. per Redis oder Datenbank
- Regelmaessige Backups der Daten einplanen

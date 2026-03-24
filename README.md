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

## Fuer echten Online-Betrieb empfohlen

- HTTPS vor dem Server, z. B. per Nginx oder Cloudflare
- Cookie `Secure` aktivieren, sobald HTTPS genutzt wird
- `data/store.json` spaeter durch eine echte Datenbank ersetzen
- Session-Speicher persistent machen, z. B. per Redis oder Datenbank
- Regelmaessige Backups der Daten einplanen

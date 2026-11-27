# EcoSort

Gamified waste sorting for households and small communities. Scan an item, get disposal guidance, toss it into a virtual bin, earn Eco Points, unlock badges, and complete a 7-day challenge.

The Flask + SQLite app is the single web interface. There is no separate frontend server.

## Preview & Run Locally

Requires Python 3.10+.

```bash
cd ecosort
python -m pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**.

The database bootstraps automatically on first request. No API key is required: without `GEMINI_API_KEY`, scans use the deterministic offline rule engine.

For real image analysis with Gemini:

```bash
cp .env.example .env
# edit .env and set GEMINI_API_KEY=...
python app.py
```

Get a key at <https://aistudio.google.com/apikey>. `.env` is optional; shell environment variables win.

## Phone Demo

Keep the phone on the same Wi-Fi as the computer and bind Flask to the LAN:

```powershell
# Windows PowerShell
$env:ECOSORT_HOST="0.0.0.0"; python app.py
```

```bash
# macOS / Linux
ECOSORT_HOST=0.0.0.0 python app.py
```

Find the computer's IPv4 address (`ipconfig` on Windows, `ip addr` on Linux/macOS), then open:

```text
http://<your-ip>:5000
```

The mobile layout is designed for a **375×812** viewport with no horizontal scroll.

**Camera note:** `http://127.0.0.1` and `http://localhost` count as secure contexts; a plain LAN IP does not. On a phone over `http://<your-ip>:5000`, use **Upload photo** or the **Quick-pick sample items** instead of live camera. Live camera needs HTTPS.

## What to Test

- Profile: display name, **Community hub**, **City / region** (presets or custom), then **Apply**.
- Scanning: **Camera scan**, **Upload photo**, the sample dropdown, or one of the six sample chips.
- Sorting guide: category/bin badges, confidence/mode, numbered steps, prep checklist, regional note, and **Category override**.
- Disposal: **Toss into virtual bin**. Points are derived server-side and `client_token` prevents double-crediting.
- Bins: the five virtual target bins update from the server's `bin_counts`.
- Gamification: **Badges & 7-day** tab with badge filter, progress rail, and one-time challenge claims.
- Voice: **Read aloud / Stop** and **Auto-read**. Auto-read is off by default and speaks only the item, category/bin, and preparation steps.

## Tests

Start the server first, then run:

```bash
python tests/verify_api.py
node tests/e2e/flow.mjs
```

The browser check uses `playwright-core` and the installed Chrome:

```bash
cd tests/e2e
npm install
node flow.mjs
```

Optional control and camera checks:

```bash
node controls.mjs
node camera.mjs
```

## Notes

- Five streams: Wet Waste, Recyclable Waste, Dry Waste, E-Waste, Hazardous Waste.
- No leaderboard in the Flask UI.
- `POST /api/dispose` re-derives points server-side; challenge claims award +15 once.
- Rate limiting returns `429` with `Retry-After`, and the UI shows a friendly toast.

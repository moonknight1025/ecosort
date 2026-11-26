# EcoSort — Flutter Web app

Mobile-first Material 3 waste-segregation game: scan or tap an item, get
disposal guidance, toss it into a virtual bin, earn Eco Points, unlock badges,
run the 7-day challenge, and climb the campus leaderboard.

Runs with **zero external dependencies** by default (local mode + deterministic
classifier) and can talk to the Flask backend in the sibling `ecosort`
repository when you want the SQLite-backed version.

---

## 1. Run it

```bash
cd ecosort_flutter

flutter --version                 # needs Flutter >= 3.19 (Dart >= 3.4)
flutter pub get                   # resolves http, image_picker, shared_preferences
flutter analyze                   # static analysis
flutter test                      # unit + widget tests (no device needed)

flutter run -d chrome             # launch in Chrome
```

Mobile viewport in Chrome (either works):

```bash
# a) narrow the browser window, or
flutter run -d chrome --web-browser-flag="--window-size=430,844"
# b) DevTools: toggle device toolbar, pick iPhone 12 Pro (390x844)
```

On screens wider than 520 px the app renders inside a centred **430 px phone
frame**; below that it is full-bleed. That shell is presentation only —
`lib/widgets/mobile_frame.dart`, nothing below it knows.

### Camera capture

`Scan & Bin` offers three paths, in order of preference:

1. **Start live camera** — `camera` plugin, rear lens preferred, with
   **Capture Photo**, **Switch** and **Stop**. On web this uses
   `getUserMedia`, so it needs a secure context (`localhost`/`127.0.0.1` or
   https); Flutter Web served over a LAN IP will refuse and the UI says so.
2. **Camera** — `image_picker` with `ImageSource.camera`, which on mobile
   browsers opens the capture input directly.
3. **Upload** — gallery/file picker, plus the six sample chips.

Denied permission, no camera, or a busy device each leave the other two paths
working; the snackbar explains what happened instead of failing silently.

### Point it at the Flask backend

The app starts in **local mode**. Switch at runtime with the ⚙️ icon in the app
bar → *Flask backend (127.0.0.1:5000)*. The base URL constant lives in
`lib/services/ecosort_controller.dart`:

```dart
final Uri defaultApiBaseUrl = Uri.parse('http://127.0.0.1:5000');
```

Start the backend first:

```bash
cd ../ecosort && python app.py      # http://127.0.0.1:5000
```

If any call fails (backend down, 404 on a route the Flask app has not shipped
yet, CORS, timeout) the controller switches the **whole session** back to local
mode and retries there, so a demo never dead-ends. The banner in the app bar
tells you which mode is live.

---

## 2. Architecture

```
lib/
├── main.dart                     EcoSortApp: theme + MobileFrame + HomeScreen
├── theme.dart                    Material 3 theme (seed #2E7D32)
├── models/                       plain data, no Flutter logic beyond Color
│   ├── waste_category.dart       the 5 canonical category literals + colours
│   ├── waste_classification.dart
│   ├── user_profile.dart         UserProfile + the 4 canonical campuses
│   ├── badge_state.dart
│   ├── challenge_day.dart
│   ├── leaderboard.dart          CampusStanding, LeaderboardEntry
│   └── app_snapshot.dart         one user's whole world, one shape for both modes
├── data/
│   ├── waste_catalog.dart        13 seeded items + aliases + the 6 demo chips
│   ├── classifier.dart           deterministic token-first matcher
│   ├── gamification.dart         badge definitions + evaluation
│   └── challenge_catalog.dart    7 challenge tasks + 4 seeded demo users
├── services/
│   ├── ecosort_repository.dart   the interface both modes implement
│   ├── local_repository.dart     mock backend + shared_preferences persistence
│   ├── api_repository.dart       Flask HTTP client
│   ├── key_value_store.dart      persistence seam (prefs with memory fallback)
│   └── ecosort_controller.dart   ChangeNotifier state + fallback policy
├── screens/                      home_screen, scan_tab, badges_tab, rank_tab
└── widgets/                      mobile_frame, profile_bar, result_card,
                                  virtual_bins_grid, badge_grid,
                                  challenge_list, leaderboard_cards
```

**Interfaces before internals.** Everything below the UI depends on
`EcoSortRepository`:

```dart
Future<AppSnapshot> loadProfile({required String username, required String campus});
Future<WasteClassification> identify({String? presetKeyword, String? imageName, List<int>? imageBytes});
Future<AppSnapshot> dispose({required String username, required WasteClassification item});
Future<AppSnapshot> claimChallenge({required String username, required int day});
Future<List<CampusStanding>> campusStandings();
Future<List<LeaderboardEntry>> topUsers();
```

Swapping local for Flask is a constructor change, not a UI change.

### Domain rules (single source of truth)

| Category | Bin | Points |
| --- | --- | --- |
| `Wet Waste` | Green | 10 |
| `Recyclable Waste` | Blue | 10–15 |
| `Dry Waste` | Gray | 10 (fallback) |
| `E-Waste` | Purple | 20–25 |
| `Hazardous Waste` | Red | 25 |

Badges: `First Step` (≥1 disposal), `Plastic Warrior` (≥3 recyclable/dry),
`Hazard Hero` (≥1 e-waste/hazardous), `Green Champion` (≥100 pts). Challenge:
+15 once per day. Campuses: North Campus, South Hostel, Science Block, Main
Campus.

### Classification

`lib/data/classifier.dart` replicates the Flask `classify_waste()` rules
exactly, so both modes agree:

* case-insensitive, **token-first** matching over the 13 catalog keywords;
* a keyword may match a *substring* only when it is ≥ 5 characters, which is
  what stops the 3-character `med` keyword from firing on `media_player.png`;
* aliases (`medicine`, `laptop`, `earbuds`, …) map onto seeded keywords;
* unmatched / empty / unrecognisable input falls back to Dry Waste (10 pts),
  never to an error.

That function is the seam a vision model replaces later.

---

## 3. Tests

```bash
flutter test
```

| File | Covers |
| --- | --- |
| `test/classification_test.dart` | preset/file/fallback mapping, `med` false-positive guard, aliases, case-insensitivity, Tamil filename safety, substring-length rule |
| `test/disposal_test.dart` | points + bin increment, badge unlock, persistence across a new repository over the same store, campus not mutated by a disposal, leaderboard ordering |
| `test/challenge_test.dart` | 7 rows for a new user, +15 once, duplicate claim awards 0 (including across a fresh repository), all 7 days |
| `test/navigation_test.dart` | three-tab navigation, Eco Points pill, sample chip → result card, toss → points + bin counter |
| `test/api_repository_test.dart` | Flask contract: AI-vs-rules parsing, confidence/steps, multipart upload, 429 → readable error |

Widget tests inject `InMemoryKeyValueStore`, so they never touch
`shared_preferences` or the network.

---

## 4. Known limitations

* **Not executed here.** The build machine for this repository has no Flutter or
  Dart SDK installed, so `flutter pub get`, `flutter analyze`, `flutter test`
  and `flutter run` have **not** been run against these files. Every claim in
  this README about behaviour is by construction and by the mirrored Flask
  implementation, not by observed Flutter output.
* **Image upload is filename-driven.** On web `image_picker` returns an `XFile`;
  the app classifies from `file.name` (plus a local preview from
  `Image.memory`). No pixel analysis happens, matching the offline-first rule.
* **Backend mode is now complete.** `/api/user`, `/api/identify` (including AI
  vision), `/api/dispose`, `/api/challenge/complete` and `/api/leaderboard` all
  exist in the Flask app. Backend mode shows AI vision results when the server
  has a key; local mode always answers from rules and labels itself that way.
* **Rate limits apply in backend mode only.** The Flask API answers `429` with a
  retry hint when a bucket is exhausted; the client surfaces it as a snackbar.
  Local mode has no limits.
* **Live camera needs a secure context.** Flutter Web served on `localhost` is
  fine; a LAN IP over plain http is not, and the camera card explains that.
* **CORS.** The Flask app does not send `Access-Control-Allow-Origin`, so a
  browser backend session will fail its first request and fall back locally.
  Adding `flask-cors` (or a manual `after_request` header) is the one-line fix
  on the backend side; it is deliberately not added here because it would be a
  new dependency in the other repository.
* Uploads in local mode are kept in memory for the preview only; nothing is
  written to disk.

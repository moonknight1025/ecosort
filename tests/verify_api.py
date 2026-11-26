#!/usr/bin/env python3
"""EcoSort API verification suite (PRD milestone M5).

Covers the six mandatory assertions from PRD section 8.4 plus the regression
cases found during review, all against a throwaway database so a run never
touches the demo state in ``database.db``.

Usage:
    python tests/verify_api.py            # exit 0 = every check passed

Each check prints PASS/FAIL with the value it observed, so a failure report is
actionable without a debugger.
"""

from __future__ import annotations

import io
import os
import sqlite3
import statistics
import sys
import tempfile
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as app_module  # noqa: E402  (needs sys.path first)
import rate_limit  # noqa: E402
import vision  # noqa: E402
from app import app as flask_app  # noqa: E402

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, fn) -> None:
    """Run one named check; a raised exception is a failure, never a crash."""
    try:
        detail = fn()
        PASSED.append(name)
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    except AssertionError as error:
        FAILED.append(name)
        print(f"  FAIL  {name} — {error}")
    except Exception:  # noqa: BLE001 - a check must not abort the suite
        FAILED.append(name)
        print(f"  ERROR {name}")
        traceback.print_exc()


def main() -> int:
    # Pin the environment so an ambient .env or shell export cannot change what
    # this suite asserts. Functional checks get generous limits; the dedicated
    # rate-limit check tightens them and resets the counters itself.
    for key in (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GEMINI_MODEL",
        "GEMINI_TIMEOUT_SECONDS",
        "ECOSORT_AI_API_KEY",
    ):
        os.environ.pop(key, None)
    os.environ["RATE_LIMIT_ENABLED"] = "1"
    os.environ["RATE_LIMIT_IDENTIFY_PER_MIN"] = "1000"
    os.environ["RATE_LIMIT_AI_PER_MIN"] = "1000"
    os.environ["RATE_LIMIT_GENERAL_PER_MIN"] = "1000"
    rate_limit.reset_rate_limits()

    workdir = Path(tempfile.mkdtemp(prefix="ecosort-verify-"))
    app_module.DATABASE_PATH = str(workdir / "database.db")
    app_module.UPLOAD_DIR = str(workdir / "uploads")
    app_module._bootstrapped = False

    client = flask_app.test_client()
    client.get("/")  # first request bootstraps the temp database

    print(f"EcoSort verification — isolated database at {app_module.DATABASE_PATH}\n")

    # ---------------------------------------------------------------- 1
    def idempotent_seeding() -> str:
        app_module.init_db()
        app_module.init_db()
        connection = sqlite3.connect(app_module.DATABASE_PATH)
        try:
            catalog = connection.execute("SELECT COUNT(*) FROM waste_catalog").fetchone()[0]
            users = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            unique_keywords = connection.execute(
                "SELECT COUNT(DISTINCT keyword) FROM waste_catalog"
            ).fetchone()[0]
            challenges = connection.execute(
                "SELECT COUNT(*) FROM user_challenges"
            ).fetchone()[0]
        finally:
            connection.close()
        assert catalog >= 13, f"catalog has {catalog} rows, expected 13+"
        assert catalog == unique_keywords, "duplicate catalog keywords after re-seed"
        assert users == 4, f"expected 4 seeded users, found {users}"
        assert challenges == 28, f"expected 4 users x 7 days, found {challenges}"
        return f"{catalog} catalog, {users} users, {challenges} challenge rows after two boots"

    check("1. idempotent seeding (PRD 8.4.1)", idempotent_seeding)

    # ---------------------------------------------------------------- 2
    created: dict = {}

    def user_bootstrap() -> str:
        response = client.post(
            "/api/user",
            json={
                "username": "VerifyUser",
                "group_name": "Home & Family",
                "city": "Chennai",
            },
        )
        assert response.status_code == 200, f"status {response.status_code}"
        payload = response.get_json()
        created.update(payload["user"])
        assert payload["user"]["eco_points"] == 0, "new user must start at 0 points"
        assert len(payload["challenges"]) == 7, "expected 7 challenge rows"
        assert all(not row["completed"] for row in payload["challenges"]), "days must start uncompleted"

        again = client.post(
            "/api/user",
            json={
                "username": "VerifyUser",
                "group_name": "Home & Family",
                "city": "Chennai",
            },
        ).get_json()
        assert again["user"]["id"] == payload["user"]["id"], "repeat call created a second user"
        assert again["user"]["eco_points"] == payload["user"]["eco_points"], "points changed on reload"
        assert again["user"]["group_name"] == "Home & Family", "group was not preserved"
        assert again["user"]["city"] == "Chennai", "city was not preserved"
        return (
            f"id={payload['user']['id']} points=0 challenges=7 "
            "group='Home & Family' city=Chennai, repeat call identical"
        )

    check("2. user bootstrap is idempotent (PRD 8.4.2)", user_bootstrap)

    # ---------------------------------------------------------------- 3
    def classification() -> str:
        cases = [
            ({"preset_keyword": "battery"}, "Hazardous Waste", 25, "Red"),
            (
                {"image": (io.BytesIO(b"\x89PNG-bytes"), "plastic_bottle_01.jpg")},
                "Recyclable Waste",
                15,
                "Blue",
            ),
            (
                {"image": (io.BytesIO(b"junk"), "mystery_object.png")},
                "Dry Waste",
                10,
                "Gray",
            ),
        ]
        for data, category, points, color in cases:
            response = client.post(
                "/api/identify", data=data, content_type="multipart/form-data"
            )
            assert response.status_code == 200, f"status {response.status_code}"
            payload = response.get_json()
            label = payload["display_name"]
            assert payload["category"] == category, f"{label}: {payload['category']} != {category}"
            assert payload["points"] == points, f"{label}: {payload['points']} != {points}"
            assert payload["bin_color"] == color, f"{label}: {payload['bin_color']} != {color}"
        return "battery->Hazardous 25, plastic_bottle_01.jpg->Recyclable 15, mystery_object.png->Dry 10"

    check("3. classification and fallback (PRD 8.4.3)", classification)

    # ---------------------------------------------------------------- 4
    def disposal_and_badge() -> str:
        user_id = created["id"]
        response = client.post(
            "/api/dispose",
            json={
                "user_id": user_id,
                "item_name": "Used Alkaline / Li-ion Battery",
                # Deliberate forgery attempts: the server must ignore both.
                "points": 999999,
                "category": "Wet Waste",
            },
        )
        assert response.status_code == 200, f"status {response.status_code}"
        payload = response.get_json()
        assert payload["new_points"] == 25, f"client points were trusted: {payload['new_points']}"
        assert payload["logged"]["category"] == "Hazardous Waste", "client category was trusted"
        assert payload["bin_counts"]["Hazardous Waste"] == 1, "bin count did not increment"
        badges = {badge["id"]: badge["unlocked"] for badge in payload["badges"]}
        assert badges["first_step"] is True, "First Step did not unlock"
        assert badges["hazard_hero"] is True, "Hazard Hero did not unlock"
        return "25 pts server-derived, hazardous bin = 1, First Step + Hazard Hero unlocked"

    check("4. disposal, scoring and badge unlock (PRD 8.4.4)", disposal_and_badge)

    # ---------------------------------------------------------------- 5
    def challenge_idempotency() -> str:
        user_id = created["id"]
        first = client.post(
            "/api/challenge/complete", json={"user_id": user_id, "day_number": 1}
        )
        assert first.status_code == 200, f"first claim status {first.status_code}"
        first_payload = first.get_json()
        before = first_payload["new_points"]
        assert first_payload["awarded"] is True, "first claim did not award"
        assert before == 40, f"expected 40 points after +15, got {before}"

        second = client.post(
            "/api/challenge/complete", json={"user_id": user_id, "day_number": 1}
        )
        assert second.status_code == 200, f"duplicate claim status {second.status_code}"
        second_payload = second.get_json()
        assert second_payload["awarded"] is False, "duplicate claim awarded points"
        assert second_payload["new_points"] == before, "duplicate claim changed the score"
        assert second_payload["challenges"][0]["completed"] is True, "day 1 not marked complete"
        return "+15 then +0 (no 500), day 1 completed"

    check("5. challenge idempotency (PRD 8.4.5)", challenge_idempotency)

    # ---------------------------------------------------------------- 6
    def leaderboard_aggregation() -> str:
        payload = client.get("/api/leaderboard").get_json()
        users = payload["users"]
        assert users, "leaderboard returned no users"
        points = [row["eco_points"] for row in users]
        assert points == sorted(points, reverse=True), f"users not sorted: {points}"

        connection = sqlite3.connect(app_module.DATABASE_PATH)
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(
                "SELECT group_name, SUM(eco_points) AS total, COUNT(*) AS members "
                "FROM users GROUP BY group_name"
            ).fetchall()
        finally:
            connection.close()
        expected = {row["group_name"]: (row["total"], row["members"]) for row in rows}
        assert "groups" in payload, "leaderboard must expose group standings"
        for standing in payload["groups"]:
            total, members = expected[standing["group_name"]]
            assert standing["total_points"] == total, (
                f"{standing['group_name']}: {standing['total_points']} != member sum {total}"
            )
            assert standing["members"] == members, (
                f"{standing['group_name']}: {standing['members']} != {members}"
            )
        assert all("city" in row for row in users), "user rows must carry a city"
        return (
            f"{len(users)} users sorted desc, {len(payload['groups'])} group totals "
            "match member sums"
        )

    check("6. leaderboard aggregation (PRD 8.4.6)", leaderboard_aggregation)

    # ---------------------------------------------------------------- 7
    def classifier_regressions() -> str:
        for name in ("media_player.png", "immediate_photo.jpg", "reminder.png"):
            payload = client.post(
                "/api/identify",
                data={"image": (io.BytesIO(b"x"), name)},
                content_type="multipart/form-data",
            ).get_json()
            assert payload["category"] != "Hazardous Waste", f"{name} classified as Hazardous"
            assert payload["fallback"] is True, f"{name} should not match a keyword"
        assert (
            client.post(
                "/api/identify",
                data={"image": (io.BytesIO(b"x"), "MEDICINE.JPG")},
                content_type="multipart/form-data",
            ).get_json()["category"]
            == "Hazardous Waste"
        ), "alias 'medicine' does not resolve to the med row"
        assert (
            client.post(
                "/api/identify",
                data={"image": (io.BytesIO(b"x"), "newspaper.jpg")},
                content_type="multipart/form-data",
            ).get_json()["matched_keyword"]
            == "paper"
        ), "5-character substring rule broke"
        return "media/immediate/reminder fall back, medicine+newspaper still match"

    check("7a. classifier word-boundary regressions", classifier_regressions)

    def tamil_filename() -> str:
        name = "குப்பை.jpg"
        response = client.post(
            "/api/identify",
            data={"image": (io.BytesIO(b"\xff\xd8\xff"), name)},
            content_type="multipart/form-data",
        )
        assert response.status_code == 200, f"status {response.status_code}"
        payload = response.get_json()
        assert payload["image_url"], "non-ASCII upload was not saved"
        stored = Path(app_module.UPLOAD_DIR) / Path(payload["image_url"]).name
        assert stored.exists(), f"{stored} missing on disk"
        assert stored.name.startswith("upload_"), "expected an ASCII fallback filename"
        assert stored.suffix == ".jpg", f"extension lost: {stored.name}"
        return f"saved as {stored.name}, classified {payload['category']}"

    check("7b. non-ASCII upload survives sanitisation", tamil_filename)

    def request_validation() -> str:
        assertions = [
            (
                client.post(
                    "/api/user", json={"username": "x", "group_name": "g" * 80}
                ).status_code,
                400,
                "group_name too long",
            ),
            (
                client.post(
                    "/api/user", json={"username": "x", "city": "c" * 80}
                ).status_code,
                400,
                "city too long",
            ),
            (client.post("/api/user", json={"username": "x" * 200}).status_code, 400, "long username"),
            (client.post("/api/user", json={}).status_code, 400, "missing username"),
            (client.post("/api/user", data="{not json", content_type="application/json").status_code, 400, "malformed JSON"),
            (client.post("/api/dispose", json={"user_id": 999999, "item_name": "box"}).status_code, 404, "unknown user"),
            (client.post("/api/dispose", json={"user_id": created["id"]}).status_code, 400, "missing item"),
            (client.post("/api/challenge/complete", json={"user_id": created["id"], "day_number": 99}).status_code, 400, "day out of range"),
        ]
        for actual, expected, label in assertions:
            assert actual == expected, f"{label}: got {actual}, expected {expected}"
        return f"{len(assertions)} invalid requests rejected with 4xx/404, no 500"

    check("7c. validation failures are loud, not silent", request_validation)

    def disposal_idempotency() -> str:
        user_id = created["id"]
        body = {
            "user_id": user_id,
            "item_name": "Cardboard Box",
            "client_token": "verify-token-1",
        }
        first = client.post("/api/dispose", json=body).get_json()
        second = client.post("/api/dispose", json=body).get_json()
        assert first["duplicate"] is False, "first write flagged as duplicate"
        assert second["duplicate"] is True, "retry not detected as duplicate"
        assert second["new_points"] == first["new_points"], "retry double-credited points"
        assert second["bin_counts"]["Recyclable Waste"] == first["bin_counts"]["Recyclable Waste"], (
            "retry incremented the bin twice"
        )
        return f"retry with the same client_token left points at {first['new_points']}"

    check("7d. dispose is idempotent per client_token", disposal_idempotency)

    def latency() -> str:
        samples = []
        for _ in range(20):
            start = time.perf_counter()
            client.post("/api/identify", data={"preset_keyword": "bottle"})
            samples.append((time.perf_counter() - start) * 1000)
        p95 = statistics.quantiles(samples, n=20)[18]
        assert p95 < 300, f"p95 {p95:.1f} ms exceeds the 300 ms budget"
        return f"identify p95 {p95:.1f} ms over 20 calls (max {max(samples):.1f} ms)"

    check("7e. local API latency budget", latency)

    # ---------------------------------------------------------------- 8
    def capabilities() -> str:
        payload = client.get("/api/capabilities").get_json()
        assert "ai_vision" in payload, "capabilities missing ai_vision"
        assert payload["ai_vision"]["enabled"] is False, "vision should be off without a key"
        assert payload["rate_limits"]["identify"] == 1000, "rate limits not reported"
        assert len(payload["categories"]) == 5, "capabilities must list the five streams"
        return f"ai_vision=off limits={payload['rate_limits']} categories=5"

    check("8. capabilities reports vision + limits (secret-free)", capabilities)

    # ---------------------------------------------------------------- 9
    def rules_provenance() -> str:
        payload = client.post(
            "/api/identify",
            data={"image": (io.BytesIO(b"\xff\xd8jpeg"), "plastic_bottle_01.jpg")},
            content_type="multipart/form-data",
        ).get_json()
        assert payload["analysis_mode"] == "offline_fallback", (
            f"expected offline_fallback, got {payload['analysis_mode']}"
        )
        assert payload["source"] == "offline_fallback", "source alias drifted"
        assert "municipal" in (payload.get("local_note") or ""), "local rules note missing"
        assert payload["vision_available"] is False, "vision reported available without a key"
        assert payload["confidence"] is None, "rule answers must not claim a confidence"
        assert payload["item_name"], "item_name missing on the rules path"
        return (
            "analysis_mode=offline_fallback, vision_available=false, "
            "confidence=null, local_note present"
        )

    check("9. no GEMINI_API_KEY -> offline_fallback, no invented labels", rules_provenance)

    # ---------------------------------------------------------------- 10
    def bin_colour_mapping_matches_app() -> str:
        # vision.py keeps its own category->colour map so the prompt and the
        # validator can work without importing app.py; assert they agree.
        for category, meta in app_module.BIN_META.items():
            expected = vision.BIN_COLOR_BY_CATEGORY[category]
            assert expected == meta["bin_color"], (
                f"{category}: vision says {expected}, app says {meta['bin_color']}"
            )
        assert set(vision.BIN_COLOR_BY_CATEGORY) == set(app_module.BIN_META), (
            "vision.py and app.py disagree on the five categories"
        )
        return "5 categories, identical bin colours in vision.py and app.py"

    check("10. vision category->bin map matches the canonical domain", bin_colour_mapping_matches_app)

    # ---------------------------------------------------------------- 11
    def gemini_wiring() -> str:
        """Mock ONLY the SDK boundary and prove what actually reaches Gemini."""
        os.environ["GEMINI_API_KEY"] = "test-key-not-real"
        os.environ["GEMINI_MODEL"] = "gemini-2.5-flash"
        captured: dict = {}
        original_build = vision._build_client

        class _Models:
            def generate_content(self, **kwargs):
                captured.update(kwargs)

                class _Response:
                    parsed = None
                    text = (
                        '{"item_name":"Crushed PET Water Bottle",'
                        '"category":"Recyclable Waste","bin_color":"Blue",'
                        '"confidence":"High",'
                        '"instructions":"Empty and rinse the bottle. '
                        'Remove the cap and keep it. Flatten it.",'
                        '"analysis_mode":"ai_vision"}'
                    )

                return _Response()

        class _Client:
            models = _Models()

        vision._build_client = lambda key: _Client()
        try:
            image = b"\xff\xd8\xff\xe0REAL-JPEG-BYTES"
            payload = client.post(
                "/api/identify",
                data={"image": (io.BytesIO(image), "camera-capture.jpg")},
                content_type="multipart/form-data",
            ).get_json()

            # 1. the API mapped the model answer
            assert payload["analysis_mode"] == "ai_vision", payload["analysis_mode"]
            assert payload["item_name"] == "Crushed PET Water Bottle", payload["item_name"]
            assert payload["category"] == "Recyclable Waste", payload["category"]
            assert payload["bin_color"] == "Blue", payload["bin_color"]
            assert payload["confidence"] == "High", payload["confidence"]
            assert payload["points"] == 15, f"server-derived points={payload['points']}"
            assert len(payload["preparation_steps"]) == 3, payload["preparation_steps"]
            assert payload["ai_model"] == "gemini-2.5-flash", payload["ai_model"]

            # 2. the real image bytes reached the multimodal Part
            contents = captured["contents"]
            part, prompt = contents[0], contents[1]
            assert part.inline_data is not None, "no Part.from_bytes payload"
            assert bytes(part.inline_data.data) == image, "different bytes reached the model"
            assert part.inline_data.mime_type == "image/jpeg", part.inline_data.mime_type

            # 3. the response contract is enforced by the SDK schema
            config = captured["config"]
            assert config.response_mime_type == "application/json", config.response_mime_type
            assert config.response_schema is vision.WasteAnalysis, "response_schema not sent"
            assert isinstance(prompt, str) and "EcoSort" in prompt, "prompt not sent"

            return (
                f"bytes={len(part.inline_data.data)} mime=image/jpeg "
                "schema=WasteAnalysis -> Recyclable/Blue/High, 15 pts, 3 steps"
            )
        finally:
            vision._build_client = original_build
            os.environ.pop("GEMINI_API_KEY", None)

    check("11. real image bytes + strict schema reach the Gemini SDK", gemini_wiring)

    # ---------------------------------------------------------------- 12
    def gemini_failures_degrade() -> str:
        os.environ["GEMINI_API_KEY"] = "test-key-not-real"
        original_build = vision._build_client
        try:
            def boom(key):
                raise RuntimeError("quota exceeded")

            vision._build_client = boom
            response = client.post(
                "/api/identify",
                data={"image": (io.BytesIO(b"x"), "battery.jpg")},
                content_type="multipart/form-data",
            )
            payload = response.get_json()
            assert response.status_code == 200, f"status {response.status_code}"
            assert payload["analysis_mode"] == "offline_fallback", "did not fall back"
            assert payload["category"] == "Hazardous Waste", "filename signal lost"
            assert payload["vision_error"], "vision_error not surfaced"

            # A model answer with an out-of-domain category is rejected.
            class _BadModels:
                def generate_content(self, **kwargs):
                    class _Response:
                        parsed = None
                        text = '{"item_name":"Mystery goo","category":"Compost",' \
                               '"bin_color":"Green","confidence":"High",' \
                               '"instructions":"Do something.","analysis_mode":"ai_vision"}'

                    return _Response()

            class _BadClient:
                models = _BadModels()

            vision._build_client = lambda key: _BadClient()
            unknown = client.post(
                "/api/identify",
                data={"image": (io.BytesIO(b"x"), "box.jpg")},
                content_type="multipart/form-data",
            ).get_json()
            assert unknown["analysis_mode"] == "offline_fallback", "unknown category trusted"
            assert unknown["category"] == "Recyclable Waste", "fallback answer wrong"
            assert "unknown category" in (unknown["vision_error"] or ""), unknown["vision_error"]

            # An SDK crash mid-call must not 500 the scan.
            class _CrashModels:
                def generate_content(self, **kwargs):
                    raise AttributeError("bug in SDK call")

            class _CrashClient:
                models = _CrashModels()

            vision._build_client = lambda key: _CrashClient()
            crashed = client.post(
                "/api/identify",
                data={"image": (io.BytesIO(b"x"), "box.jpg")},
                content_type="multipart/form-data",
            )
            assert crashed.status_code == 200, "SDK crash became a 500"
            return "client-construction failure, unknown category and SDK crash all degrade"
        finally:
            vision._build_client = original_build
            os.environ.pop("GEMINI_API_KEY", None)

    check("12. Gemini failures degrade to rules, never 500", gemini_failures_degrade)

    # ---------------------------------------------------------------- 13
    # ---------------------------------------------------------------- 14
    def rate_limiting() -> str:
        os.environ["RATE_LIMIT_IDENTIFY_PER_MIN"] = "2"
        rate_limit.reset_rate_limits()
        try:
            allowed = [
                client.post("/api/identify", data={"preset_keyword": "bottle"}).status_code
                for _ in range(2)
            ]
            assert allowed == [200, 200], f"expected 200s within the limit, got {allowed}"

            blocked = client.post("/api/identify", data={"preset_keyword": "bottle"})
            assert blocked.status_code == 429, f"expected 429, got {blocked.status_code}"
            body = blocked.get_json()
            assert body["bucket"] == "identify", "429 did not name the bucket"
            assert body["limit"] == 2, "429 did not report the limit"
            assert isinstance(body["retry_after"], int), "429 missing retry_after"
            header = blocked.headers.get("Retry-After")
            assert header == str(body["retry_after"]), "Retry-After header mismatch"
            assert "Too many requests" in body["error"], "429 message not friendly"

            # A different bucket is unaffected by the identify limit.
            assert (
                client.post("/api/user", json={"username": "RateLimitUser"}).status_code
                == 200
            ), "general bucket was wrongly throttled by an identify limit"

            # Reset restores service, which is what isolated suites rely on.
            rate_limit.reset_rate_limits()
            assert (
                client.post("/api/identify", data={"preset_keyword": "bottle"}).status_code
                == 200
            ), "reset did not clear the window"

            # The kill switch disables enforcement entirely.
            os.environ["RATE_LIMIT_ENABLED"] = "0"
            rate_limit.reset_rate_limits()
            open_codes = [
                client.post("/api/identify", data={"preset_keyword": "bottle"}).status_code
                for _ in range(4)
            ]
            assert open_codes == [200, 200, 200, 200], f"kill switch failed: {open_codes}"
            return "2x200 then 429+Retry-After, other buckets unaffected, reset works"
        finally:
            os.environ["RATE_LIMIT_ENABLED"] = "1"
            os.environ["RATE_LIMIT_IDENTIFY_PER_MIN"] = "1000"
            rate_limit.reset_rate_limits()

    check("14. rate limiting: 429 + Retry-After + reset + kill switch", rate_limiting)

    # ---------------------------------------------------------------- 15
    def legacy_database_migration() -> str:
        legacy = Path(tempfile.mkdtemp(prefix="ecosort-legacy-")) / "database.db"
        connection = sqlite3.connect(legacy)
        connection.executescript(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                campus TEXT DEFAULT 'Main Campus',
                eco_points INTEGER DEFAULT 0,
                streak_days INTEGER DEFAULT 1
            );
            CREATE TABLE waste_catalog (
                id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL, category TEXT NOT NULL,
                bin_color TEXT NOT NULL, instructions TEXT NOT NULL,
                points INTEGER DEFAULT 10
            );
            CREATE TABLE disposal_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                item_name TEXT NOT NULL, category TEXT NOT NULL,
                points_earned INTEGER NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE user_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                day_number INTEGER NOT NULL, completed INTEGER DEFAULT 0,
                UNIQUE (user_id, day_number)
            );
            INSERT INTO users (username, campus, eco_points)
            VALUES ('LegacyUser', 'North Campus', 77);
            """
        )
        connection.commit()
        connection.close()

        previous_path, previous_uploads, previous_flag = (
            app_module.DATABASE_PATH,
            app_module.UPLOAD_DIR,
            app_module._bootstrapped,
        )
        app_module.DATABASE_PATH = str(legacy)
        app_module.UPLOAD_DIR = str(legacy.parent / "uploads")
        app_module._bootstrapped = False
        try:
            legacy_client = flask_app.test_client()
            assert legacy_client.get("/").status_code == 200, "legacy database failed to boot"
            connection = sqlite3.connect(legacy)
            connection.row_factory = sqlite3.Row
            try:
                columns = [row[1] for row in connection.execute("PRAGMA table_info(users)")]
                row = connection.execute(
                    "SELECT * FROM users WHERE username = 'LegacyUser'"
                ).fetchone()
            finally:
                connection.close()
            assert "group_name" in columns and "city" in columns, "columns not added"
            assert row["group_name"] == "North Campus", (
                f"campus value lost: {row['group_name']!r}"
            )
            assert row["eco_points"] == 77, "points lost during migration"
            return "campus-era DB booted, campus->group_name, points preserved"
        finally:
            app_module.DATABASE_PATH = previous_path
            app_module.UPLOAD_DIR = previous_uploads
            app_module._bootstrapped = previous_flag
            rate_limit.reset_rate_limits()

    check("15. campus-era database upgrades in place", legacy_database_migration)

    # ---------------------------------------------------------------- 16
    def category_override_channel() -> str:
        """The UI's "correct the category" control must be explicit and validated,
        and must not become a way to supply points."""
        created_user = client.post(
            "/api/user", json={"username": "OverrideProbe"}
        ).get_json()["user"]
        user_id = created_user["id"]

        # Legacy `category`/`points` fields are still ignored outright.
        forged = client.post(
            "/api/dispose",
            json={
                "user_id": user_id,
                "item_name": "Plastic Bottle",
                "category": "Hazardous Waste",
                "points": 999999,
            },
        ).get_json()
        assert forged["logged"]["category"] == "Recyclable Waste", "forged category honoured"
        assert forged["new_points"] == 15, f"forged points honoured: {forged['new_points']}"
        assert forged["logged"]["overridden"] is False, "override flag set without an override"

        # The explicit channel is honoured, with server-derived points.
        corrected = client.post(
            "/api/dispose",
            json={
                "user_id": user_id,
                "item_name": "Mystery wrapper",
                "category_override": "Hazardous Waste",
                "points": 1,
            },
        ).get_json()
        assert corrected["logged"]["category"] == "Hazardous Waste", "override ignored"
        assert corrected["logged"]["points"] == 25, "points not derived from override stream"
        assert corrected["logged"]["overridden"] is True, "override flag not reported"
        assert corrected["new_points"] == 40, f"total {corrected['new_points']}"

        # Anything outside the five streams is rejected, not coerced.
        bad = client.post(
            "/api/dispose",
            json={"user_id": user_id, "item_name": "box", "category_override": "Compost"},
        )
        assert bad.status_code == 400, f"invalid override accepted: {bad.status_code}"
        assert "allowed" in bad.get_json(), "rejection did not list the allowed streams"

        return "forged fields ignored; override honoured at 25 pts; invalid override 400"

    check("16. category override is explicit, validated and point-free",
          category_override_channel)

    # ---------------------------------------------------------------- summary
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("failed checks:")
        for name in FAILED:
            print(f"  - {name}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

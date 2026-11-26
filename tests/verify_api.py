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
            "/api/user", json={"username": "VerifyUser", "campus": "North Campus"}
        )
        assert response.status_code == 200, f"status {response.status_code}"
        payload = response.get_json()
        created.update(payload["user"])
        assert payload["user"]["eco_points"] == 0, "new user must start at 0 points"
        assert len(payload["challenges"]) == 7, "expected 7 challenge rows"
        assert all(not row["completed"] for row in payload["challenges"]), "days must start uncompleted"

        again = client.post(
            "/api/user", json={"username": "VerifyUser", "campus": "North Campus"}
        ).get_json()
        assert again["user"]["id"] == payload["user"]["id"], "repeat call created a second user"
        assert again["user"]["eco_points"] == payload["user"]["eco_points"], "points changed on reload"
        return f"id={payload['user']['id']} points=0 challenges=7, repeat call identical"

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
                "SELECT campus, SUM(eco_points) AS total, COUNT(*) AS members "
                "FROM users GROUP BY campus"
            ).fetchall()
        finally:
            connection.close()
        expected = {row["campus"]: (row["total"], row["members"]) for row in rows}
        for standing in payload["campuses"]:
            total, members = expected[standing["campus"]]
            assert standing["total_points"] == total, (
                f"{standing['campus']}: {standing['total_points']} != member sum {total}"
            )
            assert standing["members"] == members, (
                f"{standing['campus']}: {standing['members']} != {members}"
            )
        return f"{len(users)} users sorted desc, {len(payload['campuses'])} campus totals match member sums"

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
            (client.post("/api/user", json={"username": "x", "campus": "Atlantis"}).status_code, 400, "unknown campus"),
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

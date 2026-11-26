"""EcoSort - gamified waste segregation MVP.

Milestone 1 scope: directory scaffold, idempotent SQLite bootstrap (four tables +
canonical seed data) and the responsive three-tab UI shell.

Behaviours owned here so far:
  * ``GET /``  -> renders ``templates/index.html``
Run directly (``python app.py``) or via ``flask --app app run``; importing the
module also bootstraps the database, so both entry points behave identically.
"""

from __future__ import annotations

import os
import sqlite3

from flask import Flask, g, jsonify, render_template, request
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, "database.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")

# --- Canonical domain rules (PRD section 4) -------------------------------
# Single source of truth for the exact category literals, bin colours and base
# scores. Every seed row, API response and frontend bin derives from here.
BIN_META = {
    "Wet Waste": {"bin_color": "Green", "hex": "#2e7d32", "slug": "wet"},
    "Recyclable Waste": {"bin_color": "Blue", "hex": "#1565c0", "slug": "recyclable"},
    "Dry Waste": {"bin_color": "Gray", "hex": "#546e7a", "slug": "dry"},
    "E-Waste": {"bin_color": "Purple", "hex": "#6a1b9a", "slug": "ewaste"},
    "Hazardous Waste": {"bin_color": "Red", "hex": "#c62828", "slug": "hazardous"},
}

FALLBACK_CATEGORY = "Dry Waste"
FALLBACK_POINTS = 10
FALLBACK_INSTRUCTIONS = (
    "We could not match this item to a known stream. Bag it and drop it in the "
    "gray dry-waste bin; a campus volunteer will re-sort it."
)

# Badge rules (PRD 4.2) expressed as category groups, so the SQL below never
# re-types the canonical category literals.
PLASTIC_CATEGORIES = ("Recyclable Waste", "Dry Waste")
HAZARD_CATEGORIES = ("E-Waste", "Hazardous Waste")

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

# (keyword, display_name, category, instructions, points)
CATALOG_SEED: list[tuple[str, str, str, str, int]] = [
    (
        "banana",
        "Banana Peel",
        "Wet Waste",
        "Drop it in the green wet-waste bin, ideally loose rather than in a "
        "plastic bag, so the campus compost pile can take it.",
        10,
    ),
    (
        "apple",
        "Fruit Core",
        "Wet Waste",
        "Chop it small if you can, then add it to the green bin with the rest "
        "of the day's food waste.",
        10,
    ),
    (
        "food",
        "Leftover Food Scraps",
        "Wet Waste",
        "Scrape the plate into the green bin and keep wrappers out so the load "
        "stays compostable.",
        10,
    ),
    (
        "bottle",
        "Plastic Bottle",
        "Recyclable Waste",
        "Empty and rinse the bottle, crush it flat, cap it, then drop it in the "
        "blue recyclables bin.",
        15,
    ),
    (
        "plastic",
        "Plastic Container",
        "Recyclable Waste",
        "Rinse out any food residue, stack it with other rigid plastics, and "
        "place it in the blue bin.",
        15,
    ),
    (
        "box",
        "Cardboard Box",
        "Recyclable Waste",
        "Remove tape and flatten the box so it stacks neatly in the blue "
        "recyclables bin.",
        15,
    ),
    (
        "paper",
        "Newspaper",
        "Recyclable Waste",
        "Keep it dry, bundle the sheets together, and add them to the blue "
        "paper stream.",
        10,
    ),
    (
        "wrapper",
        "Soiled Chip Bag",
        "Dry Waste",
        "Multi-layer wrappers cannot be recycled. Bag them and drop them in the "
        "gray dry-waste bin.",
        10,
    ),
    (
        "tissue",
        "Used Napkin",
        "Dry Waste",
        "Toss the soiled napkin into the gray dry-waste bin; it is not "
        "compostable once it has touched food.",
        10,
    ),
    (
        "charger",
        "Broken Charger or Cable",
        "E-Waste",
        "Coil the cable, bag it separately, and hand it to the purple e-waste "
        "bin so the copper can be recovered.",
        20,
    ),
    (
        "phone",
        "Old Electronic Device",
        "E-Waste",
        "Wipe your data, remove the SIM, and place the handset in the purple "
        "e-waste bin. Never put it in general waste.",
        25,
    ),
    (
        "battery",
        "Alkaline or Li-ion Battery",
        "Hazardous Waste",
        "Tape the terminals, keep it away from heat, and drop it in the red "
        "hazardous-waste bin. Never bin a battery loose.",
        25,
    ),
    (
        "med",
        "Expired Medicine or Chemical",
        "Hazardous Waste",
        "Leave the medicine in its blister or bottle, seal it in a bag, and "
        "place it in the red hazardous-waste bin.",
        25,
    ),
]

# (username, campus, eco_points) - seeded so the campus battle is populated.
CAMPUSES = ("North Campus", "South Hostel", "Science Block", "Main Campus")
USER_SEED: list[tuple[str, str, int]] = [
    ("Aarav", "North Campus", 145),
    ("Meera", "South Hostel", 120),
    ("Kabir", "Science Block", 95),
    ("Diya", "Main Campus", 80),
]

# Seven-Day Zero-Waste Challenge (PRD section 4.2). Day -> task text.
CHALLENGE_TASKS = {
    1: "Carry a reusable bottle all day",
    2: "Segregate wet and dry waste at 100% accuracy",
    3: "Refuse single-use plastic bags",
    4: "Compost the day's food scraps",
    5: "Audit your desk for e-waste",
    6: "Rinse and recycle three containers",
    7: "Invite a campus peer to join EcoSort",
}
CHALLENGE_REWARD = 15

# Achievement badges (PRD section 4.2). Unlock rules are evaluated dynamically
# from milestone 4 onwards; until then every badge renders locked.
BADGES = [
    ("first_step", "First Step", "Log your very first waste disposal."),
    ("plastic_warrior", "Plastic Warrior", "Log 3 recyclable or dry-waste items."),
    ("hazard_hero", "Hazard Hero", "Safely log 1 e-waste or hazardous item."),
    ("green_champion", "Green Champion", "Bank 100 Eco Points."),
]

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    campus      TEXT DEFAULT 'Main Campus',
    eco_points  INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS waste_catalog (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword      TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    category     TEXT NOT NULL,
    bin_color    TEXT NOT NULL,
    instructions TEXT NOT NULL,
    points       INTEGER DEFAULT 10
);

CREATE TABLE IF NOT EXISTS disposal_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    item_name    TEXT NOT NULL,
    category     TEXT NOT NULL,
    points_earned INTEGER NOT NULL,
    timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_challenges (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    day_number INTEGER NOT NULL,
    completed  INTEGER DEFAULT 0,
    UNIQUE (user_id, day_number)
);
"""


def catalog_rows() -> list[tuple[str, str, str, str, str, int]]:
    """Expand CATALOG_SEED into insert tuples, deriving bin colour from BIN_META."""
    rows = []
    for keyword, display_name, category, instructions, points in CATALOG_SEED:
        meta = BIN_META[category]  # KeyError here means a seed row drifted
        rows.append((keyword, display_name, category, meta["bin_color"], instructions, points))
    return rows


def init_db(database_path: str = DATABASE_PATH) -> None:
    """Create the upload directory, the schema and the seed rows.

    Idempotent: safe to call on every start. Seeds rely on the UNIQUE
    constraints shipped with the schema plus ``INSERT OR IGNORE``, so a second
    run writes nothing and never raises.
    """
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    connection = sqlite3.connect(database_path)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(SCHEMA_SQL)
        connection.executemany(
            """
            INSERT OR IGNORE INTO waste_catalog
                (keyword, display_name, category, bin_color, instructions, points)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            catalog_rows(),
        )
        connection.executemany(
            "INSERT OR IGNORE INTO users (username, campus, eco_points) VALUES (?, ?, ?)",
            USER_SEED,
        )
        # Give every known user one row per challenge day; UNIQUE(user_id, day_number)
        # keeps repeated boots from duplicating them.
        for day_number in CHALLENGE_TASKS:
            connection.execute(
                """
                INSERT OR IGNORE INTO user_challenges (user_id, day_number, completed)
                SELECT id, ?, 0 FROM users
                """,
                (day_number,),
            )
        assert set(PLASTIC_CATEGORIES + HAZARD_CATEGORIES) <= set(BIN_META), (
            "badge category groups drifted from BIN_META"
        )
        connection.commit()
    finally:
        connection.close()


def get_db() -> sqlite3.Connection:
    """Request-scoped SQLite connection with row access by column name."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def user_payload(row: sqlite3.Row) -> dict:
    """Shape a ``users`` row for the JSON contract."""
    return {
        "id": row["id"],
        "username": row["username"],
        "campus": row["campus"],
        "eco_points": row["eco_points"],
        "streak_days": row["streak_days"],
    }


def ensure_challenge_rows(connection: sqlite3.Connection, user_id: int) -> None:
    """Give a user one challenge row per day; UNIQUE(user_id, day_number) dedupes."""
    connection.executemany(
        "INSERT OR IGNORE INTO user_challenges (user_id, day_number, completed) VALUES (?, ?, 0)",
        [(user_id, day_number) for day_number in CHALLENGE_TASKS],
    )


def challenge_payload(connection: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = connection.execute(
        "SELECT day_number, completed FROM user_challenges WHERE user_id = ? "
        "ORDER BY day_number",
        (user_id,),
    ).fetchall()
    return [
        {
            "day_number": row["day_number"],
            "completed": bool(row["completed"]),
            "task": CHALLENGE_TASKS.get(row["day_number"], ""),
        }
        for row in rows
    ]


def bin_counts_for(connection: sqlite3.Connection, user_id: int) -> dict[str, int]:
    """Disposal count per bin for one user; every category is always present."""
    counts = {category: 0 for category in BIN_META}
    rows = connection.execute(
        "SELECT category, COUNT(*) AS total FROM disposal_logs WHERE user_id = ? "
        "GROUP BY category",
        (user_id,),
    ).fetchall()
    for row in rows:
        if row["category"] in counts:
            counts[row["category"]] = row["total"]
    return counts


def badge_states(
    connection: sqlite3.Connection, user_id: int, eco_points: int
) -> list[dict]:
    """Evaluate the four badges from the logs, never from a stored flag."""
    row = connection.execute(
        """
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(category IN (?, ?)), 0) AS plastic,
            COALESCE(SUM(category IN (?, ?)), 0) AS hazard
        FROM disposal_logs
        WHERE user_id = ?
        """,
        (*PLASTIC_CATEGORIES, *HAZARD_CATEGORIES, user_id),
    ).fetchone()

    unlocked = {
        "first_step": row["total"] >= 1,
        "plastic_warrior": row["plastic"] >= 3,
        "hazard_hero": row["hazard"] >= 1,
        "green_champion": eco_points >= 100,
    }
    return [
        {
            "id": badge_id,
            "name": name,
            "requirement": requirement,
            "unlocked": unlocked[badge_id],
        }
        for badge_id, name, requirement in BADGES
    ]


def classify_waste(keyword_text: str = "", image_path: str | None = None) -> dict:
    """Classify waste from a preset keyword and/or an uploaded file name.

    Deterministic, offline, and the single seam for a future vision model: the
    body can be swapped for a model call without changing the route signature,
    the JSON contract, or any SQL. Matching is case-insensitive substring over
    ``waste_catalog.keyword``; the longest matching keyword wins so
    ``plastic_bottle_01.jpg`` resolves the same way every time.
    """
    haystack = " ".join(
        part for part in (keyword_text, os.path.basename(image_path or "")) if part
    ).lower()

    rows = get_db().execute(
        "SELECT keyword, display_name, category, bin_color, instructions, points "
        "FROM waste_catalog"
    ).fetchall()
    matches = [row for row in rows if row["keyword"].lower() in haystack]

    if matches:
        best = max(matches, key=lambda row: (len(row["keyword"]), row["keyword"]))
        return {
            "display_name": best["display_name"],
            "category": best["category"],
            "bin_color": best["bin_color"],
            "instructions": best["instructions"],
            "points": best["points"],
            "matched_keyword": best["keyword"],
            "fallback": False,
        }

    fallback = BIN_META[FALLBACK_CATEGORY]
    return {
        "display_name": "Unrecognized Item",
        "category": FALLBACK_CATEGORY,
        "bin_color": fallback["bin_color"],
        "instructions": FALLBACK_INSTRUCTIONS,
        "points": FALLBACK_POINTS,
        "matched_keyword": None,
        "fallback": True,
    }


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


@app.teardown_appcontext
def close_db(_exception: BaseException | None = None) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


@app.errorhandler(413)
def upload_too_large(_error):
    """Keep oversized uploads a JSON 413 instead of Flask's HTML default."""
    limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
    return jsonify({"error": f"image exceeds the {limit_mb} MB limit", "fallback": True}), 413


@app.post("/api/user")
def create_or_fetch_user():
    """Create a profile or return the existing one, then initialise its state.

    Idempotent by design: a repeat call for a known username preserves
    ``eco_points`` and the challenge rows, and only refreshes the campus.
    """
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username") or "").strip()
    if not username:
        return jsonify({"error": "username is required"}), 400

    campus = str(payload.get("campus") or "").strip() or "Main Campus"
    if campus not in CAMPUSES:
        campus = "Main Campus"

    db = get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        db.execute(
            "INSERT INTO users (username, campus) VALUES (?, ?)", (username, campus)
        )
        db.commit()
        row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    elif campus != row["campus"]:
        db.execute("UPDATE users SET campus = ? WHERE id = ?", (campus, row["id"]))
        db.commit()
        row = db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()

    ensure_challenge_rows(db, row["id"])
    db.commit()

    return jsonify(
        {
            "user": user_payload(row),
            "badges": badge_states(db, row["id"], row["eco_points"]),
            "challenges": challenge_payload(db, row["id"]),
            "bin_counts": bin_counts_for(db, row["id"]),
        }
    )


@app.post("/api/identify")
def identify_waste():
    """Classify a preset keyword and/or an uploaded image file name.

    Every unmatched, empty or rejected input still resolves to the Dry Waste
    fallback with HTTP 200 - the PRD forbids a 500 on bad uploads.
    """
    keyword = str(
        request.form.get("preset_keyword") or request.form.get("keyword") or ""
    ).strip()

    image_path = None
    upload = request.files.get("image")
    if upload is not None and upload.filename:
        safe_name = secure_filename(upload.filename)
        extension = os.path.splitext(safe_name)[1].lower()
        if safe_name and extension in ALLOWED_IMAGE_EXTENSIONS:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            image_path = os.path.join(UPLOAD_DIR, safe_name)
            upload.save(image_path)

    result = classify_waste(keyword, image_path)
    result["image_url"] = (
        f"/static/uploads/{os.path.basename(image_path)}" if image_path else None
    )
    return jsonify(result)


@app.route("/")
def index():
    """Serve the single-page shell with its canonical domain constants."""
    return render_template(
        "index.html",
        campuses=CAMPUSES,
        bins=[(category, meta) for category, meta in BIN_META.items()],
        badges=BADGES,
        challenge_tasks=CHALLENGE_TASKS,
        challenge_reward=CHALLENGE_REWARD,
        # Handed to app.js as JSON so the frontend never re-declares the
        # category literals, colours or point values that live above.
        domain_config={
            "bins": BIN_META,
            "badges": [
                {"id": badge_id, "name": name} for badge_id, name, _requirement in BADGES
            ],
            "challengeReward": CHALLENGE_REWARD,
        },
    )


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)

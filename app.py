"""EcoSort - gamified waste segregation MVP.

Owns the idempotent SQLite bootstrap (four tables + canonical seed data), the
deterministic classifier seam, and the profile/identify routes. Disposal,
challenge claims and leaderboards arrive in M3/M4.

Run directly (``python app.py``) or via ``flask --app app run``. The database is
bootstrapped on the first request (not at import time), so importing this module
never touches disk.
"""

from __future__ import annotations

import os
import re
import sqlite3
from uuid import uuid4

from flask import Flask, g, jsonify, render_template, request
from werkzeug.utils import secure_filename

import rate_limit
import vision

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_dotenv(path: str | None = None) -> None:
    """Load ``.env`` into the environment without adding a dependency.

    Config only (no writes), so doing it at import is safe — unlike database
    bootstrapping, which happens on the first request. Existing environment
    variables always win, which is what lets the test suite pin its own values.
    """
    env_path = path or os.path.join(BASE_DIR, ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if not key or key in os.environ:
                    continue
                os.environ[key] = value.strip().strip('"').strip("'")
    except OSError:
        # A broken .env must never stop the app from starting.
        return


_load_dotenv()
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
LOCAL_RULES_NOTE = (
    "Rules vary by municipality — check your local waste collection guidance "
    "for what your area actually recycles."
)

FALLBACK_INSTRUCTIONS = (
    "We could not match this item to a known stream. Bag it and drop it in the "
    "gray dry-waste bin; a collection volunteer will re-sort it."
)

# Badge rules (PRD 4.2) expressed as category groups, so the SQL below never
# re-types the canonical category literals.
PLASTIC_CATEGORIES = ("Recyclable Waste", "Dry Waste")
HAZARD_CATEGORIES = ("E-Waste", "Hazardous Waste")

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_USERNAME_LENGTH = 32

# Matching rules for the classifier. A catalog keyword matches only as a whole
# token (so "med" cannot fire on "media_player.png") or as a substring of the
# raw text when the keyword is long enough to be unambiguous (so "paper" still
# matches "newspaper.jpg"). Aliases let everyday words resolve to a seeded
# keyword without inflating the 13-row catalog.
MIN_SUBSTRING_KEYWORD_LENGTH = 5
CATALOG_ALIASES = {
    "medicine": "med",
    "medicines": "med",
    "medication": "med",
    "meds": "med",
    "pills": "med",
    "earbuds": "phone",
    "laptop": "phone",
    "mobile": "phone",
    "smartphone": "phone",
}
_TOKEN_SPLITTER = re.compile(r"[^a-z0-9]+")

# (keyword, display_name, category, instructions, points)
CATALOG_SEED: list[tuple[str, str, str, str, int]] = [
    (
        "banana",
        "Banana Peel",
        "Wet Waste",
        "Drop it in the green wet-waste bin, ideally loose rather than in a "
        "plastic bag, so the community compost pile can take it.",
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

# --- Universal community model (no campus assumptions) --------------------
# `GROUP_PRESETS` are suggestions, not a whitelist: any household, street,
# society, office or region may type its own group name.
DEFAULT_GROUP = "General Community"
DEFAULT_CITY = "Local Area"
GROUP_PRESETS: tuple[str, ...] = (
    "General Community",
    "Home & Family",
    "Neighborhood / Ward",
    "Apartment Society",
    "Workplace / Office",
)
CITY_PRESETS: tuple[str, ...] = (
    "Local Area",
    "Chennai",
    "Coimbatore",
    "Madurai",
    "Bengaluru",
    "Mumbai",
    "Delhi",
)
MAX_GROUP_LENGTH = 48
MAX_CITY_LENGTH = 48

# (username, group_name, city, eco_points) — populated so the group
# standings have something to rank on first launch.
USER_SEED: list[tuple[str, str, str, int]] = [
    ("Aarav", "Home & Family", "Chennai", 145),
    ("Meera", "Apartment Society", "Chennai", 120),
    ("Kabir", "Workplace / Office", "Bengaluru", 95),
    ("Diya", "General Community", "Local Area", 80),
]

# Seven-Day Zero-Waste Challenge (PRD section 4.2). Day -> task text.
CHALLENGE_TASKS = {
    1: "Carry a reusable bottle all day",
    2: "Segregate wet and dry waste at 100% accuracy",
    3: "Refuse single-use plastic bags",
    4: "Compost the day's food scraps",
    5: "Audit your desk for e-waste",
    6: "Rinse and recycle three containers",
    7: "Invite a neighbour or colleague to join EcoSort",
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
    group_name  TEXT DEFAULT 'General Community',
    city        TEXT DEFAULT 'Local Area',
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
    client_token TEXT,
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

# Indexes are created *after* the additive migrations in init_db(): a legacy
# database has no ``client_token`` column yet, and creating this index in the
# same script as the tables would abort the whole boot with
# "no such column: client_token".
INDEX_SQL = """
-- Every badge, bin count and leaderboard query filters on this column.
CREATE INDEX IF NOT EXISTS idx_disposal_user ON disposal_logs(user_id);

-- A retried disposal must not double-credit points. Partial index so rows
-- written before this column existed (token NULL) stay valid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_disposal_token
    ON disposal_logs(user_id, client_token)
    WHERE client_token IS NOT NULL;
"""



def catalog_rows() -> list[tuple[str, str, str, str, str, int]]:
    """Expand CATALOG_SEED into insert tuples, deriving bin colour from BIN_META."""
    rows = []
    for keyword, display_name, category, instructions, points in CATALOG_SEED:
        meta = BIN_META[category]  # KeyError here means a seed row drifted
        rows.append((keyword, display_name, category, meta["bin_color"], instructions, points))
    return rows


def validate_domain_constants() -> None:
    """Catch literal drift before it reaches the database.

    Raised, never asserted: ``python -O`` strips asserts, and a silently
    disabled contract check is worse than a loud startup failure.
    """
    groups = set(PLASTIC_CATEGORIES) | set(HAZARD_CATEGORIES)
    unknown_groups = groups - set(BIN_META)
    if unknown_groups:
        raise ValueError(
            f"badge groups reference unknown categories: {sorted(unknown_groups)}"
        )

    unknown_seed = {row[2] for row in CATALOG_SEED} - set(BIN_META)
    if unknown_seed:
        raise ValueError(f"catalog seed uses unknown categories: {sorted(unknown_seed)}")

    orphan_aliases = set(CATALOG_ALIASES.values()) - {row[0] for row in CATALOG_SEED}
    if orphan_aliases:
        raise ValueError(f"aliases point at missing keywords: {sorted(orphan_aliases)}")


def _migrate_campus_to_group(connection: sqlite3.Connection) -> None:
    """Upgrade pre-generalisation databases in place.

    Older installs have ``users.campus`` and no ``group_name``/``city``. The
    column is added, existing values are copied into ``group_name``, and only
    then is the legacy column dropped (SQLite >= 3.35), so a database created
    during the campus era keeps every user and every point.
    """
    columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
    if not columns:
        return  # table does not exist yet; SCHEMA_SQL will create it

    if "group_name" not in columns:
        connection.execute(
            f"ALTER TABLE users ADD COLUMN group_name TEXT DEFAULT '{DEFAULT_GROUP}'"
        )
    if "city" not in columns:
        connection.execute(
            f"ALTER TABLE users ADD COLUMN city TEXT DEFAULT '{DEFAULT_CITY}'"
        )
    if "campus" in columns:
        connection.execute(
            """
            UPDATE users
            SET group_name = COALESCE(NULLIF(campus, ''), ?)
            WHERE group_name IS NULL OR group_name = ? OR group_name = ''
            """,
            (DEFAULT_GROUP, DEFAULT_GROUP),
        )
        connection.execute(
            "UPDATE users SET city = ? WHERE city IS NULL OR city = ''",
            (DEFAULT_CITY,),
        )
        try:
            connection.execute("ALTER TABLE users DROP COLUMN campus")
        except sqlite3.OperationalError:
            # Older SQLite cannot drop a column; leaving it is harmless because
            # nothing reads it any more.
            pass


def _migrate_disposal_tokens(connection: sqlite3.Connection) -> None:
    """Add ``disposal_logs.client_token`` to databases created before M3.

    ``CREATE TABLE IF NOT EXISTS`` cannot alter an existing table, and the demo
    database is gitignored generated state that people keep between runs, so the
    column is added in place instead of forcing a delete.
    """
    columns = {row[1] for row in connection.execute("PRAGMA table_info(disposal_logs)")}
    if "client_token" not in columns:
        connection.execute("ALTER TABLE disposal_logs ADD COLUMN client_token TEXT")
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_disposal_token
            ON disposal_logs(user_id, client_token)
            WHERE client_token IS NOT NULL
        """
    )


def init_db(database_path: str | None = None) -> None:
    """Create the upload directory, the schema and the seed rows.

    Idempotent: safe to call on every start. Seeds rely on the UNIQUE
    constraints shipped with the schema plus ``INSERT OR IGNORE``, so a second
    run writes nothing and never raises.
    """
    database_path = database_path or DATABASE_PATH
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    validate_domain_constants()

    connection = sqlite3.connect(database_path)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(SCHEMA_SQL)
        _migrate_campus_to_group(connection)
        _migrate_disposal_tokens(connection)
        connection.executescript(INDEX_SQL)
        connection.executemany(
            """
            INSERT OR IGNORE INTO waste_catalog
                (keyword, display_name, category, bin_color, instructions, points)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            catalog_rows(),
        )
        connection.executemany(
            """
            INSERT OR IGNORE INTO users (username, group_name, city, eco_points)
            VALUES (?, ?, ?, ?)
            """,
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
    """Shape a ``users`` row for the JSON contract.

    ``streak_days`` is deliberately absent until M4 actually writes it: a field
    that always reports ``1`` is a lie the UI would eventually trust.
    """
    return {
        "id": row["id"],
        "username": row["username"],
        "group_name": row["group_name"],
        "city": row["city"],
        "eco_points": row["eco_points"],
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


def _match_score(keyword: str, tokens: set[str], haystack: str) -> int:
    """Rank one keyword against the input; 0 means no match.

    Whole-token matches outrank substring matches, and longer keywords outrank
    shorter ones, so the winner is deterministic.
    """
    lowered = keyword.lower()
    if lowered in tokens:
        return 1000 + len(lowered)
    if len(lowered) >= MIN_SUBSTRING_KEYWORD_LENGTH and lowered in haystack:
        return len(lowered)
    return 0


def classify_waste(
    keyword_text: str = "",
    image_path: str | None = None,
    connection: sqlite3.Connection | None = None,
) -> dict:
    """Classify waste from a preset keyword and/or an uploaded file name.

    Deterministic, offline, and the single seam for a future vision model: the
    body can be swapped for a model call without changing the route signature,
    the JSON contract, or any SQL.

    Matching is token-first over ``waste_catalog.keyword`` (see
    ``_match_score``), which is what stops the 3-character ``med`` keyword from
    firing on ``media_player.png``. Only the basename of ``image_path`` is
    considered, so callers may pass either a stored path or the original
    uploaded filename - the latter is preferred, because sanitising a non-ASCII
    name destroys the only signal it carries.

    ``connection`` is optional so the helper can be unit-tested without a Flask
    app context.
    """
    haystack = " ".join(
        part for part in (keyword_text, os.path.basename(image_path or "")) if part
    ).lower()
    tokens = {token for token in _TOKEN_SPLITTER.split(haystack) if token}
    tokens |= {CATALOG_ALIASES[token] for token in tokens if token in CATALOG_ALIASES}

    db = connection if connection is not None else get_db()
    rows = db.execute(
        "SELECT keyword, display_name, category, bin_color, instructions, points "
        "FROM waste_catalog"
    ).fetchall()

    scored = [
        (_match_score(row["keyword"], tokens, haystack), row["keyword"], row)
        for row in rows
    ]
    matches = [entry for entry in scored if entry[0] > 0]

    if matches:
        _score, _keyword, best = max(matches, key=lambda entry: (entry[0], entry[1]))
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


MEDIA_TYPE_BY_EXTENSION = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}


def category_point_bounds() -> dict[str, tuple[int, int]]:
    """Per-category (min, max) reward, derived from the catalog itself.

    The vision model may suggest points, but it can never invent a value the
    catalog does not already justify for that stream.
    """
    bounds: dict[str, tuple[int, int]] = {}
    for _keyword, _name, category, _instructions, points in CATALOG_SEED:
        low, high = bounds.get(category, (points, points))
        bounds[category] = (min(low, points), max(high, points))
    return bounds


def clamp_points(category: str, suggested: int | None) -> int:
    low, high = category_point_bounds().get(
        category, (FALLBACK_POINTS, FALLBACK_POINTS)
    )
    if not isinstance(suggested, int):
        suggested = high
    return max(low, min(high, suggested))


def analyze_waste(
    keyword_text: str = "",
    image_path: str | None = None,
    image_bytes: bytes | None = None,
    media_type: str = "image/jpeg",
    connection: sqlite3.Connection | None = None,
) -> dict:
    """Classify an item, preferring AI vision and always able to fall back.

    The deterministic rules are computed first, so a vision failure degrades to
    exactly the M2 behaviour instead of an error. Every response carries a
    ``source`` field (``ai_vision`` or ``rules``) plus ``confidence``,
    ``preparation_steps`` and ``why``, and — when vision was attempted but did
    not answer — a ``vision_error`` explaining why. Clients can therefore be
    honest about where a recommendation came from.
    """
    result = dict(classify_waste(keyword_text, image_path, connection=connection))
    result.update(
        {
            # `source` is kept as an alias of `analysis_mode` so older clients
            # keep working; `analysis_mode` is the documented field.
            "analysis_mode": "offline_fallback",
            "source": "offline_fallback",
            "item_name": result["display_name"],
            "confidence": None,
            "preparation_steps": [],
            "why": "",
            "ai_model": None,
            "vision_provider": None,
            "vision_available": vision.enabled(),
            "vision_error": None,
        }
    )

    if not vision.enabled():
        return result

    if not image_bytes:
        result["vision_error"] = "no image supplied; filename and preset rules used"
        return result

    try:
        analysis = vision.analyze_image(image_bytes, media_type)
    except vision.VisionError as error:
        # Expected failure (no key, timeout, bad payload): fall back quietly to
        # the rules answer, but tell the client why.
        result["vision_error"] = str(error)
        return result
    except Exception as error:  # noqa: BLE001 - a bug in the analyser must not 500 a scan
        app.logger.warning("vision analysis crashed: %s", error, exc_info=True)
        result["vision_error"] = f"vision analysis failed ({type(error).__name__})"
        return result

    # Defence in depth: vision.py validates the model reply against its
    # response_schema, but this boundary must not trust a callee to have done so.
    # An unknown category here would be a KeyError -> HTTP 500 on a user's scan.
    category = analysis.get("category")
    item_name = str(analysis.get("item_name") or "").strip()
    instructions = str(analysis.get("instructions") or "").strip()
    if category not in BIN_META or not item_name or not instructions:
        result["vision_error"] = (
            "vision returned an unusable result "
            f"(category={category!r}, item_name={bool(item_name)}, "
            f"instructions={bool(instructions)})"
        )
        return result

    # The UI shows steps as a list; the model answers one step per sentence.
    steps = [
        step.strip(" -\t")
        for step in re.split(r"(?<=[.!?])\s+|\n+", instructions)
        if step.strip(" -\t")
    ][:6]

    result.update(
        {
            "display_name": item_name,
            "item_name": item_name,
            "category": category,
            "bin_color": BIN_META[category]["bin_color"],
            "instructions": instructions,
            "points": clamp_points(category, None),
            "matched_keyword": None,
            "fallback": False,
            "analysis_mode": "ai_vision",
            "source": "ai_vision",
            "confidence": analysis.get("confidence") or "Low",
            "preparation_steps": steps,
            "why": analysis.get("why") or "",
            "ai_model": vision.model_name(),
            "vision_provider": "google-genai",
        }
    )
    return result


RATE_LIMIT_BUCKETS = {
    "identify_waste": "identify",
    "create_or_fetch_user": "general",
    "dispose_waste": "general",
    "complete_challenge": "general",
}


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

# Bootstrap runs on the first request, not at import time: importing this module
# (a WSGI server, a test, an REPL) must not mutate disk. The flag keeps the check
# to a boolean once the database exists.
_bootstrapped = False


def ensure_bootstrapped() -> None:
    global _bootstrapped
    if not _bootstrapped:
        init_db()
        _bootstrapped = True


@app.before_request
def _bootstrap_once() -> None:
    ensure_bootstrapped()

    bucket = RATE_LIMIT_BUCKETS.get(request.endpoint or "")
    if bucket is None or request.method != "POST":
        return None

    client = rate_limit.client_key(
        request.remote_addr, request.headers.get("X-Client-Id")
    )
    retry_after = rate_limit.limiter.hit(bucket, client)
    if retry_after is None:
        return None

    limit = rate_limit.configured_limits().get(bucket, 0)
    response = jsonify(
        {
            "error": (
                f"Too many requests. Try again in {retry_after}s "
                f"(limit {limit}/minute)."
            ),
            "bucket": bucket,
            "limit": limit,
            "window_seconds": rate_limit.WINDOW_SECONDS,
            "retry_after": retry_after,
        }
    )
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


@app.after_request
def _cors_headers(response):
    """Allow the Flutter Web client (a different origin in dev) to call the API.

    Wide-open by design: there is no auth in V1, the data is not sensitive and
    the alternative is a client that silently falls back to local mode. A
    deployment with real users needs an explicit origin allowlist instead.
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Vary"] = "Origin"
    return response


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
    ``eco_points`` and the challenge rows, and only refreshes the group and city.

    ``group_name``/``community``/``campus`` are accepted as aliases so older
    clients (and campus-era bookmarks) keep working; the value is free text, not
    a whitelist, because any household, street, society or office may join.
    """
    payload = request.get_json(silent=True)
    if payload is None and request.get_data(cache=True):
        return jsonify({"error": "invalid JSON body"}), 400
    if not isinstance(payload, dict):
        payload = {}

    username = str(payload.get("username") or "").strip()
    if not username:
        return jsonify({"error": "username is required"}), 400
    if len(username) > MAX_USERNAME_LENGTH:
        return (
            jsonify(
                {"error": f"username must be {MAX_USERNAME_LENGTH} characters or fewer"}
            ),
            400,
        )

    group_name = str(
        payload.get("group_name")
        or payload.get("community")
        or payload.get("campus")
        or ""
    ).strip() or DEFAULT_GROUP
    city = str(payload.get("city") or payload.get("region") or "").strip() or DEFAULT_CITY

    if len(group_name) > MAX_GROUP_LENGTH:
        return (
            jsonify(
                {"error": f"group_name must be {MAX_GROUP_LENGTH} characters or fewer"}
            ),
            400,
        )
    if len(city) > MAX_CITY_LENGTH:
        return (
            jsonify({"error": f"city must be {MAX_CITY_LENGTH} characters or fewer"}),
            400,
        )

    db = get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        db.execute(
            "INSERT INTO users (username, group_name, city) VALUES (?, ?, ?)",
            (username, group_name, city),
        )
        db.commit()
        row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    elif group_name != row["group_name"] or city != row["city"]:
        db.execute(
            "UPDATE users SET group_name = ?, city = ? WHERE id = ?",
            (group_name, city, row["id"]),
        )
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
    image_url = None
    original_name = ""
    image_bytes: bytes | None = None
    media_type = "image/jpeg"
    upload = request.files.get("image")
    if upload is not None and upload.filename:
        # Classify from the ORIGINAL name. secure_filename() strips non-ASCII
        # characters wholesale (a Tamil name collapses to "jpg"), so sanitising
        # before classifying would throw away the only signal we have.
        original_name = os.path.basename(upload.filename.replace("\\", "/"))
        extension = os.path.splitext(original_name)[1].lower()
        if extension in ALLOWED_IMAGE_EXTENSIONS:
            data = upload.read()
            stored_name = secure_filename(original_name)
            stem, stored_extension = os.path.splitext(stored_name)
            if not stem or stored_extension.lower() not in ALLOWED_IMAGE_EXTENSIONS:
                stored_name = f"upload_{uuid4().hex[:8]}{extension}"
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            image_path = os.path.join(UPLOAD_DIR, stored_name)
            with open(image_path, "wb") as handle:
                handle.write(data)
            image_url = f"/static/uploads/{stored_name}"
            image_bytes = data
            media_type = MEDIA_TYPE_BY_EXTENSION.get(extension, "image/jpeg")

    # Protect the paid model call separately from the general identify budget.
    vision_note: str | None = None
    if image_bytes and vision.enabled():
        retry_after = rate_limit.limiter.hit(
            "ai_vision",
            rate_limit.client_key(
                request.remote_addr, request.headers.get("X-Client-Id")
            ),
        )
        if retry_after is not None:
            image_bytes = None  # rules-only answer, but still a valid one
            vision_note = (
                f"AI vision rate limit reached; retry in {retry_after}s. "
                "Answered with offline rules."
            )

    result = analyze_waste(
        keyword,
        image_path or original_name or None,
        image_bytes=image_bytes,
        media_type=media_type,
    )
    if vision_note:
        result["vision_error"] = vision_note
    result["local_note"] = LOCAL_RULES_NOTE
    result["image_url"] = image_url
    return jsonify(result)


@app.post("/api/dispose")
def dispose_waste():
    """Log a disposal, award points and return the refreshed user state.

    The contract in the PRD lets the client send ``category`` and ``points``.
    Those fields are **ignored**: the value is re-derived here from
    ``waste_catalog`` through ``classify_waste``, because there is no auth in
    V1 and a trusting server would let any client award itself 999999 points.

    Idempotency comes from ``client_token`` (server-generated when absent) and
    the unique partial index on ``(user_id, client_token)``, so a retried request
    returns the original result instead of double-crediting.
    """
    payload = request.get_json(silent=True)
    if payload is None and request.get_data(cache=True):
        return jsonify({"error": "invalid JSON body"}), 400
    if not isinstance(payload, dict):
        payload = {}

    user_id = payload.get("user_id")
    if not isinstance(user_id, int) or isinstance(user_id, bool):
        return jsonify({"error": "user_id is required and must be an integer"}), 400

    item_name = str(payload.get("item_name") or "").strip()
    if not item_name:
        return jsonify({"error": "item_name is required"}), 400
    if len(item_name) > 120:
        return jsonify({"error": "item_name must be 120 characters or fewer"}), 400

    client_token = str(payload.get("client_token") or "").strip()
    if len(client_token) > 64:
        return jsonify({"error": "client_token must be 64 characters or fewer"}), 400
    if not client_token:
        client_token = uuid4().hex

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        return jsonify({"error": "unknown user_id"}), 404

    # Server-side truth. The client's category/points never reach the database.
    resolved = classify_waste(item_name)

    duplicate = db.execute(
        "SELECT id FROM disposal_logs WHERE user_id = ? AND client_token = ?",
        (user_id, client_token),
    ).fetchone()
    if duplicate is None:
        try:
            db.execute(
                """
                INSERT INTO disposal_logs
                    (user_id, item_name, category, points_earned, client_token)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    item_name,
                    resolved["category"],
                    resolved["points"],
                    client_token,
                ),
            )
            db.execute(
                "UPDATE users SET eco_points = eco_points + ? WHERE id = ?",
                (resolved["points"], user_id),
            )
            db.commit()
        except sqlite3.IntegrityError:
            # Lost a race to an identical token; the first write already
            # credited the points, so fall through and report current state.
            db.rollback()
            duplicate = True

    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return jsonify(
        {
            "new_points": row["eco_points"],
            "badges": badge_states(db, user_id, row["eco_points"]),
            "bin_counts": bin_counts_for(db, user_id),
            "logged": {
                "item_name": item_name,
                "category": resolved["category"],
                "bin_color": resolved["bin_color"],
                "points": resolved["points"],
                "fallback": resolved["fallback"],
            },
            "duplicate": duplicate is not None,
        }
    )


@app.post("/api/challenge/complete")
def complete_challenge():
    """Mark one challenge day complete; award +15 exactly once.

    The write is a single conditional UPDATE guarded by ``completed = 0`` and
    its ``rowcount``, not a read-then-write: two concurrent claims would both
    pass a read, and the second would raise ``IntegrityError`` (HTTP 500) where
    the contract promises "+0".
    """
    payload = request.get_json(silent=True)
    if payload is None and request.get_data(cache=True):
        return jsonify({"error": "invalid JSON body"}), 400
    if not isinstance(payload, dict):
        payload = {}

    user_id = payload.get("user_id")
    if not isinstance(user_id, int) or isinstance(user_id, bool):
        return jsonify({"error": "user_id is required and must be an integer"}), 400

    day_number = payload.get("day_number")
    if not isinstance(day_number, int) or isinstance(day_number, bool):
        return jsonify({"error": "day_number is required and must be an integer"}), 400
    if day_number not in CHALLENGE_TASKS:
        return jsonify({"error": f"day_number must be between 1 and {len(CHALLENGE_TASKS)}"}), 400

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        return jsonify({"error": "unknown user_id"}), 404

    ensure_challenge_rows(db, user_id)
    cursor = db.execute(
        """
        UPDATE user_challenges
        SET completed = 1
        WHERE user_id = ? AND day_number = ? AND completed = 0
        """,
        (user_id, day_number),
    )
    awarded = cursor.rowcount == 1
    if awarded:
        db.execute(
            "UPDATE users SET eco_points = eco_points + ? WHERE id = ?",
            (CHALLENGE_REWARD, user_id),
        )
    db.commit()

    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return jsonify(
        {
            "new_points": row["eco_points"],
            "challenges": challenge_payload(db, user_id),
            "awarded": awarded,
            "awarded_points": CHALLENGE_REWARD if awarded else 0,
        }
    )


@app.get("/api/leaderboard")
def leaderboard():
    """Top contributors overall, plus group/community standings.

    Both lists are plain SQL over the same rows, so a group total can never
    disagree with the sum of its members. Ties break on the primary key (users)
    and on the group name (groups), which keeps the order deterministic and the
    verification suite non-flaky.
    """
    db = get_db()
    users = db.execute(
        "SELECT id, username, group_name, city, eco_points FROM users "
        "ORDER BY eco_points DESC, id ASC LIMIT 10"
    ).fetchall()
    groups = db.execute(
        """
        SELECT group_name,
               SUM(eco_points) AS total_points,
               COUNT(*) AS members
        FROM users
        GROUP BY group_name
        ORDER BY total_points DESC, group_name ASC
        """
    ).fetchall()

    return jsonify(
        {
            "users": [
                {
                    "id": row["id"],
                    "username": row["username"],
                    "group_name": row["group_name"],
                    "city": row["city"],
                    "eco_points": row["eco_points"],
                }
                for row in users
            ],
            "groups": [
                {
                    "group_name": row["group_name"],
                    "total_points": row["total_points"],
                    "members": row["members"],
                }
                for row in groups
            ],
        }
    )


@app.get("/api/capabilities")
def capabilities():
    """What this instance can do, so the UI can label results honestly."""
    return jsonify(
        {
            "ai_vision": vision.status(),
            "rate_limits": rate_limit.configured_limits(),
            "rate_limit_enabled": rate_limit.is_enabled(),
            "categories": [
                {
                    "label": category,
                    "bin_color": meta["bin_color"],
                    "hex": meta["hex"],
                }
                for category, meta in BIN_META.items()
            ],
            "group_presets": list(GROUP_PRESETS),
            "city_presets": list(CITY_PRESETS),
            "defaults": {"group_name": DEFAULT_GROUP, "city": DEFAULT_CITY},
        }
    )


@app.route("/")
def index():
    """Serve the single-page shell with its canonical domain constants."""
    return render_template(
        "index.html",
        group_presets=GROUP_PRESETS,
        city_presets=CITY_PRESETS,
        default_group=DEFAULT_GROUP,
        default_city=DEFAULT_CITY,
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


if __name__ == "__main__":
    ensure_bootstrapped()
    app.run(host="127.0.0.1", port=5000, debug=False)

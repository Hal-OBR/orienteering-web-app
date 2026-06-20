"""オリエンテーリングWebアプリ用の小さな共有サーバー。標準ライブラリのみで動作します。"""
from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "orienteering.db"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "chizuru-demo")
SESSION_SECONDS = 60 * 60 * 8
SESSIONS: dict[str, float] = {}
LOGIN_ATTEMPTS: dict[str, list[float]] = {}
LOGIN_WINDOW = 60 * 10
LOGIN_LIMIT = 5


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS course (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                title TEXT NOT NULL,
                duration TEXT NOT NULL,
                distance TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS checkpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                distance TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                hint TEXT NOT NULL DEFAULT '',
                mission TEXT NOT NULL DEFAULT '',
                explain TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        if not db.execute("SELECT 1 FROM course WHERE id=1").fetchone():
            seed = json.loads((ROOT / "seed.json").read_text(encoding="utf-8"))
            c = seed["course"]
            db.execute("INSERT INTO course(id,title,duration,distance) VALUES(1,?,?,?)", (c["title"], c["duration"], c["distance"]))
            for order, cp in enumerate(seed["checkpoints"], 1):
                db.execute("""INSERT INTO checkpoints(id,name,lat,lng,points,distance,category,hint,mission,explain,sort_order)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)""", (cp["id"], cp["name"], cp["lat"], cp["lng"], cp["points"], cp["distance"], cp["category"], cp["hint"], cp["mission"], cp["explain"], order))


def public_data():
    with connect() as db:
        course = dict(db.execute("SELECT title,duration,distance,updated_at FROM course WHERE id=1").fetchone())
        points = [dict(row) for row in db.execute("""SELECT id,name,lat,lng,points,distance,category,hint,mission,explain
            FROM checkpoints ORDER BY sort_order,id""")]
    return {"course": course, "checkpoints": points}


class Handler(SimpleHTTPRequestHandler):
    server_version = "OrienteeringPrototype/1.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, data, status=HTTPStatus.OK, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, json.JSONDecodeError):
            return None

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie.get("admin_session").value if cookie.get("admin_session") else None

    def is_admin(self):
        now = time.time()
        for token, expiry in list(SESSIONS.items()):
            if expiry < now:
                SESSIONS.pop(token, None)
        token = self.session_token()
        return bool(token and SESSIONS.get(token, 0) > now)

    def require_admin(self):
        if self.is_admin():
            return True
        self.send_json({"error": "管理者ログインが必要です"}, HTTPStatus.UNAUTHORIZED)
        return False

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/course":
            return self.send_json(public_data())
        if path == "/api/admin/session":
            return self.send_json({"authenticated": self.is_admin()})
        if path.startswith("/api/"):
            return self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data = self.read_json()
        if data is None:
            return self.send_json({"error": "JSONが不正です"}, HTTPStatus.BAD_REQUEST)
        if path == "/api/admin/login":
            client = self.client_address[0]
            now = time.time()
            attempts = [stamp for stamp in LOGIN_ATTEMPTS.get(client, []) if stamp > now - LOGIN_WINDOW]
            LOGIN_ATTEMPTS[client] = attempts
            if len(attempts) >= LOGIN_LIMIT:
                return self.send_json({"error": "ログイン試行が多すぎます。10分後に再試行してください"}, HTTPStatus.TOO_MANY_REQUESTS)
            supplied = str(data.get("password", ""))
            if not hmac.compare_digest(supplied, ADMIN_PASSWORD):
                attempts.append(now)
                return self.send_json({"error": "パスワードが違います"}, HTTPStatus.UNAUTHORIZED)
            LOGIN_ATTEMPTS.pop(client, None)
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = time.time() + SESSION_SECONDS
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
            return self.send_json({"authenticated": True}, headers={"Set-Cookie": f"admin_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}{secure}"})
        if path == "/api/admin/logout":
            token = self.session_token()
            if token:
                SESSIONS.pop(token, None)
            return self.send_json({"authenticated": False}, headers={"Set-Cookie": "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
        if path == "/api/admin/checkpoints":
            if not self.require_admin(): return
            return self.save_checkpoint(data)
        return self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        data = self.read_json()
        if data is None:
            return self.send_json({"error": "JSONが不正です"}, HTTPStatus.BAD_REQUEST)
        if path == "/api/admin/course":
            if not self.require_admin(): return
            values = [str(data.get(k, "")).strip() for k in ("title", "duration", "distance")]
            if not all(values): return self.send_json({"error": "すべて入力してください"}, HTTPStatus.BAD_REQUEST)
            with connect() as db:
                db.execute("UPDATE course SET title=?,duration=?,distance=?,updated_at=CURRENT_TIMESTAMP WHERE id=1", values)
            return self.send_json(public_data())
        if path.startswith("/api/admin/checkpoints/"):
            if not self.require_admin(): return
            try: checkpoint_id = int(path.rsplit("/", 1)[1])
            except ValueError: return self.send_json({"error": "IDが不正です"}, HTTPStatus.BAD_REQUEST)
            return self.save_checkpoint(data, checkpoint_id)
        return self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def save_checkpoint(self, data, checkpoint_id=None):
        required = ("name", "lat", "lng", "points", "category", "hint", "mission", "explain")
        if any(data.get(k) in (None, "") for k in required):
            return self.send_json({"error": "すべての必須項目を入力してください"}, HTTPStatus.BAD_REQUEST)
        try:
            values = (str(data["name"]).strip(), float(data["lat"]), float(data["lng"]), int(data["points"]), str(data.get("distance", "距離未計測")), str(data["category"]).strip(), str(data["hint"]).strip(), str(data["mission"]).strip(), str(data["explain"]).strip())
        except (TypeError, ValueError):
            return self.send_json({"error": "座標または得点が不正です"}, HTTPStatus.BAD_REQUEST)
        if not (-90 <= values[1] <= 90 and -180 <= values[2] <= 180):
            return self.send_json({"error": "座標の範囲が不正です"}, HTTPStatus.BAD_REQUEST)
        with connect() as db:
            if checkpoint_id is None:
                order = db.execute("SELECT COALESCE(MAX(sort_order),0)+1 FROM checkpoints").fetchone()[0]
                cur = db.execute("""INSERT INTO checkpoints(name,lat,lng,points,distance,category,hint,mission,explain,sort_order)
                    VALUES(?,?,?,?,?,?,?,?,?,?)""", (*values, order))
                checkpoint_id = cur.lastrowid
            else:
                cur = db.execute("""UPDATE checkpoints SET name=?,lat=?,lng=?,points=?,distance=?,category=?,hint=?,mission=?,explain=?,updated_at=CURRENT_TIMESTAMP WHERE id=?""", (*values, checkpoint_id))
                if not cur.rowcount: return self.send_json({"error": "地点が見つかりません"}, HTTPStatus.NOT_FOUND)
        result = public_data()
        result["saved_id"] = checkpoint_id
        return self.send_json(result, HTTPStatus.CREATED if self.command == "POST" else HTTPStatus.OK)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/admin/checkpoints/"):
            return self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        if not self.require_admin(): return
        try: checkpoint_id = int(path.rsplit("/", 1)[1])
        except ValueError: return self.send_json({"error": "IDが不正です"}, HTTPStatus.BAD_REQUEST)
        with connect() as db:
            cur = db.execute("DELETE FROM checkpoints WHERE id=?", (checkpoint_id,))
        if not cur.rowcount: return self.send_json({"error": "地点が見つかりません"}, HTTPStatus.NOT_FOUND)
        return self.send_json(public_data())


if __name__ == "__main__":
    os.chdir(ROOT)
    init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print(f"Listening on http://{host}:{port}")
    print("Admin password is read from ADMIN_PASSWORD (prototype default is documented in README).")
    ThreadingHTTPServer((host, port), Handler).serve_forever()

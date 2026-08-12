#!/usr/bin/env python3
"""FX Vision PWA — static files + market-data proxy."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8080"))
UPSTREAMS = (
    "https://data-api.binance.vision",
    "https://api.binance.com",
    "https://api.binance.us",
)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        print("[fxvision]", fmt % args, flush=True);

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/klines":
            return self._proxy_klines(parsed.query)
        if parsed.path == "/api/tickers":
            return self._proxy_tickers(parsed.query)
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def _send_json(self, payload, status=200):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _fetch(self, path: str) -> bytes:
        last_err: Exception | None = None
        for base in UPSTREAMS:
            req = urllib.request.Request(
                f"{base}{path}",
                headers={"User-Agent": "FXVisionPWA/1.0", "Accept": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=12) as res:
                    return res.read()
            except Exception as exc:
                last_err = exc
        raise last_err or RuntimeError("no upstream")

    def _write_body(self, body: bytes, content_type="application/json"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_klines(self, query: str):
        qs = urllib.parse.parse_qs(query)
        symbol = (qs.get("symbol") or ["BTCUSDT"])[0].upper()
        interval = (qs.get("interval") or ["4h"])[0]
        limit = (qs.get("limit") or ["160"])[0]
        path = (
            f"/api/v3/klines?symbol={urllib.parse.quote(symbol)}"
            f"&interval={urllib.parse.quote(interval)}"
            f"&limit={urllib.parse.quote(limit)}"
        )
        try:
            self._write_body(self._fetch(path))
        except urllib.error.HTTPError as exc:
            self._send_json({"error": f"Market data {exc.code} for {symbol}"}, 502)
        except Exception as exc:
            self._send_json({"error": str(exc)}, 502)

    def _proxy_tickers(self, query: str):
        qs = urllib.parse.parse_qs(query)
        raw = (qs.get("symbols") or [""])[0]
        symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]
        if symbols:
            packed = json.dumps(symbols, separators=(",", ":"))
            path = f"/api/v3/ticker/24hr?symbols={urllib.parse.quote(packed)}"
        else:
            path = "/api/v3/ticker/24hr"
        try:
            self._write_body(self._fetch(path))
        except Exception:
            if not symbols:
                self._send_json({"error": "tickers unavailable"}, 502)
                return
            rows = []
            for symbol in symbols:
                try:
                    raw = self._fetch(f"/api/v3/ticker/24hr?symbol={urllib.parse.quote(symbol)}")
                    rows.append(json.loads(raw))
                except Exception:
                    continue
            if not rows:
                self._send_json({"error": "tickers unavailable"}, 502)
                return
            self._write_body(json.dumps(rows).encode("utf-8"))


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[twoline] http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

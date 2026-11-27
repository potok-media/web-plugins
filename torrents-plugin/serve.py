#!/usr/bin/env python3
"""Serve the torrents plugin directly from its source directory."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parent


class PluginRequestHandler(SimpleHTTPRequestHandler):
    """Static-file handler tailored for local Potok plugin development."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".map": "application/json; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(PLUGIN_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib handler API
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def list_directory(self, path: str):  # type: ignore[no-untyped-def]
        self.send_error(403, "Directory listing is disabled")
        return None

    def translate_path(self, path: str) -> str:
        candidate = Path(super().translate_path(path)).resolve()
        try:
            candidate.relative_to(PLUGIN_ROOT)
        except ValueError:
            return str(PLUGIN_ROOT / ".not-found")
        return str(candidate)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {format % args}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the Potok torrents plugin without publishing it.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Address to bind to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8091,
        help="Port to listen on (default: 8091)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), PluginRequestHandler)
    display_host = "localhost" if args.host in {"127.0.0.1", "::1"} else args.host
    manifest_url = f"http://{display_host}:{server.server_port}/manifest.json"

    print(f"Serving {PLUGIN_ROOT}")
    print(f"Manifest: {manifest_url}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

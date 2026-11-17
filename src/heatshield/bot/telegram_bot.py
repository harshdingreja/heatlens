"""Push a HeatShield alert to a Telegram chat (stretch goal).

What it does:
1. GET  /forecast?days=5 from the HeatShield API and find the worst day.
2. If that day's alert is at or above a threshold (default: Extreme Caution),
   POST /advisory for that day in the chosen language.
3. Send the 5-day outlook + advisory with the Telegram Bot API `sendMessage`
   (https://api.telegram.org/bot<token>/sendMessage, params chat_id + text,
   text max 4096 characters; checked against Bot API 10.4, 9 Nov 2026).

Setup: create a bot with @BotFather, put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
in .env. Run it once a day, e.g. with cron.

Usage (from the project root, with the API running):
    python -m heatshield.bot.telegram_bot --dry-run          # print only, sends nothing
    python -m heatshield.bot.telegram_bot --lang mr          # send if alert >= extreme_caution
    python -m heatshield.bot.telegram_bot --threshold danger --force
"""
from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv

from heatshield.config import PROJECT_ROOT

load_dotenv(PROJECT_ROOT / ".env", override=False)

ALERT_ORDER = ["green", "caution", "extreme_caution", "danger", "extreme_danger"]
COLOR_EMOJI = {"green": "🟢", "yellow": "🟡", "orange": "🟠", "red": "🔴"}
TELEGRAM_URL = "https://api.telegram.org/bot{token}/sendMessage"
MAX_TELEGRAM_CHARS = 4096


def alert_rank(day: dict) -> int:
    """0 (green) .. 4 (extreme danger). Uses the alert key, falls back to the numeric level."""
    alert = day.get("alert") or {}
    if alert.get("key") in ALERT_ORDER:
        return ALERT_ORDER.index(alert["key"])
    return int(alert.get("level") or 0)


def worst_day(forecast: dict) -> dict:
    """The forecast day with the highest alert (ties: the earliest day)."""
    return max(forecast["days"], key=alert_rank)


def format_message(forecast: dict, advisory: dict | None) -> str:
    lines = ["HeatShield Mumbai: heat outlook"]
    for day in forecast["days"]:
        alert = day.get("alert") or {}
        hi = day.get("heat_index_corrected_c")
        if hi is None:
            hi = day.get("heat_index_raw_c")
        hi_text = f"{hi:.1f} °C" if hi is not None else "n/a"
        emoji = COLOR_EMOJI.get(alert.get("color"), "")
        lines.append(f"{emoji} {day['date']}: {alert.get('label', '?')} (heat index {hi_text})")
    if advisory:
        lines += ["", advisory["text"], "", f"(advisory: {advisory.get('provider', '?')})"]
    text = "\n".join(lines)
    return text[:MAX_TELEGRAM_CHARS]


def send_message(token: str, chat_id: str, text: str) -> dict:
    response = requests.post(
        TELEGRAM_URL.format(token=token),
        json={"chat_id": chat_id, "text": text, "link_preview_options": {"is_disabled": True}},
        timeout=15,
    )
    data = response.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram error: {data.get('description')}")
    return data


def run(api_url: str, lang: str, threshold: str, dry_run: bool, force: bool) -> int:
    forecast = requests.get(f"{api_url}/forecast", params={"days": 5}, timeout=60).json()
    worst = worst_day(forecast)
    if alert_rank(worst) < ALERT_ORDER.index(threshold) and not force:
        print(f"Worst alert is '{(worst.get('alert') or {}).get('key')}', below '{threshold}'. Nothing sent.")
        return 0

    advisory = requests.post(f"{api_url}/advisory", json={
        "lang": lang,
        "date": worst["date"],
        "alert_level": ALERT_ORDER[alert_rank(worst)],
        "heat_index_c": worst.get("heat_index_corrected_c"),
    }, timeout=60).json()
    text = format_message(forecast, advisory)

    if dry_run:
        print("[dry run] would send:\n" + text)
        return 0
    token, chat_id = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env", file=sys.stderr)
        return 1
    send_message(token, chat_id, text)
    print("Sent.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Send a HeatShield heat alert to Telegram.")
    parser.add_argument("--api-url", default=os.getenv("HEATSHIELD_API_URL", "http://localhost:8000"))
    parser.add_argument("--lang", choices=["en", "mr", "hi"], default="en")
    parser.add_argument("--threshold", choices=ALERT_ORDER, default="extreme_caution")
    parser.add_argument("--dry-run", action="store_true", help="print the message instead of sending")
    parser.add_argument("--force", action="store_true", help="send even if below the threshold")
    args = parser.parse_args(argv)
    return run(args.api_url.rstrip("/"), args.lang, args.threshold, args.dry_run, args.force)


if __name__ == "__main__":
    sys.exit(main())

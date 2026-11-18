# LLM advisories (EN / मराठी / हिंदी)

Code: `src/heatlens/llm/advisory.py` · Tests: `tests/test_advisory.py` (31 tests, no network)

## Providers (docs checked 17 Nov 2026)
| Order | Provider | Endpoint | Auth | Default model (env override) |
|---|---|---|---|---|
| 1 | Groq | `POST https://api.groq.com/openai/v1/chat/completions` (OpenAI-compatible) | `Authorization: Bearer $GROQ_API_KEY` | `llama-3.3-70b-versatile` (`GROQ_MODEL`) |
| 2 | Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` | `x-goog-api-key: $GEMINI_API_KEY` | `gemini-3.8-flash` (`GEMINI_MODEL`) |
| 3 | Template | built in, no network | none | hand-written EN/MR/HI × 5 alert levels |

Notes from the docs: Groq replaced `max_tokens` with `max_completion_tokens`. Google now recommends its newer
*Interactions* API, but `generateContent` is documented as "legacy but still supported" and has a simpler,
documented response (`candidates[0].content.parts[].text`). Gemini 3.6+ ignores `temperature`, so we don't send it.
Plain `requests` is used (no SDKs): one 15 s timeout and one retry on 429 / 5xx / network errors.

## Prompt design
The system prompt sets the rules. The user message is a fact sheet (`date`, `alert_level`, `heat_index_c`,
`most_vulnerable_wards`, `safe_outdoor_work_hours: before 11:00 and after 16:00`, `ambulance_number: 108`).
Rules: write only in the requested language (Devanagari for mr/hi, no transliteration), use **only numbers from
the fact sheet**, one opening sentence plus 3–5 `- ` bullet actions, at most 120 words, no markdown or emojis.

## Validator: why we don't just trust the LLM
`validate_advisory()` runs on every LLM answer before it is shown:
1. **Numbers:** convert Devanagari digits (`३९` → `39`), ignore list numbering, extract every number. Each must be
   in the allowed set: date parts, 11, 16, 0 (from "11:00"), 108, and the heat index ± 0.5 (so 39.1 may appear as 39).
   "4 pm" is deliberately *not* allowed: a test showed that allowing 4 also lets an invented "४ litres" through.
2. **Script:** Marathi/Hindi must be ≥ 60 % Devanagari letters; English must contain none.
3. **Length:** at most 1.5 × 120 words.

If an answer fails, the next provider is tried, then the template. `response["debug"]["attempts"]` records why
each provider was skipped, errored or rejected.

## Usage
```python
from heatlens.llm.advisory import generate_advisory
r = generate_advisory("mr", "2026-11-18", "extreme_caution", "Extreme Caution", 39.1, ["K/E", "L"])
r["text"], r["provider"]   # provider is "groq" | "gemini" | "template"
```
Quick manual check: `python -m heatlens.llm.advisory` (prints all 3 languages).

## Telegram bot (stretch): `src/heatlens/bot/telegram_bot.py`
Calls the running API (`GET /forecast?days=5`, `POST /advisory`) and sends the 5-day outlook + advisory with the
Bot API `sendMessage` (`chat_id`, `text` ≤ 4096 chars; checked against Bot API 10.4, 9 Nov 2026), **only if** the
worst day is at or above `--threshold` (default `extreme_caution`).
```bash
python -m heatlens.bot.telegram_bot --dry-run            # prints, sends nothing
python -m heatlens.bot.telegram_bot --lang hi --threshold danger
```
Setup: create a bot with @BotFather and put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.

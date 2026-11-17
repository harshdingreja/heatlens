"""Tests for the LLM advisory module and the Telegram bot.

No test touches the network: requests.post / requests.get are replaced
("monkeypatched") with fakes that return canned answers or fail loudly.
"""
import pytest

from heatshield.bot import telegram_bot
from heatshield.llm import advisory as adv

ARGS = dict(date="2026-11-18", alert_key="extreme_caution", alert_label="Extreme Caution",
            heat_index_c=39.1, top_wards=["K/E", "L", "M/E"])

GOOD_EN = ("HeatShield advisory for Mumbai, 2026-11-18: Extreme Caution, heat index 39.1 °C. "
           "Most vulnerable wards: K/E, L, M/E.\n- Do heavy outdoor work before 11:00 or after 16:00.\n"
           "- Drink water often.\n- Check on elderly neighbours.\n- Heat stroke signs mean call 108.")
GOOD_MR = ("मुंबई, 2026-11-18: अति सावधगिरी, हीट इंडेक्स ३९.१ °C. सर्वाधिक असुरक्षित वॉर्ड: K/E, L, M/E.\n"
           "- जड कामे 11:00 पूर्वी किंवा 16:00 नंतर करा.\n- वारंवार पाणी प्या.\n"
           "- वृद्ध शेजाऱ्यांची चौकशी करा.\n- उष्माघाताची लक्षणे दिसल्यास 108 वर कॉल करा.")


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def groq_reply(text):
    return FakeResponse(200, {"choices": [{"message": {"content": text}, "finish_reason": "stop"}]})


def gemini_reply(text):
    return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})


@pytest.fixture(autouse=True)
def no_wait_no_keys(monkeypatch):
    """Every test starts with no API keys and no retry pauses."""
    monkeypatch.setattr(adv, "RETRY_WAIT_S", 0)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)


def fake_post(monkeypatch, routes):
    """Route requests.post by URL to a list of responses; record every call."""
    calls = []

    def _post(url, **kwargs):
        calls.append(url)
        for marker, responses in routes.items():
            if marker in url:
                return responses.pop(0) if len(responses) > 1 else responses[0]
        raise AssertionError(f"unexpected POST to {url}")

    monkeypatch.setattr(adv.requests, "post", _post)
    return calls


# ------------------------------------------------------------ templates ---
@pytest.mark.parametrize("lang", ["en", "mr", "hi"])
@pytest.mark.parametrize("level", adv.ALERT_KEYS)
def test_template_every_language_and_level(lang, level):
    result = adv.generate_advisory(lang, "2026-11-18", level, level, 39.1, ["K/E", "L"])
    assert result["provider"] == "template"
    assert result["text"].count("\n- ") >= 3            # at least 3 actions
    assert adv.validate_advisory(result["text"], result["inputs_used"]) == []  # templates pass our own check
    if lang in ("mr", "hi"):
        assert adv.devanagari_share(result["text"]) > 0.6


def test_template_without_heat_index_or_wards():
    result = adv.generate_advisory("hi", "2026-11-18", "danger", "Danger", None, [])
    assert result["provider"] == "template"
    assert "°C" not in result["text"]


def test_no_network_when_no_keys(monkeypatch):
    def explode(*a, **k):
        raise AssertionError("network must not be used without API keys")
    monkeypatch.setattr(adv.requests, "post", explode)
    monkeypatch.setattr(adv.requests, "get", explode)
    result = adv.generate_advisory("en", **ARGS)
    assert result["provider"] == "template"
    assert [a["status"] for a in result["debug"]["attempts"]] == ["skipped (no API key)"] * 2


# ------------------------------------------------------- provider order ---
def test_groq_is_tried_first(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    calls = fake_post(monkeypatch, {"groq.com": [groq_reply(GOOD_EN)], "googleapis.com": [gemini_reply(GOOD_EN)]})
    result = adv.generate_advisory("en", **ARGS)
    assert result["provider"] == "groq"
    assert len(calls) == 1 and "groq.com" in calls[0]


def test_gemini_used_when_groq_fails(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    calls = fake_post(monkeypatch, {"groq.com": [FakeResponse(503, {"error": "busy"})],
                                    "googleapis.com": [gemini_reply(GOOD_MR)]})
    result = adv.generate_advisory("mr", **ARGS)
    assert result["provider"] == "gemini"
    assert sum("groq.com" in c for c in calls) == 2      # one retry on 5xx
    assert "error" in result["debug"]["attempts"][0]["status"]


def test_invented_numbers_fall_back_to_template(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    fake_post(monkeypatch, {
        "groq.com": [groq_reply(GOOD_EN + "\n- Heatwaves raise deaths by 40%.")],
        "googleapis.com": [gemini_reply(GOOD_EN + "\n- Drink ४ litres of पानी.")],
    })
    result = adv.generate_advisory("en", **ARGS)
    assert result["provider"] == "template"
    problems = [p for a in result["debug"]["attempts"] for p in a.get("problems", [])]
    assert "number not in inputs: 40" in problems   # Groq's invented percentage
    assert "number not in inputs: 4" in problems    # Gemini's invented "४ litres" (Devanagari digit)
    assert any("Devanagari" in p for p in problems)  # and Devanagari inside English text


def test_gemini_blocked_prompt_is_an_error(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    fake_post(monkeypatch, {"googleapis.com": [FakeResponse(200, {"promptFeedback": {"blockReason": "SAFETY"}})]})
    result = adv.generate_advisory("en", **ARGS)
    assert result["provider"] == "template"
    assert "no answer" in result["debug"]["attempts"][1]["status"]


# ------------------------------------------------------------ validator ---
def test_devanagari_digits_are_read():
    assert adv.extract_numbers("हीट इंडेक्स ३९.१ °C, 108") == [39.1, 108.0]


def test_validator_rejects_invented_devanagari_number():
    inputs = adv.build_inputs("hi", "2026-11-18", "danger", "Danger", 39.1, ["K/E"], None)
    problems = adv.validate_advisory("मुंबई में ५० प्रतिशत अधिक मौतें हो सकती हैं।", inputs)
    assert problems == ["number not in inputs: 50"]


def test_validator_allows_rounded_heat_index_only():
    inputs = adv.build_inputs("en", "2026-11-18", "danger", "Danger", 39.1, [], None)
    assert adv.validate_advisory("Heat index near 39 °C today.", inputs) == []
    assert adv.validate_advisory("Heat index near 41 °C today.", inputs) == ["number not in inputs: 41"]


def test_validator_ignores_list_numbering():
    inputs = adv.build_inputs("en", "2026-11-18", "caution", "Caution", None, [], None)
    assert adv.validate_advisory("Advice:\n1. Drink water.\n2. Rest in shade.\n3. Call 108 if needed.", inputs) == []


def test_validator_rejects_wrong_script():
    inputs = adv.build_inputs("mr", "2026-11-18", "caution", "Caution", None, [], None)
    assert any("Devanagari" in p for p in adv.validate_advisory("Drink water and rest in shade.", inputs))


def test_bad_arguments_raise():
    with pytest.raises(ValueError):
        adv.generate_advisory("fr", **ARGS)
    with pytest.raises(ValueError):
        adv.generate_advisory("en", **{**ARGS, "alert_key": "purple"})


# --------------------------------------------------------- telegram bot ---
FORECAST = {"days": [
    {"date": "2026-11-18", "heat_index_corrected_c": 36.0, "alert": {"level": 2, "key": "extreme_caution", "label": "Extreme Caution", "color": "yellow"}},
    {"date": "2026-11-19", "heat_index_corrected_c": 41.0, "alert": {"level": 3, "key": "danger", "label": "Danger", "color": "orange"}},
    {"date": "2026-11-20", "heat_index_corrected_c": 30.0, "alert": {"level": 1, "key": "caution", "label": "Caution", "color": "green"}},
]}


def test_worst_day_and_message():
    assert telegram_bot.worst_day(FORECAST)["date"] == "2026-11-19"
    text = telegram_bot.format_message(FORECAST, {"text": "Stay safe.", "provider": "template"})
    assert "🟠 2026-11-19: Danger (heat index 41.0 °C)" in text and "Stay safe." in text


def bot_fakes(monkeypatch, forecast):
    sent = []

    def _get(url, **kwargs):
        assert url.endswith("/forecast")
        return FakeResponse(200, forecast)

    def _post(url, **kwargs):
        if "api.telegram.org" in url:
            sent.append(kwargs["json"])
            return FakeResponse(200, {"ok": True})
        assert url.endswith("/advisory")
        return FakeResponse(200, {"text": "Advisory text", "provider": "template"})

    monkeypatch.setattr(telegram_bot.requests, "get", _get)
    monkeypatch.setattr(telegram_bot.requests, "post", _post)
    return sent


def test_bot_dry_run_sends_nothing(monkeypatch, capsys):
    sent = bot_fakes(monkeypatch, FORECAST)
    assert telegram_bot.main(["--dry-run"]) == 0
    assert sent == [] and "[dry run]" in capsys.readouterr().out


def test_bot_below_threshold_sends_nothing(monkeypatch, capsys):
    sent = bot_fakes(monkeypatch, FORECAST)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "c")
    assert telegram_bot.main(["--threshold", "extreme_danger"]) == 0
    assert sent == [] and "Nothing sent" in capsys.readouterr().out


def test_bot_sends_when_above_threshold(monkeypatch):
    sent = bot_fakes(monkeypatch, FORECAST)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "c")
    assert telegram_bot.main(["--threshold", "danger"]) == 0
    assert len(sent) == 1 and sent[0]["chat_id"] == "c" and "Advisory text" in sent[0]["text"]

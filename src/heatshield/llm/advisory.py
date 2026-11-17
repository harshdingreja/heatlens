"""Short public heat advisories for Mumbai in English, Marathi and Hindi.

How it works:
1. Build a strict prompt that holds ONLY the facts we computed (date, alert
   level, heat index, most vulnerable wards) plus a few fixed safety numbers
   (work before 11:00 / after 16:00, ambulance 108).
2. Ask Groq first (fast, free tier). If that fails, ask Gemini.
3. CHECK the answer before trusting it (validate_advisory): every number in the
   text must be one we gave the model, and Marathi/Hindi must really be in
   Devanagari script. LLMs sometimes invent numbers ("40% more deaths"), and
   for a public-health message that is not acceptable.
4. If no API key works or every answer fails the check, use a hand-written
   template. The response always says which provider produced the text.

APIs (docs checked 17 Nov 2026):
- Groq:   POST https://api.groq.com/openai/v1/chat/completions (OpenAI-compatible)
          header "Authorization: Bearer <GROQ_API_KEY>", reply in choices[0].message.content
- Gemini: POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
          header "x-goog-api-key: <GEMINI_API_KEY>", reply in candidates[0].content.parts[].text
          (Google now recommends its newer Interactions API; generateContent is
          "legacy but still supported" and has a simpler, documented response shape.)
"""
from __future__ import annotations

import os
import re
import time

import requests
from dotenv import load_dotenv

from heatshield.config import PROJECT_ROOT

# Read GROQ_API_KEY / GEMINI_API_KEY from the project's .env file (gitignored).
# override=False: a key already set in the real environment (e.g. on Render) wins.
load_dotenv(PROJECT_ROOT / ".env", override=False)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Models can be swapped with env vars without touching code.
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")  # Groq production model
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")      # Gemini stable model

TIMEOUT_S = 15       # don't let a slow provider freeze the API
RETRY_WAIT_S = 2     # pause before the single retry on 429 / 5xx (tests set this to 0)

LANGUAGES = {"en": "English", "mr": "Marathi (मराठी)", "hi": "Hindi (हिन्दी)"}
ALERT_KEYS = ("green", "caution", "extreme_caution", "danger", "extreme_danger")

# Fixed safety numbers the advisory is ALLOWED to mention.
SAFE_WORK_BEFORE = 11   # 11:00
SAFE_WORK_AFTER = 16    # 16:00 (= 4 pm)
AMBULANCE = 108         # India's emergency ambulance number
# 0 appears in "11:00". We deliberately do NOT allow 4 (as in "4 pm"): a test
# showed that would also let an invented "4 litres" through. 24-hour times only.
FIXED_ALLOWED = {0, SAFE_WORK_BEFORE, SAFE_WORK_AFTER, AMBULANCE}

MAX_WORDS = 120


class ProviderError(Exception):
    """An LLM provider failed (HTTP error, blocked answer, cut-off answer, ...)."""


# ------------------------------------------------------------------ inputs ---
def build_inputs(lang, date, alert_key, alert_label, heat_index_c, top_wards, extra) -> dict:
    """Check the arguments and pack them into one dict (also returned to the caller)."""
    if lang not in LANGUAGES:
        raise ValueError(f"lang must be one of {list(LANGUAGES)}, got {lang!r}")
    if alert_key not in ALERT_KEYS:
        raise ValueError(f"alert_key must be one of {ALERT_KEYS}, got {alert_key!r}")
    return {
        "lang": lang,
        "date": str(date),
        "alert_level": alert_key,
        "alert_label": alert_label,
        "heat_index_c": None if heat_index_c is None else round(float(heat_index_c), 1),
        "top_wards": list(top_wards or [])[:5],
        "extra": dict(extra or {}),
        "safe_outdoor_work": f"before {SAFE_WORK_BEFORE}:00 and after {SAFE_WORK_AFTER}:00",
        "ambulance_number": AMBULANCE,
    }


def allowed_numbers(inputs: dict) -> tuple[set[float], list[float]]:
    """Numbers the advisory may contain.

    Returns (exact, approx):
    - exact: whole numbers that must match exactly (date parts, 11, 16, 108, ...)
    - approx: measured values like the heat index, which may be rounded
      (39.1 may be written as 39), so we allow +-0.5.
    """
    exact = set(FIXED_ALLOWED)
    exact |= {int(p) for p in re.findall(r"\d+", inputs["date"])}  # 2026, 11, 18
    for ward in inputs["top_wards"]:
        exact |= {int(p) for p in re.findall(r"\d+", str(ward))}
    approx = []
    if inputs["heat_index_c"] is not None:
        approx.append(inputs["heat_index_c"])
    for value in inputs["extra"].values():
        # bool is a subclass of int in Python, so exclude it explicitly
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            approx.append(round(float(value), 1))
    return exact, approx


# ------------------------------------------------------------------ prompt ---
def build_prompt(inputs: dict) -> tuple[str, str]:
    """(system message, user message). The user message is a plain fact sheet."""
    language = LANGUAGES[inputs["lang"]]
    system = (
        "You write short public heat-health advisories for residents of Mumbai, India.\n"
        "Strict rules:\n"
        f"1. Write ONLY in {language}. For Marathi or Hindi write natural Devanagari script, "
        "never transliteration and never English sentences (ward codes like K/E may stay as they are).\n"
        "2. Use ONLY numbers that appear in the INPUT block. Do NOT invent statistics, death counts, "
        "percentages, temperatures, phone numbers, durations or quantities. If unsure, write no number.\n"
        "3. One opening sentence with the date, the alert level, the heat index (if given) and the most "
        "vulnerable wards (if given). Then 3 to 5 short practical actions as a list where every line "
        "starts with '- '. Never number the list.\n"
        "4. Pick actions from: do heavy outdoor work before 11:00 or after 16:00; drink water often; "
        "rest in shade; check on elderly neighbours and outdoor workers; heat stroke warning signs "
        "(confusion, hot dry skin, fainting) mean call ambulance 108. For the 'green' level keep the tone calm: "
        "no alert, normal precautions.\n"
        f"5. At most {MAX_WORDS} words. No headings, no markdown bold, no emojis, nothing after the list."
    )
    hi = inputs["heat_index_c"]
    lines = [
        "INPUT",
        f"date: {inputs['date']}",
        f"alert_level: {inputs['alert_label']} ({inputs['alert_level']}, NOAA heat index bands)",
        f"heat_index_c: {hi if hi is not None else 'not available'}",
        f"most_vulnerable_wards: {', '.join(inputs['top_wards']) or 'not available'}",
        f"safe_outdoor_work_hours: {inputs['safe_outdoor_work']}",
        f"ambulance_number: {inputs['ambulance_number']}",
    ]
    lines += [f"{k}: {v}" for k, v in inputs["extra"].items()]
    lines.append(f"Write the advisory in {language} now.")
    return system, "\n".join(lines)


# --------------------------------------------------------------- validator ---
DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
LIST_MARKER_RE = re.compile(r"(?m)^\s*\d+[.)]\s+")  # "1. " or "2) " at a line start


def extract_numbers(text: str) -> list[float]:
    """All numbers in the text. Devanagari digits (३९) are converted to 39 first."""
    text = text.translate(DEVANAGARI_DIGITS)
    text = LIST_MARKER_RE.sub("- ", text)  # list numbering is formatting, not a fact
    return [float(n) for n in NUMBER_RE.findall(text)]


def devanagari_share(text: str) -> float:
    """Share of letters that are Devanagari (vs Latin). 1.0 = all Devanagari."""
    dev = sum(1 for ch in text if "ऀ" <= ch <= "ॿ" and ch.isalpha())
    lat = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return dev / (dev + lat) if dev + lat else 0.0


def validate_advisory(text: str, inputs: dict) -> list[str]:
    """Return a list of problems. Empty list = the advisory is safe to show."""
    problems = []
    if not text or not text.strip():
        return ["empty text"]

    exact, approx = allowed_numbers(inputs)
    for n in extract_numbers(text):
        ok = n in exact or any(abs(n - a) <= 0.5 for a in approx)
        if not ok:
            problems.append(f"number not in inputs: {n:g}")

    share = devanagari_share(text)
    if inputs["lang"] in ("mr", "hi") and share < 0.6:
        problems.append(f"not mainly Devanagari script (share {share:.2f})")
    if inputs["lang"] == "en" and share > 0:
        problems.append(f"English text contains Devanagari (share {share:.2f})")

    if len(text.split()) > MAX_WORDS * 1.5:  # small margin: word counts differ by script
        problems.append(f"too long ({len(text.split())} words)")
    return problems


# --------------------------------------------------------------- providers ---
def post_json(url: str, headers: dict, body: dict) -> dict:
    """POST and return JSON. Retries once on rate limit (429), server error (5xx) or network error."""
    for attempt in range(2):
        try:
            response = requests.post(url, headers=headers, json=body, timeout=TIMEOUT_S)
        except (requests.Timeout, requests.ConnectionError) as err:
            if attempt == 0:
                time.sleep(RETRY_WAIT_S)
                continue
            raise ProviderError(f"network error: {err}") from err
        if response.status_code == 200:
            return response.json()
        if (response.status_code == 429 or response.status_code >= 500) and attempt == 0:
            time.sleep(RETRY_WAIT_S)
            continue
        raise ProviderError(f"HTTP {response.status_code}: {response.text[:200]}")
    raise ProviderError("no response")


def call_groq(system: str, user: str, api_key: str, model: str) -> str:
    data = post_json(
        GROQ_URL,
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.3,             # low = stick to the facts
            "max_completion_tokens": 1024,  # Devanagari needs more tokens per word
        },
    )
    choice = data["choices"][0]
    if choice.get("finish_reason") == "length":
        raise ProviderError("answer was cut off (max tokens)")
    return (choice["message"]["content"] or "").strip()


def call_gemini(system: str, user: str, api_key: str, model: str) -> str:
    data = post_json(
        GEMINI_URL.format(model=model),
        {"x-goog-api-key": api_key, "Content-Type": "application/json"},
        {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            # No temperature: Gemini 3.6+ silently ignores it. Generous token limit
            # because "thinking" tokens also count towards it.
            "generationConfig": {"maxOutputTokens": 4096},
        },
    )
    candidates = data.get("candidates") or []
    if not candidates:  # prompt blocked by safety filters
        raise ProviderError(f"no answer, promptFeedback={data.get('promptFeedback')}")
    reason = candidates[0].get("finishReason")
    if reason not in (None, "STOP"):
        raise ProviderError(f"finishReason={reason}")
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()


# (name, env var with the key, model, function). Order = priority.
PROVIDERS = [
    ("groq", "GROQ_API_KEY", lambda: GROQ_MODEL, call_groq),
    ("gemini", "GEMINI_API_KEY", lambda: GEMINI_MODEL, call_gemini),
]


# --------------------------------------------------------------- templates ---
LEVEL_NAMES = {
    "en": {"green": "No heat alert", "caution": "Caution", "extreme_caution": "Extreme Caution",
           "danger": "Danger", "extreme_danger": "Extreme Danger"},
    "mr": {"green": "उष्णतेचा इशारा नाही", "caution": "सावधगिरी", "extreme_caution": "अति सावधगिरी",
           "danger": "धोका", "extreme_danger": "अति धोका"},
    "hi": {"green": "गर्मी की कोई चेतावनी नहीं", "caution": "सावधानी", "extreme_caution": "अत्यधिक सावधानी",
           "danger": "खतरा", "extreme_danger": "अत्यधिक खतरा"},
}

HEADER = {
    "en": "HeatShield advisory for Mumbai, {date}: {level}.",
    "mr": "मुंबईसाठी हीटशील्ड सूचना, {date}: {level}.",
    "hi": "मुंबई के लिए हीटशील्ड सलाह, {date}: {level}।",
}
HEAT_INDEX_LINE = {
    "en": " Feels-like temperature (heat index) up to {hi} °C.",
    "mr": " जाणवणारे तापमान (हीट इंडेक्स) {hi} °C पर्यंत.",
    "hi": " महसूस होने वाला तापमान (हीट इंडेक्स) {hi} °C तक।",
}
WARDS_LINE = {
    "en": " Most vulnerable wards: {wards}.",
    "mr": " सर्वाधिक असुरक्षित वॉर्ड: {wards}.",
    "hi": " सबसे संवेदनशील वार्ड: {wards}।",
}

# Actions per alert level. Only allowed numbers appear (11:00, 16:00, 108).
ACTIONS = {
    "en": {
        "green": [
            "No heat alert today. Normal precautions are enough.",
            "Keep drinking water through the day.",
            "Keep an eye on elderly family members and young children.",
        ],
        "caution": [
            "Drink water regularly, even if you are not thirsty.",
            "Take short breaks in the shade during outdoor work.",
            "Wear light, loose, light-coloured cotton clothes.",
            "Check on elderly neighbours.",
        ],
        "extreme_caution": [
            "Do heavy outdoor work before 11:00 or after 16:00.",
            "Drink water often; carry a bottle and take ORS or lemon-salt water.",
            "Avoid direct afternoon sun and rest in the shade.",
            "Check on elderly neighbours, outdoor workers and people living alone.",
            "Heat stroke signs: confusion, hot dry skin, fainting. Call 108 immediately.",
        ],
        "danger": [
            "Avoid outdoor work between 11:00 and 16:00; stop at once if you feel dizzy.",
            "Drink water and ORS often; avoid alcohol, tea and very sugary drinks in the heat.",
            "Stay in shade or indoors, keep rooms ventilated and cool down with a wet cloth.",
            "Visit elderly neighbours, outdoor workers and people living alone today.",
            "Heat stroke signs: confusion, hot dry skin, fainting. Call 108 and cool the person with water.",
        ],
        "extreme_danger": [
            "Stay indoors or in shade between 11:00 and 16:00; postpone all non-essential outdoor work.",
            "Drink water and ORS regularly, even without thirst.",
            "Never leave children, elderly people or pets in closed vehicles or unventilated rooms.",
            "Check on elderly neighbours, outdoor workers and people living alone, more than once today.",
            "Heat stroke is a medical emergency: confusion, hot dry skin or fainting means call 108 now.",
        ],
    },
    "mr": {
        "green": [
            "आज उष्णतेचा कोणताही इशारा नाही. नेहमीची काळजी घ्या.",
            "दिवसभर नियमित पाणी प्या.",
            "घरातील वृद्ध आणि लहान मुलांकडे लक्ष ठेवा.",
        ],
        "caution": [
            "तहान लागली नसली तरी नियमित पाणी प्या.",
            "बाहेर काम करताना मधूनमधून सावलीत विश्रांती घ्या.",
            "हलके, सैल, फिकट रंगाचे सुती कपडे घाला.",
            "शेजारच्या वृद्ध व्यक्तींची चौकशी करा.",
        ],
        "extreme_caution": [
            "जड बाहेरची कामे 11:00 पूर्वी किंवा 16:00 नंतर करा.",
            "वारंवार पाणी प्या; सोबत पाण्याची बाटली ठेवा, ओआरएस किंवा लिंबू-मीठ-पाणी घ्या.",
            "दुपारी थेट उन्हात जाणे टाळा आणि सावलीत विश्रांती घ्या.",
            "वृद्ध शेजारी, बाहेर काम करणारे कामगार आणि एकटे राहणारे लोक यांची चौकशी करा.",
            "उष्माघाताची लक्षणे: गोंधळ, गरम कोरडी त्वचा, बेशुद्ध पडणे. लगेच 108 वर कॉल करा.",
        ],
        "danger": [
            "11:00 ते 16:00 या वेळेत बाहेरचे काम टाळा; चक्कर आल्यास लगेच काम थांबवा.",
            "वारंवार पाणी आणि ओआरएस घ्या; उन्हात मद्य, चहा आणि जास्त साखरेची पेये टाळा.",
            "सावलीत किंवा घरात राहा, घर हवेशीर ठेवा आणि ओल्या कापडाने अंग थंड करा.",
            "आज वृद्ध शेजारी, बाहेर काम करणारे कामगार आणि एकटे राहणारे लोक यांना नक्की भेटा.",
            "उष्माघाताची लक्षणे: गोंधळ, गरम कोरडी त्वचा, बेशुद्ध पडणे. लगेच 108 वर कॉल करा आणि व्यक्तीला पाण्याने थंड करा.",
        ],
        "extreme_danger": [
            "11:00 ते 16:00 या वेळेत घरात किंवा सावलीत राहा; अत्यावश्यक नसलेली सर्व बाहेरची कामे पुढे ढकला.",
            "तहान नसली तरी नियमित पाणी आणि ओआरएस घ्या.",
            "मुले, वृद्ध किंवा पाळीव प्राणी यांना बंद वाहनात किंवा हवा नसलेल्या खोलीत कधीही ठेवू नका.",
            "आज वृद्ध शेजारी, बाहेर काम करणारे कामगार आणि एकटे राहणारे लोक यांची वारंवार चौकशी करा.",
            "उष्माघात ही वैद्यकीय आणीबाणी आहे: गोंधळ, गरम कोरडी त्वचा किंवा बेशुद्धी दिसल्यास लगेच 108 वर कॉल करा.",
        ],
    },
    "hi": {
        "green": [
            "आज गर्मी की कोई चेतावनी नहीं है। सामान्य सावधानी काफ़ी है।",
            "दिन भर नियमित रूप से पानी पीते रहें।",
            "घर के बुज़ुर्गों और छोटे बच्चों का ध्यान रखें।",
        ],
        "caution": [
            "प्यास न लगे तब भी नियमित रूप से पानी पिएँ।",
            "बाहर काम करते समय बीच-बीच में छाँव में आराम करें।",
            "हल्के, ढीले, हल्के रंग के सूती कपड़े पहनें।",
            "पड़ोस के बुज़ुर्गों का हालचाल पूछें।",
        ],
        "extreme_caution": [
            "भारी बाहरी काम 11:00 से पहले या 16:00 के बाद करें।",
            "बार-बार पानी पिएँ; पानी की बोतल साथ रखें, ओआरएस या नींबू-नमक-पानी लें।",
            "दोपहर की सीधी धूप से बचें और छाँव में आराम करें।",
            "बुज़ुर्ग पड़ोसियों, बाहर काम करने वाले मज़दूरों और अकेले रहने वाले लोगों का हालचाल लें।",
            "लू लगने के लक्षण: भ्रम, गर्म सूखी त्वचा, बेहोशी। तुरंत 108 पर कॉल करें।",
        ],
        "danger": [
            "11:00 से 16:00 के बीच बाहर का काम न करें; चक्कर आए तो तुरंत काम रोक दें।",
            "बार-बार पानी और ओआरएस लें; धूप में शराब, चाय और ज़्यादा मीठे पेय से बचें।",
            "छाँव में या घर के अंदर रहें, घर हवादार रखें और गीले कपड़े से शरीर ठंडा करें।",
            "आज बुज़ुर्ग पड़ोसियों, बाहर काम करने वाले मज़दूरों और अकेले रहने वाले लोगों से ज़रूर मिलें।",
            "लू लगने के लक्षण: भ्रम, गर्म सूखी त्वचा, बेहोशी। तुरंत 108 पर कॉल करें और व्यक्ति को पानी से ठंडा करें।",
        ],
        "extreme_danger": [
            "11:00 से 16:00 के बीच घर के अंदर या छाँव में रहें; गैर-ज़रूरी बाहरी काम टाल दें।",
            "प्यास न हो तब भी नियमित रूप से पानी और ओआरएस लें।",
            "बच्चों, बुज़ुर्गों या पालतू जानवरों को बंद गाड़ी या बिना हवा वाले कमरे में कभी न छोड़ें।",
            "आज बुज़ुर्ग पड़ोसियों, बाहर काम करने वाले मज़दूरों और अकेले रहने वाले लोगों का बार-बार हालचाल लें।",
            "लू (हीट स्ट्रोक) एक मेडिकल इमरजेंसी है: भ्रम, गर्म सूखी त्वचा या बेहोशी दिखे तो तुरंत 108 पर कॉल करें।",
        ],
    },
}


def render_template(inputs: dict) -> str:
    """Hand-written advisory, used when no LLM is available or every LLM answer failed validation."""
    lang, key = inputs["lang"], inputs["alert_level"]
    text = HEADER[lang].format(date=inputs["date"], level=LEVEL_NAMES[lang][key])
    if inputs["heat_index_c"] is not None:
        text += HEAT_INDEX_LINE[lang].format(hi=f"{inputs['heat_index_c']:.1f}")
    if inputs["top_wards"]:
        text += WARDS_LINE[lang].format(wards=", ".join(inputs["top_wards"]))
    bullets = "\n".join(f"- {line}" for line in ACTIONS[lang][key])
    return f"{text}\n{bullets}"


# -------------------------------------------------------------------- main ---
def generate_advisory(
    lang: str,
    date: str,
    alert_key: str,
    alert_label: str,
    heat_index_c: float | None,
    top_wards: list[str],
    extra: dict | None = None,
) -> dict:
    """Return {lang, text, provider, model, inputs_used, debug}.

    provider is "groq", "gemini" or "template". debug["attempts"] records
    why each provider before the winning one was skipped or rejected.
    """
    inputs = build_inputs(lang, date, alert_key, alert_label, heat_index_c, top_wards, extra)
    system, user = build_prompt(inputs)
    attempts = []

    for name, key_env, model_fn, call in PROVIDERS:
        api_key = os.getenv(key_env, "").strip()
        if not api_key:
            attempts.append({"provider": name, "status": "skipped (no API key)"})
            continue
        model = model_fn()
        try:
            text = call(system, user, api_key, model)
        except (ProviderError, requests.RequestException, KeyError, IndexError, ValueError) as err:
            attempts.append({"provider": name, "model": model, "status": f"error: {str(err)[:200]}"})
            continue
        problems = validate_advisory(text, inputs)
        if problems:
            attempts.append({"provider": name, "model": model, "status": "rejected by validator",
                             "problems": problems})
            continue
        return {"lang": lang, "text": text, "provider": name, "model": model,
                "inputs_used": inputs, "debug": {"attempts": attempts}}

    return {"lang": lang, "text": render_template(inputs), "provider": "template",
            "model": "built-in template", "inputs_used": inputs, "debug": {"attempts": attempts}}


if __name__ == "__main__":
    # Quick manual check:  python -m heatshield.llm.advisory
    for code in LANGUAGES:
        result = generate_advisory(code, "2026-11-18", "extreme_caution", "Extreme Caution", 39.1, ["K/E", "L", "M/E"])
        print(f"--- {code} via {result['provider']} ({result['model']})\n{result['text']}\n{result['debug']}\n")

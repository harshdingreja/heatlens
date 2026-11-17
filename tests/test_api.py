"""Endpoint tests. The live weather pipeline is replaced by a fixed fake bundle,
so these tests are fast and never touch the internet."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import api.main as main
from heatshield.models.alerts import imd_alert, noaa_alert


def fake_bundle(days=5):
    out = []
    for i, hi in enumerate([33.0, 36.0, 40.0, 41.0, 38.0][:days], start=1):
        out.append({"date": f"2026-11-{18 + i}", "lead_days": i, "tmax_c": 33.0, "rh_at_tmax_pct": 60.0,
                    "wind_kmh": 10.0, "shortwave_max_wm2": 700.0, "tmean_c": 29.0,
                    "heat_index_raw_c": hi - 2, "heat_index_corrected_c": hi, "wbgt_c": 29.0,
                    "alert": noaa_alert(hi), "imd_alert": imd_alert(hi), "normal_heat_index_c": 35.0,
                    "anomaly_z": 0.5, "is_anomaly": False, "isolation_forest_anomaly": False})
    return {"issued": "2026-11-18", "location": {"name": "Mumbai", "lat": 19.1, "lon": 72.8},
            "forecast_model": "icon_global", "corrector": "linear_plus_lightgbm",
            "obs_latest_date": "2026-11-14", "alert_scheme": "NOAA", "days": out,
            "_recent_obs": pd.DataFrame({"date": pd.to_datetime(["2026-11-13", "2026-11-14"]),
                                         "tmean": [28.0, 28.5], "tmax": [33.0, 33.5], "hi_max": [36.0, 37.0]})}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.service, "build_forecast", lambda days=5: fake_bundle(days))
    return TestClient(main.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_forecast_shape(client):
    r = client.get("/forecast?days=3")
    assert r.status_code == 200
    body = r.json()
    assert len(body["days"]) == 3 and "_recent_obs" not in body
    assert body["days"][0]["alert"]["color"] in {"green", "yellow", "orange", "red"}


def test_forecast_rejects_bad_days(client):
    assert client.get("/forecast?days=9").status_code == 422


def test_wards(client):
    r = client.get("/wards")
    if not main.WARDS_FILE.exists():
        assert r.status_code == 503
        return
    geo = r.json()
    assert geo["type"] == "FeatureCollection" and len(geo["features"]) >= 24
    props = geo["features"][0]["properties"]
    assert {"ward_id", "hvi", "cluster", "risk_today", "risk_level"} <= set(props)


def test_risk(client):
    r = client.get("/risk")
    if main.risk_module() is None:
        assert r.status_code == 503
        return
    body = r.json()
    assert r.status_code == 200 and "not a clinical prediction" in body["disclaimer"].lower()
    assert len(body["days"]) == 5


@pytest.mark.parametrize("lang", ["en", "mr", "hi"])
def test_advisory_all_languages_without_keys(client, monkeypatch, lang):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    import heatshield.llm.advisory as adv
    monkeypatch.setattr(adv, "load_dotenv", lambda *a, **k: None, raising=False)
    r = client.post("/advisory", json={"lang": lang})
    assert r.status_code == 200
    body = r.json()
    assert body["lang"] == lang and body["text"]


def test_advisory_rejects_unknown_language(client):
    assert client.post("/advisory", json={"lang": "fr"}).status_code == 422

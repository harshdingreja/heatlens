"""Layer 2 tests: the saved results file has what the API and README need."""
import json

import pytest

from heatshield.models.state_health import RESULTS_PATH


@pytest.mark.skipif(not RESULTS_PATH.exists(), reason="run `python -m heatshield.models.state_health` first")
def test_results_file_has_expected_keys():
    res = json.loads(RESULTS_PATH.read_text())
    assert isinstance(res["summary"], str) and len(res["summary"]) > 50
    for name in ("poisson_danger_year", "negbin_danger_year"):
        rr = res["models"][name]["rate_ratio_per_10_days"]
        assert rr["ci"][0] <= rr["irr"] <= rr["ci"][1]
    assert res["models"]["poisson_danger_year"]["pearson_dispersion"] > 0
    assert res["data"]["n_rows"] >= 150

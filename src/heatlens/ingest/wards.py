"""Mumbai's 24 BMC wards: boundaries, Census 2011 indicators, MCAP benchmark.

Sources (all real, all downloaded by this file):
1. Ward boundaries: DataMeet "Municipal_Spatial_Data" (CC BY-SA 2.5 IN), 24 wards.
   BMC has since split P/North (P/East + P/West, 2023) and K/East (K/North +
   K/South, 2024). All official ward statistics (Census 2011, MCAP 2022) use
   the older 24-ward layout, so we keep 24. That's the only layout with data.
2. Ward population + slum population: BMC Public Health Dept "Census FAQ"
   (official ward-wise Census 2011 table for all 24 admin wards).
3. Workers: Census of India 2011 Primary Census Abstract (PCA), ward level,
   for Mumbai (DDW_PCA2723) and Mumbai Suburban (DDW_PCA2722). The census
   uses 97 small "census wards" coded like 0101, 0206 ... 2403. The first two
   digits are the BMC admin ward. We PROVE the mapping instead of assuming
   it: each prefix's population total must match exactly one BMC ward total.
4. MCAP benchmark: BMC's Mumbai Climate Action Plan (2022) "Climate & Air
   Pollution Risks and Vulnerability Assessment" report. Its Figure 8 (p. 21)
   plots every ward's mean October land-surface temperature (LST) and orders
   wards by % metal/asbestos roofing. We extract both from the PDF.

Run from the project root:   python -m heatlens.ingest.wards
"""
from __future__ import annotations

import json
import re

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

from heatlens.config import DATA_RAW

WARDS_DIR = DATA_RAW / "wards"
BOUNDARY_URL = "https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Mumbai/BMC_Wards.geojson"
BMC_CENSUS_FAQ_URL = ("https://portal.mcgm.gov.in/irj/go/km/docs/documents/MCGM%20Department%20List/"
                      "Public%20Health%20Department/Docs/Census%20FAQ%20%26%20Answer.pdf")
PCA_URLS = {  # Census of India NADA catalogue 6710 (Mumbai) and 6709 (Mumbai Suburban)
    "DDW_PCA2723_2011_mumbai_city.xlsx": "https://censusindia.gov.in/nada/index.php/catalog/6710/download/9787",
    "DDW_PCA2722_2011_mumbai_suburban.xlsx": "https://censusindia.gov.in/nada/index.php/catalog/6709/download/9786",
}
MCAP_URL = ("https://r3app.mcgm.gov.in/irj/go/km/docs/documents/Environment/Climate/"
            "VULNERABILITY%20ASSESSMENT%20REPORT%20-%20MCAP.pdf")

# Utility-friendly local names (labels only, not used in any calculation).
WARD_NAMES = {
    "A": "A (Colaba, Fort)", "B": "B (Dongri, Sandhurst Rd)", "C": "C (Kalbadevi, Bhuleshwar)",
    "D": "D (Grant Rd, Malabar Hill)", "E": "E (Byculla)", "F/S": "F South (Parel)",
    "F/N": "F North (Matunga, Sion, Wadala)", "G/S": "G South (Worli)", "G/N": "G North (Dadar, Dharavi)",
    "H/E": "H East (Bandra E, Santacruz E)", "H/W": "H West (Bandra W, Khar W)",
    "K/E": "K East (Andheri E, Jogeshwari E)", "K/W": "K West (Andheri W, Vile Parle W)",
    "P/S": "P South (Goregaon)", "P/N": "P North (Malad)", "R/S": "R South (Kandivali)",
    "R/C": "R Central (Borivali)", "R/N": "R North (Dahisar)", "L": "L (Kurla)",
    "M/E": "M East (Govandi, Mankhurd)", "M/W": "M West (Chembur)", "N": "N (Ghatkopar, Vikhroli)",
    "S": "S (Bhandup, Powai)", "T": "T (Mulund)",
}
UTM_43N = "EPSG:32643"  # metre-based projection for Mumbai: needed to measure areas in km²


def download(url: str, filename: str) -> None:
    """Download once into data/raw/wards/ (skip if we already have it)."""
    path = WARDS_DIR / filename
    if path.exists():
        return
    WARDS_DIR.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=300)
    r.raise_for_status()
    path.write_bytes(r.content)


def download_all() -> None:
    download(BOUNDARY_URL, "BMC_Wards.geojson")
    download(BMC_CENSUS_FAQ_URL, "bmc_census_faq.pdf")
    download(MCAP_URL, "mcap_va_report.pdf")
    for name, url in PCA_URLS.items():
        download(url, name)


# ------------------------------------------------------------- boundaries ---
def load_ward_boundaries() -> gpd.GeoDataFrame:
    """24 ward polygons with ward_id, ward_name and area in km²."""
    gdf = gpd.read_file(WARDS_DIR / "BMC_Wards.geojson")[["name", "geometry"]]
    gdf = gdf.rename(columns={"name": "ward_id"}).to_crs("EPSG:4326")
    gdf["ward_name"] = gdf["ward_id"].map(WARD_NAMES)
    # Areas must be measured in metres, not degrees, so project to UTM first.
    gdf["area_km2"] = gdf.to_crs(UTM_43N).area / 1e6
    assert len(gdf) == 24 and gdf["ward_name"].notna().all(), "expected the 24 known BMC wards"
    return gdf


# ----------------------------------------------------------------- census ---
def bmc_slum_table() -> pd.DataFrame:
    """Parse the official ward-wise total / slum population table (BMC Census FAQ, Q3)."""
    import pymupdf  # PDF reader

    doc = pymupdf.open(WARDS_DIR / "bmc_census_faq.pdf")
    text = " ".join(page.get_text() for page in doc)
    q3 = text[text.index("Ward wise Slum"): text.index("Q4.")]       # just the Q3 answer
    tokens = q3.split()
    rows = []
    for i, tok in enumerate(tokens[:-3]):
        ward = "H/W" if tok == "HW" else tok                           # the PDF misprints H/W as "HW"
        if ward in WARD_NAMES and all(t.isdigit() for t in tokens[i + 1: i + 4]):
            total, slum, non_slum = map(int, tokens[i + 1: i + 4])
            assert total == slum + non_slum, f"row {ward} doesn't add up"
            rows.append({"ward_id": ward, "population": total, "slum_population": slum})
    df = pd.DataFrame(rows)
    assert len(df) == 24 and df["population"].sum() == 12_442_373, "BMC table parse failed"
    return df


def census_workers() -> pd.DataFrame:
    """Total workers (main + marginal) per admin ward from the official ward-level PCA."""
    pca = pd.concat(pd.read_excel(WARDS_DIR / f) for f in PCA_URLS)
    pca = pca[pca["Level"] == "WARD"].copy()
    pca["prefix"] = pca["Name"].str.extract(r"WARD NO\.-(\d{2})\d{2}")[0]
    by_prefix = pca.groupby("prefix")[["TOT_P", "TOT_WORK_P", "MAINWORK_P", "MARGWORK_P"]].sum()

    # Prove the prefix -> admin ward mapping using exact population totals.
    bmc = bmc_slum_table().set_index("population")["ward_id"]
    by_prefix["ward_id"] = by_prefix["TOT_P"].map(bmc)
    assert by_prefix["ward_id"].notna().all() and by_prefix["ward_id"].is_unique, "prefix mapping not 1:1"
    assert (by_prefix["TOT_WORK_P"] == by_prefix["MAINWORK_P"] + by_prefix["MARGWORK_P"]).all()
    return by_prefix.rename(columns={"TOT_WORK_P": "workers"})[["ward_id", "workers"]].reset_index()


def census_indicators() -> pd.DataFrame:
    """population, slum_share, worker_share per ward (Census 2011)."""
    df = bmc_slum_table().merge(census_workers(), on="ward_id")
    df["slum_share"] = df["slum_population"] / df["population"]
    # Worker share = people who worked (main + marginal) / all people. We use it as a
    # rough proxy for daytime exposure: more working people means more people commuting
    # and working outdoors in the heat. (Census has no "outdoor worker" split by ward.)
    df["worker_share"] = df["workers"] / df["population"]
    return df[["ward_id", "population", "slum_population", "slum_share", "workers", "worker_share", "prefix"]]


# ---------------------------------------------------------- MCAP benchmark ---
def mcap_figure8() -> pd.DataFrame:
    """Digitise MCAP Figure 8 (report page 21): mean October LST and roofing order per ward.

    The chart is a small embedded JPEG (534 x 131 px). In it:
      - 24 bars, one per ward, ordered by % metal/asbestos roofing (highest first);
        the ward labels are real text on the PDF page, so we read the order exactly.
      - a dark-red line = ward mean LST on the right axis (25-35 °C). The bar tops
        are 100 % = 35 °C and bar bottoms are 0 % = 25 °C, so a pixel row converts to °C.
    We find the red line's row at each bar's centre column. Checked against the
    report's own Figure 33 map bins: 23 of 24 wards fall in the right bin
    (T reads 28.7 °C vs bin "29-31").
    """
    import pymupdf
    from PIL import Image
    import io

    doc = pymupdf.open(WARDS_DIR / "mcap_va_report.pdf")
    page = doc[20]  # page 21 (0-based index)

    # 1) Ward order: x-axis label words sitting just under the chart.
    labels = sorted((w for w in page.get_text("words") if 735 < w[1] < 736), key=lambda w: w[0])
    order = [w[4] for w in labels]
    assert sorted(order) == sorted(WARD_NAMES), f"unexpected labels {order}"

    # 2) The chart image = the image placed in the Figure 8 area (y ≈ 639-737 pt).
    xref = next(x[0] for x in page.get_images(full=True) if page.get_image_rects(x[0])[0].y0 > 600)
    img = np.asarray(Image.open(io.BytesIO(doc.extract_image(xref)["image"])).convert("RGB")).astype(float)
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    yellow = (R > 200) & (G > 140) & (B < 100)       # metal/asbestos bar segment
    blue = (B > 150) & (R < 120)                      # "other materials" segment at bar tops
    redness = np.where(~yellow, R - G, 0)             # the LST line is the only strongly red thing

    cols = np.nonzero(yellow.sum(axis=0) >= 2)[0]     # columns that belong to a bar
    bars, start = [], cols[0]
    for prev, c in zip(cols[:-1], cols[1:]):          # split columns into 24 separate bars
        if c != prev + 1:
            bars.append((start, prev))
            start = c
    bars.append((start, cols[-1]))
    assert len(bars) == 24, f"found {len(bars)} bars"

    y_top = np.nonzero(blue.any(axis=1))[0].min()     # row of 100 % (= 35 °C)
    y_bottom = np.nonzero(yellow.any(axis=1))[0].max()  # row of 0 % (= 25 °C)
    rows = []
    for rank, (ward, (c0, c1)) in enumerate(zip(order, bars), start=1):
        centre = [int(np.floor((c0 + c1) / 2)), int(np.ceil((c0 + c1) / 2))]
        profile = redness[:, centre].max(axis=1)
        profile[:y_top] = 0
        profile[y_bottom + 1:] = 0
        peak = int(profile.argmax())
        window = np.arange(max(peak - 2, 0), peak + 3)
        weights = profile[window].clip(min=0)
        y = (window * weights).sum() / weights.sum()  # sub-pixel line position
        lst = 25 + 10 * (y_bottom - y) / (y_bottom - y_top)
        rows.append({"ward_id": ward, "mcap_lst_oct_c": round(float(lst), 2), "mcap_roofing_rank": rank})
    return pd.DataFrame(rows)


# Figure 33 (report p. 76) colours each ward by mean LST class. Read by eye from the
# map legend; used ONLY to check the digitised Figure 8 values above.
MCAP_FIG33_BINS = {
    "33-34": ["L", "E", "C", "B"],
    "32-33": ["K/E", "H/E", "G/N", "F/S"],
    "31-32": ["R/S", "K/W", "H/W", "G/S", "D", "A", "F/N", "M/W", "M/E"],
    "29-31": ["R/N", "R/C", "P/N", "P/S", "T", "S", "N"],
}
# Table 24 (p. 66): % of ward population exposed to mean surface temperature >= 35 °C.
MCAP_TABLE24_HEAT = {"most_vulnerable": ("M/E", 40.08), "least_vulnerable": ("A", 0.92), "bmc_average_pct": 14.46}


if __name__ == "__main__":
    download_all()
    wards = load_ward_boundaries()
    print(wards[["ward_id", "ward_name", "area_km2"]].to_string(index=False))
    census = census_indicators()
    print(census.to_string(index=False))
    fig8 = mcap_figure8()
    print(fig8.to_string(index=False))
    fig8.to_csv(WARDS_DIR / "mcap_figure8_digitised.csv", index=False)
    print(json.dumps(MCAP_FIG33_BINS))

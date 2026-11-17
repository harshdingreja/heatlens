"""Health data for Layers 1 and 2. Everything is downloaded or transcribed from
an official source, and each file records where it came from.

Layer 1 (Mumbai death-risk estimate) needs:
  - the paper: de Bont et al. 2024, Environment International 184:108461
    (open access via Europe PMC: full text + supplementary Table S1)
  - Mumbai's baseline daily deaths (MCGM "key statistics", deaths in 2023)

Layer 2 (state-level Poisson model) needs:
  - state-year heat/sun-stroke deaths (NCRB, Accidental Deaths & Suicides in India)
  - state populations (Census 2011)
  - state-year counts of hot, humid days (ERA5 at each state/UT capital)

Why not the data.gov.in CSVs named in the spec? On 17 Nov 2026 every
data.gov.in file returned HTTP 403 unless you fill a download form (with a
captcha) or use a personal API key, and the shared sample key was rate-limited.
So we use the same tables from the documents data.gov.in itself cites (PIB
Parliament answers). We checked: the first 10 rows shown in data.gov.in's
preview match these documents exactly.

Run from the project root:   python -m heatshield.ingest.health
"""
from __future__ import annotations

import io
import re
import time
import zipfile

import numpy as np
import pandas as pd
import requests
from pypdf import PdfReader

from heatshield.config import DATA_RAW, TIMEZONE
from heatshield.features.heat_indices import heat_index_c
from heatshield.ingest.weather import ARCHIVE_URL, get_json

HEALTH_DIR = DATA_RAW / "health"

# ---- Sources ---------------------------------------------------------------
PAPER_PMCID = "PMC11790314"  # de Bont et al. 2024, doi:10.1016/j.envint.2024.108461
PAPER_SUPP_URL = f"https://www.ebi.ac.uk/europepmc/webservices/rest/{PAPER_PMCID}/supplementaryFiles"
PAPER_TEXT_URL = f"https://www.ebi.ac.uk/europepmc/webservices/rest/{PAPER_PMCID}/fullTextXML"

NCRB_SOURCES = {
    # Lok Sabha written reply, MoES, PIB Release ID 2158403 (20 Aug 2025): table for 2018-2022
    "2018-2022": "https://www.moes.gov.in/static/uploads/2025/08/0e2522b2318ad6307cfb52656e346820.pdf",
    # PIB-hosted Parliament annexure (26 Jul 2023): table for 2017-2021
    "2017-2021": "https://static.pib.gov.in/WriteReadData/specificdocs/documents/2023/jul/doc2023726228401.pdf",
}
POPULATION_WIKITEXT_URL = (
    "https://en.wikipedia.org/w/index.php?"
    "title=List_of_states_and_union_territories_of_India_by_population&action=raw"
)
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"

# State/UT -> (capital to geocode, the 'admin1' name the geocoder uses). Where a
# state has two capitals we take the one where most people live in summer.
CAPITALS = {
    "Andhra Pradesh": ("Amaravati", "Andhra Pradesh"),
    "Arunachal Pradesh": ("Itanagar", "Arunachal Pradesh"),
    "Assam": ("Dispur", "Assam"),
    "Bihar": ("Patna", "Bihar"),
    "Chhattisgarh": ("Raipur", "Chhattisgarh"),
    "Goa": ("Panjim", "Goa"),
    "Gujarat": ("Gandhinagar", "Gujarat"),
    "Haryana": ("Chandigarh", "Chandigarh"),          # shared capital
    "Himachal Pradesh": ("Shimla", "Himachal Pradesh"),
    "Jharkhand": ("Ranchi", "Jharkhand"),
    "Karnataka": ("Bengaluru", "Karnataka"),
    "Kerala": ("Thiruvananthapuram", "Kerala"),
    "Madhya Pradesh": ("Bhopal", "Madhya Pradesh"),
    "Maharashtra": ("Mumbai", "Maharashtra"),
    "Manipur": ("Imphal", "Manipur"),
    "Meghalaya": ("Shillong", "Meghalaya"),
    "Mizoram": ("Aizawl", "Mizoram"),
    "Nagaland": ("Kohima", "Nagaland"),
    "Odisha": ("Bhubaneswar", "Odisha"),
    "Punjab": ("Chandigarh", "Chandigarh"),           # shared capital
    "Rajasthan": ("Jaipur", "Rajasthan"),
    "Sikkim": ("Gangtok", "Sikkim"),
    "Tamil Nadu": ("Chennai", "Tamil Nadu"),
    "Telangana": ("Hyderabad", "Telangana"),
    "Tripura": ("Agartala", "Tripura"),
    "Uttar Pradesh": ("Lucknow", "Uttar Pradesh"),
    "Uttarakhand": ("Dehradun", "Uttarakhand"),
    "West Bengal": ("Kolkata", "West Bengal"),
    "A & N Islands": ("Port Blair", "Andaman and Nicobar"),
    "Chandigarh": ("Chandigarh", "Chandigarh"),
    "D&N Haveli and Daman&Diu": ("Daman", "Dadra and Nagar Haveli and Daman and Diu"),
    "Delhi UT": ("New Delhi", "National Capital Territory of Delhi"),
    "Jammu & Kashmir": ("Srinagar", "Jammu and Kashmir"),  # summer capital
    "Ladakh": ("Leh", "Ladakh"),
    "Lakshadweep": ("Kavaratti", "Lakshadweep"),
    "Puducherry": ("Puducherry", "Puducherry"),
}
# NCRB table names -> names used in the population table (Wikipedia/Census)
POPULATION_NAME_MAP = {
    "A & N Islands": "Andaman and Nicobar Islands",
    "D&N Haveli and Daman&Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi UT": "Delhi",
    "Jammu & Kashmir": "Jammu and Kashmir (union territory)",  # Census 2011 figure excluding Ladakh
    "Puducherry": "Puducherry (union territory)",
    "Punjab": "Punjab, India",
}


# ---------------------------------------------------------------- the paper ---
def download_paper_tables() -> pd.DataFrame:
    """Table S1 of the paper: % increase in daily deaths (95% CI) per city and per
    heatwave definition (95th/97th/99th percentile x 1/2/3/5 consecutive days)."""
    HEALTH_DIR.mkdir(parents=True, exist_ok=True)
    (HEALTH_DIR / "paper_fulltext.xml").write_bytes(requests.get(PAPER_TEXT_URL, timeout=120).content)

    supp_zip = zipfile.ZipFile(io.BytesIO(requests.get(PAPER_SUPP_URL, timeout=300).content))
    docx_name = next(n for n in supp_zip.namelist() if n.endswith(".docx"))
    docx = zipfile.ZipFile(io.BytesIO(supp_zip.read(docx_name)))
    xml = docx.read("word/document.xml").decode("utf8")
    # Turn Word's XML table into plain text: cells separated by "|", rows by newlines.
    text = re.sub(r"<[^>]+>", "", xml.replace("</w:tc>", " | ").replace("</w:tr>", "\n"))
    (HEALTH_DIR / "paper_supplement.txt").write_text(text)

    s1 = text[text.find("Table S1: Percent increase", text.find("Table S1") + 10):text.find("Table S2. Effect")]
    rows, percentile = [], None
    for line in s1.split("\n"):
        if m := re.search(r"Percentile (\d+)th", line):
            percentile = int(m.group(1))
            continue
        cells = [c.strip() for c in line.split("|") if c.strip()]
        if percentile is None or len(cells) < 5 or cells[0] == "City":
            continue
        city = cells[0].split(",")[0].replace("Pooled Estimate", "Pooled (10 cities)")
        for days, cell in zip([1, 2, 3, 5], cells[1:5]):
            m = re.match(r"(-?[\d.]+) \((-?[\d.]+);(-?[\d.]+)\)", cell)
            if m:  # "-" means not estimated (no such heatwaves in that city)
                rows.append({"percentile": percentile, "consecutive_days": days, "city": city,
                             "pct_increase": float(m.group(1)), "ci_low": float(m.group(2)),
                             "ci_high": float(m.group(3))})
    table = pd.DataFrame(rows)
    table.to_csv(HEALTH_DIR / "paper_table_s1.csv", index=False)
    return table


# ------------------------------------------------------------- NCRB deaths ---
def _parse_ncrb_pdf(pdf_bytes: bytes) -> pd.DataFrame:
    """Read the 'State/UT-wise deaths due to Heat/Sun Stroke' annexure table."""
    text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf_bytes)).pages)
    header = re.search(r"SN State/UT ((?:\d{4} ?){5})", text)
    years = [int(y) for y in header.group(1).split()]
    rows = []
    for line in text.split("\n"):
        m = re.match(r"^\s*\d+\s+(.+?)\s+((?:-|\d+)(?:\s+(?:-|\d+)){4})\s*$", line)
        if not m:
            continue
        state = re.sub(r"[@+*]", "", m.group(1)).strip()   # drop footnote symbols
        for year, value in zip(years, m.group(2).split()):
            rows.append({"state": state, "year": year, "deaths": np.nan if value == "-" else int(value)})
    return pd.DataFrame(rows)


def download_ncrb_deaths() -> pd.DataFrame:
    """State-year heat/sun-stroke deaths 2017-2022 (NCRB ADSI, via Parliament answers)."""
    HEALTH_DIR.mkdir(parents=True, exist_ok=True)
    tables = []
    for label, url in NCRB_SOURCES.items():
        pdf = requests.get(url, timeout=120).content
        (HEALTH_DIR / f"ncrb_heat_deaths_{label}.pdf").write_bytes(pdf)
        part = _parse_ncrb_pdf(pdf)
        part["source_url"] = url
        tables.append(part)
    both = pd.concat(tables)

    # The two documents overlap for 2018-2021: they must agree, otherwise stop.
    overlap = both.groupby(["state", "year"])["deaths"].agg(["min", "max", "count"])
    clash = overlap[(overlap["count"] > 1) & (overlap["min"] != overlap["max"])]
    assert clash.empty, f"Sources disagree:\n{clash}"

    deaths = both.drop_duplicates(["state", "year"]).sort_values(["state", "year"]).reset_index(drop=True)
    deaths.to_csv(HEALTH_DIR / "ncrb_heat_deaths_2017_2022.csv", index=False)
    return deaths


def write_transcribed_tables() -> None:
    """Small official tables we could only read on screen (no downloadable file
    without a sign-up form). Values copied exactly; source + date recorded."""
    HEALTH_DIR.mkdir(parents=True, exist_ok=True)
    note = "transcribed 2026-11-17 from the data.gov.in 'Preview data' table"
    pd.DataFrame({
        "year": [2021, 2022, 2023, 2024],
        "suspected_heatstroke_cases": [65, 4481, 19402, 48385],
        "confirmed_heatstroke_deaths": [np.nan, 33, 189, 185],   # NA for 2021 in the source
        "note": ["", "", "", "2024 data as on 28-07-2024"],
        "source": [f"data.gov.in: Year-wise Cases and Deaths Reported in National Heat-Related Illness and "
                   f"Death Surveillance, NPCCHH 2021-2024 (Rajya Sabha S265 AU1693, 6 Aug 2024); {note}"] * 4,
    }).to_csv(HEALTH_DIR / "npcchh_national_2021_2024.csv", index=False)

    # Only the first 10 of 25 rows are visible without the download form, so this
    # table is kept for reference only and NOT used in the model.
    idsp = pd.DataFrame(
        [["Andhra Pradesh", 723, 236, 8, 29, 0, 0], ["Arunachal Pradesh*", None, None, None, None, 1, None],
         ["Bihar", None, 0, 2, 121, None, None], ["Chhattisgarh", 1, 0, 0, 0, 0, None],
         ["Delhi", None, 0, 0, 0, None, 0], ["Goa*", None, None, None, 0, None, None],
         ["Gujarat", 7, 0, 3, 8, None, None], ["Haryana", None, 0, 0, 0, None, None],
         ["Himachal Pradesh", None, None, None, 0, None, None],
         ["Jaamu & Kashmir* (Jammu Division)", None, None, None, 0, 1, None]],
        columns=["state", "2016", "2017", "2018", "2019", "2020", "2021"])
    idsp["source"] = ("data.gov.in: State-wise Heatstroke Deaths reported under Heat Related Illness "
                      f"Surveillance 2016-2021 (Rajya Sabha S255 AU500); {note}; FIRST 10 OF 25 ROWS ONLY")
    idsp.to_csv(HEALTH_DIR / "idsp_heatstroke_deaths_2016_2021_partial.csv", index=False)


# -------------------------------------------------------------- population ---
def download_state_population() -> pd.DataFrame:
    """Census 2011 population per state/UT (column '2011 Census Population' of the
    Wikipedia list, which cites the Census). Used as the Poisson offset."""
    # Wikimedia's robot policy asks scripts to say what they are in the User-Agent.
    headers = {"User-Agent": "HeatShield-student-project/0.1 (python-requests; research use)"}
    wikitext = requests.get(POPULATION_WIKITEXT_URL, headers=headers, timeout=60).text
    (HEALTH_DIR / "wiki_states_population.wikitext").write_text(wikitext)
    rows = []
    for block in wikitext.split("\n|-")[1:]:
        name = re.search(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", block)
        census = re.search(r"\{\{nts\|([\d,]+)\}\}", block)  # first {{nts|..}} = Census 2011
        if name and census:
            rows.append({"state": name.group(1).strip(), "population_2011": int(census.group(1).replace(",", ""))})
    pop = pd.DataFrame(rows).drop_duplicates("state")
    pop.to_csv(HEALTH_DIR / "state_population_census2011.csv", index=False)
    return pop


# ---------------------------------------------------------------- exposure ---
def geocode_capitals() -> pd.DataFrame:
    rows = []
    for state, (city, admin1) in CAPITALS.items():
        params = {"name": city, "count": 10, "language": "en", "format": "json", "countryCode": "IN"}
        results = requests.get(GEOCODE_URL, params=params, timeout=60).json().get("results", [])
        match = next((r for r in results if r.get("admin1") == admin1), None)
        if match is None:
            raise RuntimeError(f"Could not geocode {city} ({admin1})")
        rows.append({"state": state, "capital": city, "lat": match["latitude"], "lon": match["longitude"]})
        time.sleep(0.3)
    caps = pd.DataFrame(rows)
    caps.to_csv(HEALTH_DIR / "state_capitals.csv", index=False)
    return caps


def download_capital_heat_days(start: str = "2017-01-01", end: str = "2022-12-31") -> pd.DataFrame:
    """Per state and year: number of days whose maximum hourly NOAA heat index at the
    capital reached >= 39.4 °C (NOAA 'Danger') and >= 32.2 °C ('Extreme Caution').

    One ERA5 request per capital (all years at once) to stay gentle with the free API.
    """
    caps = geocode_capitals()
    cache_dir = HEALTH_DIR / "era5_capitals"
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for cap in caps.drop_duplicates("capital").itertuples():
        path = cache_dir / f"{cap.capital.replace(' ', '_')}.parquet"
        if not path.exists():
            print(f"  ERA5 {cap.capital} ...", flush=True)
            payload = get_json(ARCHIVE_URL, {
                "latitude": cap.lat, "longitude": cap.lon, "start_date": start, "end_date": end,
                "hourly": "temperature_2m,relative_humidity_2m", "models": "era5", "timezone": TIMEZONE,
            })
            hourly = pd.DataFrame(payload["hourly"])
            hourly["time"] = pd.to_datetime(hourly["time"])
            hourly.to_parquet(path, index=False)
            time.sleep(6)  # ~30 'weighted calls' per request; stay under 600/minute
        hourly = pd.read_parquet(path)
        hourly["hi"] = heat_index_c(hourly["temperature_2m"], hourly["relative_humidity_2m"])
        daily = hourly.groupby(hourly["time"].dt.date)["hi"].max()
        daily.index = pd.to_datetime(daily.index)
        per_year = pd.DataFrame({
            "danger_days": (daily >= 39.4).groupby(daily.index.year).sum(),
            "extreme_caution_days": (daily >= 32.2).groupby(daily.index.year).sum(),
            "mean_daily_max_hi": daily.groupby(daily.index.year).mean().round(2),
        }).rename_axis("year").reset_index()
        per_year["capital"] = cap.capital
        out.append(per_year)
    heat = caps.merge(pd.concat(out), on="capital")
    heat.to_csv(HEALTH_DIR / "state_heat_days_2017_2022.csv", index=False)
    return heat


if __name__ == "__main__":
    print("Paper Table S1 ...");        print(download_paper_tables().query("city == 'Mumbai'"))
    print("NCRB deaths ...");          print(download_ncrb_deaths().groupby("year")["deaths"].sum())
    write_transcribed_tables()
    print("Population ...");           print(len(download_state_population()), "rows")
    print("Capital heat days ...");    print(download_capital_heat_days().head())

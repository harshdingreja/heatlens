"""Summer land-surface temperature (LST) and green cover (NDVI) from Landsat 8/9.

Why satellite data? Weather stations are 2 points for a city of 12 million.
Landsat measures how hot the GROUND surface is every 30 m, so it shows which
wards are urban heat islands (dense roofs, little greenery).

Data: Landsat Collection 2 Level-2 ("landsat-c2-l2") on Microsoft Planetary
Computer (free, no account; URLs are "signed" automatically by the
planetary_computer package). Checked in the STAC metadata on 17 Nov 2026:
    lwir11 (= ST_B10, surface temperature): kelvin = DN * 0.00341802 + 149.0
    red / nir08 (surface reflectance):      reflectance = DN * 0.0000275 - 0.2
    qa_pixel bits: 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow, 7 water

Method
1. All Landsat 8 + 9 scenes over Mumbai in Mar-May (pre-monsoon summer)
   of 2023, 2024, 2025 with < 20 % cloud.
2. Throw away cloudy / shadow / water pixels using qa_pixel. Water is removed
   because sea and creek pixels inside ward polygons would make coastal
   wards look cool even though people live on land.
3. Per pixel, take the MEDIAN over all clear dates (robust to leftover clouds).
4. Ward value = mean of the pixels inside the ward (zonal statistics).

NDVI = (NIR - Red) / (NIR + Red): about 0 for concrete, 0.6+ for dense trees.
We use Landsat for NDVI too, so both layers share the same pixels and masks.

Run from the project root:   python -m heatlens.ingest.satellite
"""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import odc.stac
import planetary_computer
import pystac_client
import rasterio.features
import rioxarray  # noqa: F401  (adds the .rio accessor used to save GeoTIFFs)
import xarray as xr

from heatlens.config import DATA_PROCESSED

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
YEARS = (2023, 2024, 2025)
MAX_CLOUD = 20               # % cloud cover of the whole scene
UTM_43N = "EPSG:32643"
LST_TIF = DATA_PROCESSED / "lst_summer_median_c.tif"
NDVI_TIF = DATA_PROCESSED / "ndvi_summer_median.tif"

# qa_pixel bits that make a pixel unusable for us
BAD_BITS = {"dilated_cloud": 1, "cirrus": 2, "cloud": 3, "cloud_shadow": 4, "water": 7}


def search_scenes(bbox: list[float]) -> list:
    """Find the summer Landsat 8/9 scenes over the bounding box."""
    catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    items = []
    for year in YEARS:
        search = catalog.search(
            collections=["landsat-c2-l2"], bbox=bbox, datetime=f"{year}-03-01/{year}-05-31",
            query={"eo:cloud_cover": {"lt": MAX_CLOUD}, "platform": {"in": ["landsat-8", "landsat-9"]}},
        )
        items += list(search.items())
    return items


def build_composites(wards: gpd.GeoDataFrame) -> tuple[xr.DataArray, xr.DataArray, int]:
    """Median summer LST (°C) and NDVI rasters covering all wards. Also saved as GeoTIFFs."""
    west, south, east, north = wards.total_bounds
    bbox = [west - 0.01, south - 0.01, east + 0.01, north + 0.01]  # small margin around the city
    items = search_scenes(bbox)
    print(f"  {len(items)} Landsat scenes found", flush=True)

    # groupby="solar_day": Mumbai sits on two scene rows (148/046 and 148/047);
    # scenes taken the same day are stitched into one image.
    data = odc.stac.load(
        items, bands=["lwir11", "red", "nir08", "qa_pixel"], bbox=bbox,
        crs=UTM_43N, resolution=30, groupby="solar_day", pool=8,
    )
    qa = data["qa_pixel"].astype("uint16")
    bad = xr.zeros_like(qa, dtype=bool)
    for bit in BAD_BITS.values():
        bad = bad | ((qa >> bit) & 1).astype(bool)
    nodata = (data["lwir11"] == 0) | (data["red"] == 0) | (data["nir08"] == 0)
    keep = ~bad & ~nodata

    lst_c = (data["lwir11"] * 0.00341802 + 149.0 - 273.15).where(keep)
    red = (data["red"] * 0.0000275 - 0.2).where(keep)
    nir = (data["nir08"] * 0.0000275 - 0.2).where(keep)
    ndvi = ((nir - red) / (nir + red)).where(keep)

    lst_median = lst_c.median(dim="time", skipna=True)
    ndvi_median = ndvi.median(dim="time", skipna=True)

    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    for arr, path in [(lst_median, LST_TIF), (ndvi_median, NDVI_TIF)]:
        arr.rio.write_crs(UTM_43N).rio.to_raster(path)
    return lst_median, ndvi_median, data.sizes["time"]


def zonal_mean(raster: xr.DataArray, wards: gpd.GeoDataFrame) -> np.ndarray:
    """Average raster value inside each ward polygon (NaN pixels ignored).

    rasterize() burns ward number 1..24 into a grid aligned with the raster;
    then for each ward we average the pixels carrying its number.
    """
    shapes = ((geom, i + 1) for i, geom in enumerate(wards.to_crs(UTM_43N).geometry))
    labels = rasterio.features.rasterize(
        shapes, out_shape=raster.shape, transform=raster.rio.transform(), fill=0, dtype="int32",
    )
    values = raster.values
    means = []
    for i in range(len(wards)):
        inside = (labels == i + 1) & np.isfinite(values)
        means.append(float(values[inside].mean()) if inside.any() else np.nan)
    return np.array(means)


def load_composites(wards: gpd.GeoDataFrame, refresh: bool = False) -> tuple[xr.DataArray, xr.DataArray]:
    """Re-use the saved GeoTIFFs if they exist (the download takes minutes), else build them."""
    if refresh or not (LST_TIF.exists() and NDVI_TIF.exists()):
        lst, ndvi, _ = build_composites(wards)
        return lst, ndvi
    # open_rasterio gives a (band, y, x) array; squeeze("band") keeps (y, x)
    lst = rioxarray.open_rasterio(LST_TIF, masked=True).squeeze("band", drop=True)
    ndvi = rioxarray.open_rasterio(NDVI_TIF, masked=True).squeeze("band", drop=True)
    return lst, ndvi


def ward_satellite_indicators(wards: gpd.GeoDataFrame, refresh: bool = False) -> gpd.GeoDataFrame:
    """Add lst_summer_c and ndvi_summer columns to the ward table."""
    lst, ndvi = load_composites(wards, refresh)
    out = wards.copy()
    out["lst_summer_c"] = zonal_mean(lst, wards)
    out["ndvi_summer"] = zonal_mean(ndvi, wards)
    return out


if __name__ == "__main__":
    from heatlens.ingest.wards import load_ward_boundaries

    result = ward_satellite_indicators(load_ward_boundaries(), refresh=True)
    print(result[["ward_id", "lst_summer_c", "ndvi_summer"]].round(3).to_string(index=False))

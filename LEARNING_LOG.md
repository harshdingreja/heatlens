# Learning log

## Phase 1–3 (17 Nov 2026): data, heat index, corrector
- **Data provenance:** Meteostat silently fills gaps with a forecast model (85 % of Colaba 2025). We use GHCNh observations only. NOAA ISD ended Aug 2025, and GHCNh is its successor.
- **dtype trap:** humidity is stored as UInt8, so `80 - 81 = 255`. Cast to float before doing maths.
- **Raw forecasts run ~3 °C too cool** (heat index) at Santacruz. On the 2026 test set the corrector cut MAE from 3.75 to 1.45 °C. Linear beat LightGBM because trees can't extrapolate a drifting bias. The final model (linear + small LightGBM stack) was chosen by rolling validation inside 2025 and never on test data.

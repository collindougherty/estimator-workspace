# Data inventory and join memo

## Scope

Prototype cohort: Omaha Accela **residential re-roof** permits from **2025-11-01 through 2026-04-14**, joined to Douglas County property assessment data.

## Source inspection summary

### 1) Live roofing permit source

Inspected `/Users/collindougherty/MyCloud/roofing` without modifying it.

Relevant live source artifacts:
- `omaha_records.py`: search logic, permit type definitions, cache behavior
- `data/omaha_roofing_cache.json`: recent record schema
- public Accela detail pages linked from permit results

Relevant permit/detail fields confirmed on the live site:
- `record_number`
- `record_date`
- `permit_type`
- `status`
- `address` / `permit_address`
- `description` / `short_note`
- `job_value`
- `parcel_number`
- `roof_covering_material`
- `number_of_buildings`
- `construction_type_codes`
- `licensed_professional` / company text

Materialized copy under this repo:
- `modeling/data/raw/roofing/residential_reroof_2025-11-01_2026-04-14.csv`
- metadata: `...metadata.json`

Pull stats:
- raw permit records: **851**
- with job value: **849**
- with parcel number: **849**
- with company text: **845**

### 2) Douglas County property source

Source file was profiled in place and **not modified**:
- `/Users/collindougherty/MyCloud/properties/omaha_properties_raw_master.csv`

Observed source characteristics:
- size: **265,783,115 bytes**
- columns: **64**
- rows scanned: **216,640**

Useful fields for this prototype:
- join keys: `pin`, `property_a`
- location: `prop_city`, `prop_zip`, `centroid_latitude`, `centroid_longitude`
- structure/scale: `bldg_sf`, `bldg_story`, `bldg_yrblt`, `sq_feet`, `acres`, `numbldgs`
- valuation: `land_value`, `improvemen`, `total_valu`
- categorical descriptors: `class`, `bldg_desc`, `quality`, `condition`

Working copy created under this repo:
- `modeling/data/raw/properties/residential_reroof_2025-11-01_2026-04-14_property_subset.csv`
- schema/profile: `...property_profile.json`

I copied only the matched/needed subset rather than duplicating the full 265 MB county file into the repo.

## Join strategy

Primary join:
- `permit.parcel_number == property.pin`

Fallback implemented:
- normalized permit street address to normalized `property_a`

Observed join results:
- matched permits: **849 / 851** (**99.76%**)
- pin matches: **849**
- address fallback matches: **0** on this pull, but the fallback remains useful for future permit types/date ranges

## Modeling cohort definition

Filtered from joined data to:
- matched property row
- positive `job_value`
- `status` in `{Issued, Closed}`
- county `class == 'R'`
- non-null `bldg_sf` and `total_valu`
- single-building permits (`number_of_buildings <= 1` or null)

Final cohort:
- **803** residential jobs
- median declared job value: **$10,500**
- median declared job value / assessed building sf: **$7.44**

## Data quality notes

- Permit `job_value` is public declared valuation, not audited realized invoice value.
- Some licensed-company strings are noisy; a few appear homeowner/address-like rather than clean contractor entities.
- Roofing material is heavily concentrated in **Asphalt (780 / 851)**, so material effects outside asphalt are weakly estimated.
- There is a long right tail up to **$150k** and a small number of suspiciously low valuations, likely partial-scope, misclassified, or noisy filings.

## Files to inspect next

- joined/cohort data: `modeling/data/processed/residential_reroof_2025-11-01_2026-04-14_joined.csv`
- target definitions: `..._target_summary.csv`
- company summaries: `..._company_summary.csv`, `..._company_summary_filtered.csv`

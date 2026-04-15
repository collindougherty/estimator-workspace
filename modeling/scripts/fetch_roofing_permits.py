#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from dataclasses import dataclass
from datetime import date
from datetime import datetime
from datetime import timedelta
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://aca-prod.accela.com/OMAHA"
SEARCH_URL = f"{BASE_URL}/Cap/CapHome.aspx?module=Permits&TabName=Permits"
REQUEST_TIMEOUT = 30
PAGE_SIZE = 10
USER_AGENT = "Mozilla/5.0"
DETAIL_RETRY_STATUSES = {429, 503}
MODEL_ROOT = Path(__file__).resolve().parents[1]
RAW_ROOFING_DIR = MODEL_ROOT / "data" / "raw" / "roofing"

PERMIT_TYPES = {
    "residential_reroof": {
        "label": "Residential re-roof",
        "value": "Permits/BUILDING/RESIDENTIAL/RE-ROOF",
        "result_type": "RE-ROOF",
    },
    "residential_roof_repair": {
        "label": "Residential roof repair",
        "value": "Permits/BUILDING/RESIDENTIAL/ROOF REPAIR",
        "result_type": "ROOF REPAIR",
    },
}

COUNT_RE = re.compile(r"Showing\s+\d+-\d+\s+of\s+([^<\s]+)")
JOB_VALUE_RE = re.compile(
    r'Job Value\(\$\):</h2></span>\s*<span class="ACA_SmLabel ACA_SmLabel_FontSize">\$?([0-9,]+(?:\.[0-9]+)?)',
    flags=re.I,
)
PARCEL_RE = re.compile(r"Parcel Number:\s*([0-9]+)", flags=re.I)


@dataclass(slots=True)
class PermitRecord:
    category: str
    record_number: str
    record_date: str | None
    permit_type: str | None
    address: str | None
    status: str | None
    description: str | None
    short_note: str | None
    permit_address: str | None
    detail_url: str | None
    source_date_range_start: str
    source_date_range_end: str
    job_value: float | None = None
    parcel_number: str | None = None
    roof_covering_material: str | None = None
    number_of_buildings: float | None = None
    construction_type_codes: str | None = None
    owner_name: str | None = None
    licensed_professional_name: str | None = None
    licensed_company_name: str | None = None
    licensed_professional_raw: str | None = None
    fetch_error: str | None = None


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(html_lib.unescape(value).replace("\xa0", " ").split())
    return cleaned or None


def parse_mmddyyyy(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def request_headers(referer: str = SEARCH_URL) -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Origin": "https://aca-prod.accela.com",
        "Referer": referer,
    }


def extract_form_fields(form: BeautifulSoup) -> dict[str, str]:
    fields: dict[str, str] = {}
    for input_tag in form.find_all("input"):
        name = input_tag.get("name")
        if name:
            fields[name] = input_tag.get("value", "")
    for select_tag in form.find_all("select"):
        name = select_tag.get("name")
        if not name:
            continue
        selected_option = select_tag.find("option", selected=True)
        fields[name] = selected_option.get("value", "") if selected_option else ""
    return fields


def extract_count_label(html: str) -> str | None:
    match = COUNT_RE.search(html)
    if match:
        return match.group(1).strip()
    if "Your search returned no results." in html:
        return "0"
    return None


def format_date(value: date) -> str:
    return value.strftime("%m/%d/%Y")


def parse_direct_detail_page(
    html: str,
    category_label: str,
    start_date: date,
    end_date: date,
) -> PermitRecord | None:
    soup = BeautifulSoup(html, "html.parser")
    title_meta = soup.find("meta", attrs={"name": "og:title"})
    description_meta = soup.find("meta", attrs={"name": "og:description"})
    if title_meta is None or description_meta is None:
        return None

    record_number = clean_text(title_meta.get("content"))
    og_description = clean_text(description_meta.get("content"))
    if not record_number or not og_description:
        return None

    record_date_match = re.search(r"on (\d{2}/\d{2}/\d{4})\.?$", og_description)
    permit_type_match = re.search(r"Permits (.*?) for ", og_description)
    address_match = re.search(r" for (.*?) has been changed to ", og_description)
    status_match = re.search(r"has been changed to (.*?) on \d{2}/\d{2}/\d{4}", og_description)
    form = soup.find("form")
    action = form.get("action", "") if form else ""
    detail_url = urljoin(SEARCH_URL, action) if "CapDetail.aspx" in action else SEARCH_URL

    return PermitRecord(
        category=category_label,
        record_number=record_number,
        record_date=parse_mmddyyyy(record_date_match.group(1)) if record_date_match else None,
        permit_type=clean_text(permit_type_match.group(1)) if permit_type_match else None,
        address=clean_text(address_match.group(1)) if address_match else None,
        status=clean_text(status_match.group(1)) if status_match else None,
        description=og_description,
        short_note=None,
        permit_address=None,
        detail_url=detail_url,
        source_date_range_start=start_date.isoformat(),
        source_date_range_end=end_date.isoformat(),
    )


def text_from_id(soup: BeautifulSoup, element_id: str) -> str | None:
    tag = soup.find(id=element_id)
    return clean_text(tag.get_text(" ", strip=True)) if tag else None


def parse_search_rows(
    html: str,
    category_label: str,
    start_date: date,
    end_date: date,
) -> list[PermitRecord]:
    soup = BeautifulSoup(html, "html.parser")
    records: list[PermitRecord] = []
    for row_idx in range(2, PAGE_SIZE + 2):
        prefix = f"ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList_ctl{row_idx:02d}_"
        permit_tag = (
            soup.find(id=prefix + "hlPermitNumber")
            or soup.find(id=prefix + "lblPermitNumber")
            or soup.find(id=prefix + "lblPermitNumber1")
        )
        if permit_tag is None:
            continue

        record_number = clean_text(permit_tag.get_text(" ", strip=True))
        if not record_number or not record_number.startswith("BLD-"):
            continue

        detail_url = None
        if getattr(permit_tag, "name", None) == "a":
            detail_url = permit_tag.get("href")
            if detail_url and detail_url.startswith("/"):
                detail_url = urljoin(BASE_URL, detail_url)

        records.append(
            PermitRecord(
                category=category_label,
                record_number=record_number,
                record_date=parse_mmddyyyy(text_from_id(soup, prefix + "lblUpdatedTime")),
                permit_type=text_from_id(soup, prefix + "lblType"),
                address=text_from_id(soup, prefix + "lblAddress"),
                status=text_from_id(soup, prefix + "lblStatus"),
                description=text_from_id(soup, prefix + "lblDescription"),
                short_note=text_from_id(soup, prefix + "lblShortNote"),
                permit_address=text_from_id(soup, prefix + "lblPermitAddress"),
                detail_url=detail_url,
                source_date_range_start=start_date.isoformat(),
                source_date_range_end=end_date.isoformat(),
            )
        )
    return records


def parse_page_targets(first_page_html: str) -> dict[int, str]:
    soup = BeautifulSoup(first_page_html, "html.parser")
    page_targets: dict[int, str] = {}
    for anchor in soup.select("td.aca_pagination_td a"):
        label = clean_text(anchor.get_text(" ", strip=True))
        href = html_lib.unescape(anchor.get("href", ""))
        match = re.search(r"__doPostBack\('([^']+)'", href)
        if label and label.isdigit() and match:
            page_targets[int(label)] = match.group(1)
    return page_targets


def submit_search(permit_type_value: str, start_date: date, end_date: date) -> tuple[requests.Session, dict[str, str], str]:
    session = requests.Session()
    headers = request_headers(SEARCH_URL)
    search_form = session.get(SEARCH_URL, headers=headers, timeout=REQUEST_TIMEOUT)
    search_form.raise_for_status()

    soup = BeautifulSoup(search_form.text, "html.parser")
    form = soup.find("form")
    if form is None:
        raise RuntimeError("Could not find Omaha permit search form.")

    payload = extract_form_fields(form)
    payload.update(
        {
            "__EVENTTARGET": "ctl00$PlaceHolderMain$btnNewSearch",
            "__EVENTARGUMENT": "",
            "ctl00$PlaceHolderMain$ddlSearchType": "0",
            "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType": permit_type_value,
            "ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate": format_date(start_date),
            "ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate": format_date(end_date),
        }
    )
    response = session.post(SEARCH_URL, data=payload, headers=headers, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return session, headers, response.text


def fetch_search_records_for_range(permit_type: dict[str, str], start_date: date, end_date: date) -> list[PermitRecord]:
    session, headers, first_page_html = submit_search(permit_type["value"], start_date, end_date)
    count_label = extract_count_label(first_page_html)

    if count_label is None:
        detail_record = parse_direct_detail_page(first_page_html, permit_type["label"], start_date, end_date)
        return [detail_record] if detail_record else []

    if count_label.endswith("+") and start_date < end_date:
        midpoint = start_date + timedelta(days=(end_date - start_date).days // 2)
        left_records = fetch_search_records_for_range(permit_type, start_date, midpoint)
        right_records = fetch_search_records_for_range(permit_type, midpoint + timedelta(days=1), end_date)
        return left_records + right_records

    page_htmls = [first_page_html]
    soup = BeautifulSoup(first_page_html, "html.parser")
    form = soup.find("form")
    base_payload = extract_form_fields(form) if form else {}
    for page_num, target in sorted(parse_page_targets(first_page_html).items()):
        if page_num <= 1:
            continue
        payload = dict(base_payload)
        payload["__EVENTTARGET"] = target
        payload["__EVENTARGUMENT"] = ""
        response = session.post(SEARCH_URL, data=payload, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        page_htmls.append(response.text)

    records: list[PermitRecord] = []
    for page_html in page_htmls:
        records.extend(parse_search_rows(page_html, permit_type["label"], start_date, end_date))
    return records


def extract_scalar_field(html: str, label: str) -> str | None:
    pattern = re.compile(
        rf'{re.escape(label)}:</h2></span>\s*<span class="ACA_SmLabel ACA_SmLabel_FontSize">(.*?)</span>',
        flags=re.I | re.S,
    )
    match = pattern.search(html)
    if not match:
        return None
    return clean_text(BeautifulSoup(match.group(1), "html.parser").get_text(" ", strip=True))


def extract_asi_field(html: str, label: str) -> str | None:
    pattern = re.compile(
        rf'{re.escape(label)}:\s*</span>\s*</div>\s*<div class=["\']MoreDetail_ItemColASI MoreDetail_ItemCol2["\']>\s*<span class=["\']ACA_SmLabel ACA_SmLabel_FontSize["\']>(.*?)</span>',
        flags=re.I | re.S,
    )
    match = pattern.search(html)
    if not match:
        return None
    return clean_text(BeautifulSoup(match.group(1), "html.parser").get_text(" ", strip=True))


def extract_contact_lines(html: str, label: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    label_node = soup.find(string=re.compile(rf"^{re.escape(label)}:$", flags=re.I))
    if label_node is None:
        return []
    header = label_node.find_parent("h1")
    if header is None:
        return []
    value_span = header.find_next_sibling("span")
    if value_span is None:
        return []
    text = value_span.get_text("\n", strip=True)
    return [line for line in (clean_text(line) for line in text.splitlines()) if line]


def enrich_record(record: PermitRecord, pause_seconds: float = 0.0, max_attempts: int = 8) -> PermitRecord:
    if not record.detail_url:
        record.fetch_error = "Missing detail_url"
        return record

    html: str | None = None
    last_error: str | None = None
    for attempt in range(1, max_attempts + 1):
        if pause_seconds:
            time.sleep(pause_seconds)
        try:
            response = requests.get(
                record.detail_url,
                headers=request_headers(record.detail_url),
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code in DETAIL_RETRY_STATUSES:
                retry_after = response.headers.get("Retry-After")
                sleep_seconds = float(retry_after) if retry_after else min(30.0, 1.5 * attempt)
                last_error = f"{response.status_code} retry after {sleep_seconds:.1f}s"
                time.sleep(sleep_seconds)
                continue
            response.raise_for_status()
            html = response.text
            break
        except Exception as error:  # noqa: BLE001
            last_error = str(error)
            if attempt < max_attempts:
                time.sleep(min(20.0, 1.5 * attempt))
            continue

    if html is None:
        record.fetch_error = last_error or "Unknown detail fetch failure"
        return record

    job_value_match = JOB_VALUE_RE.search(html)
    parcel_match = PARCEL_RE.search(html)
    owner_lines = extract_contact_lines(html, "Owner")
    licensed_lines = extract_contact_lines(html, "Licensed Professional")

    record.job_value = float(job_value_match.group(1).replace(",", "")) if job_value_match else None
    record.parcel_number = parcel_match.group(1) if parcel_match else None
    record.roof_covering_material = extract_asi_field(html, "Roof Covering Material")
    number_of_buildings = extract_scalar_field(html, "Number of Buildings")
    record.number_of_buildings = float(number_of_buildings) if number_of_buildings else None
    record.construction_type_codes = extract_scalar_field(html, "Construction Type Codes")
    record.owner_name = owner_lines[0] if owner_lines else None
    record.licensed_professional_raw = " | ".join(licensed_lines) if licensed_lines else None
    record.licensed_professional_name = licensed_lines[0] if licensed_lines else None
    record.licensed_company_name = licensed_lines[1] if len(licensed_lines) > 1 else None
    return record


def deduplicate_records(records: Iterable[PermitRecord]) -> list[PermitRecord]:
    deduped: dict[str, PermitRecord] = {}
    for record in records:
        deduped.setdefault(record.record_number, record)
    return list(deduped.values())


def write_csv(path: Path, records: list[PermitRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [asdict(record) for record in records]
    if not rows:
        raise RuntimeError("No permit records were collected.")
    headers = list(rows[0].keys())
    import csv

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Omaha residential roofing permit data for modeling.")
    parser.add_argument("--permit-key", default="residential_reroof", choices=sorted(PERMIT_TYPES))
    parser.add_argument("--start-date", default="2025-11-01")
    parser.add_argument("--end-date", default="2026-04-14")
    parser.add_argument("--detail-workers", type=int, default=1)
    parser.add_argument("--detail-pause-seconds", type=float, default=0.15)
    parser.add_argument("--output-csv", type=Path)
    parser.add_argument("--output-metadata", type=Path)
    args = parser.parse_args()

    start_date = date.fromisoformat(args.start_date)
    end_date = date.fromisoformat(args.end_date)
    permit_type = PERMIT_TYPES[args.permit_key]

    stub = f"{args.permit_key}_{start_date.isoformat()}_{end_date.isoformat()}"
    output_csv = args.output_csv or (RAW_ROOFING_DIR / f"{stub}.csv")
    output_metadata = args.output_metadata or (RAW_ROOFING_DIR / f"{stub}.metadata.json")

    print(f"[fetch] permit type={args.permit_key} start={start_date} end={end_date}")
    raw_records = fetch_search_records_for_range(permit_type, start_date, end_date)
    deduped_records = deduplicate_records(raw_records)
    print(f"[fetch] search rows collected={len(raw_records)} unique_records={len(deduped_records)}")

    enriched_records: list[PermitRecord] = []
    with ThreadPoolExecutor(max_workers=max(1, args.detail_workers)) as executor:
        futures = {
            executor.submit(enrich_record, record, args.detail_pause_seconds): record.record_number
            for record in deduped_records
        }
        for idx, future in enumerate(as_completed(futures), start=1):
            enriched_records.append(future.result())
            if idx % 50 == 0 or idx == len(futures):
                print(f"[fetch] enriched {idx}/{len(futures)} detail pages")

    enriched_records.sort(key=lambda record: (record.record_date or "", record.record_number))
    write_csv(output_csv, enriched_records)

    metadata = {
        "source_name": "City of Omaha Accela Citizen Access",
        "source_url": SEARCH_URL,
        "permit_type": permit_type,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "record_count": len(enriched_records),
        "records_with_job_value": sum(record.job_value is not None for record in enriched_records),
        "records_with_parcel_number": sum(record.parcel_number is not None for record in enriched_records),
        "records_with_company_name": sum(record.licensed_company_name is not None for record in enriched_records),
        "records_with_errors": sum(record.fetch_error is not None for record in enriched_records),
        "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "output_csv": str(output_csv),
    }
    output_metadata.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"[fetch] wrote {output_csv}")
    print(f"[fetch] wrote {output_metadata}")


if __name__ == "__main__":
    main()

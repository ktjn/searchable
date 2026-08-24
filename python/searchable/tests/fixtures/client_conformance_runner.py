"""Run shared query fixtures through the Python client and emit normalized JSON."""

import dataclasses
import json
import sys
from pathlib import Path
from typing import Any

from searchable import SearchClient, SearchOptions


def _python_filters(filters: dict[str, Any] | None) -> dict[str, Any] | None:
    if filters is None:
        return None
    converted: dict[str, Any] = {}
    for field, value in filters.items():
        if isinstance(value, dict) and "radiusKm" in value:
            converted[field] = {
                "lat": value["lat"],
                "lon": value["lon"],
                "radius_km": value["radiusKm"],
            }
        else:
            converted[field] = value
    return converted


def _search_options(raw: dict[str, Any]) -> SearchOptions:
    return SearchOptions(
        language=raw.get("language"),
        limit=raw.get("limit", 10),
        operator=raw.get("operator", "and"),
        boosts=raw.get("boosts"),
        filters=_python_filters(raw.get("filters")),
        facets=raw.get("facets", []),
        synonyms=raw.get("synonyms", False),
        synonym_weight=raw.get("synonymWeight", 0.5),
        fuzzy=raw.get("fuzzy", False),
        fuzzy_weight=raw.get("fuzzyWeight", 0.5),
        highlight=raw.get("highlight", False),
        sort_by_distance=raw.get("sortByDistance", False),
    )


def _camel_case(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part.capitalize() for part in rest)


def _jsonable(value: Any) -> Any:
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            _camel_case(field.name): _jsonable(getattr(value, field.name))
            for field in dataclasses.fields(value)
        }
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    return value


def main() -> None:
    manifest_path = Path(sys.argv[1]).resolve()
    cases_path = Path(sys.argv[2]).resolve()
    cases = json.loads(cases_path.read_text(encoding="utf8"))
    client = SearchClient(str(manifest_path))
    results = {
        case["id"]: _jsonable(client.search(case["query"], _search_options(case["options"])))
        for case in cases
    }
    print(json.dumps(results, sort_keys=True))


if __name__ == "__main__":
    main()

import argparse
import dataclasses
import json
import sys
from typing import Any

from searchable_client import SearchClient
from searchable_client.search import FacetValuesOptions, SearchOptions


def _parse_filters(pairs: list[str] | None) -> dict[str, str] | None:
    if not pairs:
        return None
    filters: dict[str, str] = {}
    for pair in pairs:
        field, _, value = pair.partition("=")
        filters[field] = value
    return filters


def _to_jsonable(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {_to_camel(k): _to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    return obj


def _to_camel(snake: str) -> str:
    first, *rest = snake.split("_")
    return first + "".join(w.capitalize() for w in rest)


def _cmd_query(args: argparse.Namespace) -> None:
    client = SearchClient(args.index_url)
    options = SearchOptions(
        limit=args.limit,
        language=args.language,
        filters=_parse_filters(args.filter),
        facets=args.facets.split(",") if args.facets else [],
        synonyms=args.synonyms,
        fuzzy=args.fuzzy,
        highlight=args.highlight,
    )
    result = client.search(args.query, options)
    if args.json:
        print(json.dumps(_to_jsonable(result)))
        return
    print(f"{result.total_hits} hits for {args.query!r} ({result.language}):")
    for hit in result.hits:
        title = hit.fields.get("title", "")
        print(f"  [{hit.score:.3f}] {title} -- {hit.url}")


def _cmd_facet(args: argparse.Namespace) -> None:
    client = SearchClient(args.index_url)
    facet_options = FacetValuesOptions(filters=_parse_filters(args.filter))
    result = client.facet_values(args.field, facet_options)
    if args.json:
        print(json.dumps(_to_jsonable(result)))
        return
    for value in result.values:
        marker = "*" if value.selected else " "
        print(f"{marker} {value.value} ({value.count})")


def main() -> None:
    parser = argparse.ArgumentParser(prog="searchable-client")
    subparsers = parser.add_subparsers(dest="command", required=True)

    query_parser = subparsers.add_parser("query")
    query_parser.add_argument("index_url")
    query_parser.add_argument("query")
    query_parser.add_argument("--limit", type=int, default=10)
    query_parser.add_argument("--language")
    query_parser.add_argument("--filter", action="append")
    query_parser.add_argument("--facets")
    query_parser.add_argument("--synonyms", action="store_true")
    query_parser.add_argument("--fuzzy", action="store_true")
    query_parser.add_argument("--highlight", action="store_true")
    query_parser.add_argument("--json", action="store_true")
    query_parser.set_defaults(func=_cmd_query)

    facet_parser = subparsers.add_parser("facet")
    facet_parser.add_argument("index_url")
    facet_parser.add_argument("field")
    facet_parser.add_argument("--filter", action="append")
    facet_parser.add_argument("--json", action="store_true")
    facet_parser.set_defaults(func=_cmd_facet)

    args = parser.parse_args(sys.argv[1:])
    args.func(args)


if __name__ == "__main__":
    main()

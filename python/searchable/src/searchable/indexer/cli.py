import argparse
import sys
from collections.abc import Sequence

from searchable.indexer.build_index import build_index
from searchable.indexer.discover import discover_html_documents
from searchable.indexer.types import SectionIndexingConfig
from searchable.indexer.write_index import write_index

_VALID_SECTION_LEVELS = {"h1", "h2", "h3", "h4", "h5", "h6"}


def _section_levels(value: str) -> tuple[str, ...]:
    selectors = tuple(selector.strip().lower() for selector in value.split(",") if selector.strip())
    invalid = [selector for selector in selectors if selector not in _VALID_SECTION_LEVELS]
    if invalid:
        raise argparse.ArgumentTypeError(f"invalid heading levels {invalid!r} -- must be h1..h6")
    return selectors


def add_build_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("input_dir")
    parser.add_argument("out_dir")
    parser.add_argument(
        "--sections",
        type=_section_levels,
        metavar="h2,h3",
        help="index one document per selected heading section",
    )
    parser.add_argument(
        "--page-and-sections",
        action="store_true",
        help="retain the page document as well as selected sections",
    )
    parser.set_defaults(func=_cmd_build)


def _cmd_build(args: argparse.Namespace) -> None:
    section_config = None
    if args.sections:
        section_config = SectionIndexingConfig(
            selectors=args.sections,
            mode="page-and-sections" if args.page_and_sections else "sections",
        )

    sources = discover_html_documents(args.input_dir)
    if section_config is not None:
        built = build_index(sources, section_indexing=section_config)
    else:
        built = build_index(sources)
    write_index(built, args.out_dir)
    total_docs = sum(built.manifest["docCount"].values())
    print(f"indexed {total_docs} document(s) from {args.input_dir} -> {args.out_dir}")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="searchable-indexer")
    add_build_arguments(parser)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])

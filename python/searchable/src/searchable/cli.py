import argparse
import sys
from collections.abc import Sequence

from searchable.client.cli import add_client_subcommands
from searchable.indexer.cli import add_build_arguments

_COMMANDS = {"build", "query", "facet"}


def _with_legacy_build_compatibility(argv: Sequence[str]) -> list[str]:
    args = list(argv)
    if args and args[0] not in _COMMANDS and args[0] not in {"-h", "--help"}:
        return ["build", *args]
    return args


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="searchable",
        description="Build and query Searchable indexes.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build", help="build an index from rendered HTML")
    add_build_arguments(build_parser)
    add_client_subcommands(subparsers)

    raw_args = sys.argv[1:] if argv is None else argv
    args = parser.parse_args(_with_legacy_build_compatibility(raw_args))
    args.func(args)


if __name__ == "__main__":
    main()

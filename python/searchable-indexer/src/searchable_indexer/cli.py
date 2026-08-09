import sys

from searchable_indexer.build_index import build_index
from searchable_indexer.discover import discover_html_documents
from searchable_indexer.types import SectionIndexingConfig
from searchable_indexer.write_index import write_index

_VALID_SECTION_LEVELS = {"h1", "h2", "h3", "h4", "h5", "h6"}


def _parse_args(
    args: list[str],
) -> tuple[str, str, SectionIndexingConfig | None]:
    if len(args) < 2:
        print(
            "usage: searchable-indexer <inputDir> <outDir> "
            "[--sections h2,h3] [--page-and-sections]",
            file=sys.stderr,
        )
        sys.exit(1)

    positional: list[str] = []
    section_selectors: list[str] = []
    page_and_sections = False
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--sections":
            if index + 1 >= len(args):
                print(
                    "--sections requires a comma-separated list of heading levels",
                    file=sys.stderr,
                )
                sys.exit(1)
            section_selectors = [s.strip().lower() for s in args[index + 1].split(",") if s.strip()]
            index += 2
            continue
        if arg == "--page-and-sections":
            page_and_sections = True
            index += 1
            continue
        positional.append(arg)
        index += 1

    if len(positional) != 2:
        print(
            "usage: searchable-indexer <inputDir> <outDir> "
            "[--sections h2,h3] [--page-and-sections]",
            file=sys.stderr,
        )
        sys.exit(1)

    invalid = [s for s in section_selectors if s not in _VALID_SECTION_LEVELS]
    if invalid:
        print(
            f"invalid --sections heading levels {invalid!r} -- must be h1..h6",
            file=sys.stderr,
        )
        sys.exit(1)

    section_config = None
    if section_selectors:
        section_config = SectionIndexingConfig(
            selectors=tuple(section_selectors),
            mode="page-and-sections" if page_and_sections else "sections",
        )

    return positional[0], positional[1], section_config


def main() -> None:
    input_dir, out_dir, section_config = _parse_args(sys.argv[1:])
    sources = discover_html_documents(input_dir)
    if section_config is not None:
        built = build_index(sources, section_indexing=section_config)
    else:
        built = build_index(sources)
    write_index(built, out_dir)
    total_docs = sum(built.manifest["docCount"].values())
    print(f"indexed {total_docs} document(s) from {input_dir} -> {out_dir}")


if __name__ == "__main__":
    main()

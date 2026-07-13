import sys

from searchable_indexer.build_index import build_index
from searchable_indexer.discover import discover_html_documents
from searchable_indexer.write_index import write_index


def main() -> None:
    args = sys.argv[1:]
    if len(args) != 2:
        print("usage: searchable-indexer <inputDir> <outDir>", file=sys.stderr)
        sys.exit(1)

    input_dir, out_dir = args
    sources = discover_html_documents(input_dir)
    built = build_index(sources)
    write_index(built, out_dir)
    total_docs = sum(built.manifest["docCount"].values())
    print(f"indexed {total_docs} document(s) from {input_dir} -> {out_dir}")


if __name__ == "__main__":
    main()

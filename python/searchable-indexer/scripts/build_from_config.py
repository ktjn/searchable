import json
import sys
from pathlib import Path

from searchable_indexer.build_index import build_index
from searchable_indexer.types import SourceDocument
from searchable_indexer.write_index import write_index


def _deterministic_embed(texts: list[str]) -> list[list[float]]:
    """Fully deterministic, non-semantic stand-in embedder for tests: a
    Python callable can't cross the JSON config boundary this script reads
    from, so build config selects this by name (`"embed": "deterministic"`)
    rather than passing a real function."""
    return [[float(len(t)), float(sum(ord(c) for c in t) % 97)] for t in texts]


_EMBEDDERS = {"deterministic": _deterministic_embed}


def main() -> None:
    if len(sys.argv) != 4:
        print(
            "usage: build_from_config.py <sources.json> <config.json> <outDir>",
            file=sys.stderr,
        )
        sys.exit(1)

    sources_path, config_path, out_dir = sys.argv[1:]
    raw_sources = json.loads(Path(sources_path).read_text(encoding="utf-8"))
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))

    sources = [
        SourceDocument(id=s["id"], url=s["url"], html=s["html"]) for s in raw_sources
    ]

    build_kwargs = dict(config.get("build", {}))
    write_kwargs = config.get("write", {})

    embed_name = build_kwargs.pop("embed", None)
    if embed_name is not None:
        build_kwargs["embed"] = _EMBEDDERS[embed_name]

    built = build_index(sources, **build_kwargs)
    write_index(built, out_dir, **write_kwargs)


if __name__ == "__main__":
    main()

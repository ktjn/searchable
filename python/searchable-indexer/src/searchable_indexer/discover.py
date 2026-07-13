from pathlib import Path

from searchable_indexer.types import SourceDocument


def _find_html_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.html") if p.is_file())


def discover_html_documents(root_dir: str) -> list[SourceDocument]:
    root = Path(root_dir)
    files = _find_html_files(root)
    sources: list[SourceDocument] = []
    for doc_id, file in enumerate(files):
        html = file.read_text(encoding="utf-8")
        rel = file.relative_to(root).with_suffix("")
        url = "/" + rel.as_posix()
        sources.append(SourceDocument(id=doc_id, url=url, html=html))
    return sources

import math
import re
import sys
from typing import Any
from urllib.parse import urljoin, urlparse

from selectolax.parser import HTMLParser, Node

from searchable.analysis import detect_language, get_registered_language_codes
from searchable.indexer.types import ExtractedDocument, ExtractedSection, PinDeclaration

_FACET_TAG_PREFIX = "searchable-facet-"
_RANGE_FACET_TAG_PREFIX = "searchable-facet-range-"
_META_META_PREFIX = "searchable-meta-"
_BOILERPLATE_SELECTORS = ["nav", "header", "footer", "aside", "script", "style"]
_SAFE_URL_PROTOCOLS = {"http", "https"}
_WHITESPACE_RE = re.compile(r"\s+")
_TEXT_NODE_TAG = "-text"
_HEADING_LEVELS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


def _collapse_whitespace(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _parse_float_or_nan(raw: str | None) -> float:
    if not raw:
        return float("nan")
    try:
        return float(raw)
    except ValueError:
        return float("nan")


def _warn(message: str) -> None:
    print(f"[searchable-indexer] {message}", file=sys.stderr)


def _sanitize_canonical_url(
    canonical: str,
    source_url: str,
    allowed_url_origins: list[str] | None,
    base_url: str | None,
) -> str:
    if not canonical:
        return source_url

    # Root-relative paths have no scheme to exploit and need no base to
    # resolve. Protocol-relative ("//evil.com/foo") is deliberately
    # excluded from this fast path (its second character is also "/")
    # so it always goes through full URL resolution below.
    if canonical.startswith("/") and not canonical.startswith("//"):
        return canonical

    direct = urlparse(canonical)
    if direct.scheme and direct.netloc:
        parsed = direct
    elif base_url:
        parsed = urlparse(urljoin(base_url, canonical))
    else:
        _warn(
            f'canonical URL "{canonical}" for {source_url} is malformed or relative '
            "with no baseUrl configured -- ignoring, indexing with "
            f"{source_url} instead."
        )
        return source_url

    if parsed.scheme not in _SAFE_URL_PROTOCOLS or not parsed.netloc:
        _warn(
            f'canonical URL "{canonical}" for {source_url} uses a disallowed '
            f"protocol ({parsed.scheme}:) -- ignoring, indexing with {source_url} instead."
        )
        return source_url

    if allowed_url_origins is not None:
        origin = f"{parsed.scheme}://{parsed.hostname}"
        if parsed.port:
            origin += f":{parsed.port}"
        if origin not in allowed_url_origins:
            _warn(
                f'canonical URL "{canonical}" for {source_url} resolves to an '
                f"origin ({origin}) not in allowed_url_origins -- ignoring, "
                f"indexing with {source_url} instead."
            )
            return source_url

    return parsed.geturl()


def _extract(
    tree: HTMLParser,
    source_url: str,
    default_language: str = "en",
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
) -> ExtractedDocument:
    noindex = tree.css_first('meta[name="searchable-noindex"]') is not None

    title_node = tree.css_first("title")
    title = _collapse_whitespace(title_node.text(deep=True, separator=" ") if title_node else "")

    html_node = tree.css_first("html")
    declared_language = (html_node.attributes.get("lang") or "").strip() if html_node else ""

    canonical_node = tree.css_first('link[rel="canonical"]')
    canonical = (canonical_node.attributes.get("href") or "").strip() if canonical_node else ""
    url = _sanitize_canonical_url(canonical, source_url, allowed_url_origins, canonical_base_url)

    desc_node = tree.css_first('meta[name="description"]')
    excerpt = _collapse_whitespace((desc_node.attributes.get("content") or "") if desc_node else "")

    body_node = (
        tree.css_first("[data-searchable-body]") or tree.css_first("main") or tree.css_first("body")
    )
    if body_node is not None:
        selector = ",".join([*_BOILERPLATE_SELECTORS, "[data-searchable-ignore]"])
        for el in body_node.css(selector):
            el.decompose()
    body = _collapse_whitespace(body_node.text(deep=True, separator=" ") if body_node else "")

    language = (
        declared_language
        or detect_language(f"{title} {body}", get_registered_language_codes())
        or default_language
    )

    boost_node = tree.css_first('meta[name="searchable-boost"]')
    parsed_boost = _parse_float_or_nan(boost_node.attributes.get("content") if boost_node else None)
    boost = parsed_boost if math.isfinite(parsed_boost) and parsed_boost > 0 else 1.0

    facets: dict[str, list[str]] = {}
    range_facets: dict[str, float] = {}
    for meta in tree.css("meta"):
        name = meta.attributes.get("name") or ""
        if name.startswith(_RANGE_FACET_TAG_PREFIX):
            field_name = name[len(_RANGE_FACET_TAG_PREFIX) :]
            raw = (meta.attributes.get("content") or "").strip()
            parsed = _parse_float_or_nan(raw)
            if field_name and math.isfinite(parsed) and field_name not in range_facets:
                range_facets[field_name] = parsed
            continue
        if not name.startswith(_FACET_TAG_PREFIX):
            continue
        field_name = name[len(_FACET_TAG_PREFIX) :]
        value = (meta.attributes.get("content") or "").strip()
        if not field_name or not value:
            continue
        values = facets.setdefault(field_name, [])
        if value not in values:
            values.append(value)

    pin_phrases = [
        (el.attributes.get("content") or "").strip()
        for el in tree.css('meta[name="searchable-pin"]')
    ]
    pin_phrases = [p for p in pin_phrases if p]

    pin_mode_node = tree.css_first('meta[name="searchable-pin-mode"]')
    pin_mode_attr = (pin_mode_node.attributes.get("content") or "").strip() if pin_mode_node else ""
    pin_mode = "contains" if pin_mode_attr == "contains" else "exact"

    pin_priority_node = tree.css_first('meta[name="searchable-pin-priority"]')
    parsed_priority = _parse_float_or_nan(
        pin_priority_node.attributes.get("content") if pin_priority_node else None
    )
    pin_priority = parsed_priority if math.isfinite(parsed_priority) else 0.0

    pin_exclusive = tree.css_first('meta[name="searchable-pin-exclusive"]') is not None

    pins = [
        PinDeclaration(phrase=phrase, mode=pin_mode, priority=pin_priority, exclusive=pin_exclusive)
        for phrase in pin_phrases
    ]

    metadata: dict[str, str] = {}
    for meta in tree.css("meta"):
        meta_name = meta.attributes.get("name") or ""
        if not meta_name.startswith(_META_META_PREFIX):
            continue
        field_name = meta_name[len(_META_META_PREFIX) :]
        value = (meta.attributes.get("content") or "").strip()
        if field_name and field_name not in metadata:
            metadata[field_name] = value

    return ExtractedDocument(
        title=title,
        language=language,
        body=body,
        excerpt=excerpt,
        url=url,
        noindex=noindex,
        boost=boost,
        facets=facets,
        range_facets=range_facets,
        pins=pins,
        metadata=metadata,
    )


def extract_document(
    html: str,
    source_url: str,
    default_language: str = "en",
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
) -> ExtractedDocument:
    tree = HTMLParser(html)
    return _extract(tree, source_url, default_language, allowed_url_origins, canonical_base_url)


def _walk_sections(
    root: Node,
    level_map: dict[str, int],
    stack: list[dict[str, Any]],
    out: list[dict[str, Any]],
) -> None:
    """Walk the body in document order, pushing a frame for every selected
    heading. Content is attributed to the deepest open heading's frame, so
    nested selected section content is never duplicated into a parent
    section."""
    cur = root.child
    while cur is not None:
        if cur.tag == _TEXT_NODE_TAG:
            if stack and cur.text().strip():
                stack[-1]["parts"].append(_collapse_whitespace(cur.text()))
        else:
            level = level_map.get(cur.tag)
            if level is not None:
                while stack and stack[-1]["level"] >= level:
                    stack.pop()
                frame = {
                    "level": level,
                    "title": _collapse_whitespace(cur.text(deep=True, separator=" ")),
                    "anchor": (cur.attributes.get("id") or "").strip(),
                    "parts": [],
                }
                stack.append(frame)
                out.append(frame)
            else:
                _walk_sections(cur, level_map, stack, out)
        cur = cur.next


def _collect_until_first_heading(
    node: Node,
    level_map: dict[str, int],
    parts: list[str],
) -> bool:
    cur = node.child
    while cur is not None:
        if cur.tag == _TEXT_NODE_TAG:
            if cur.text().strip():
                parts.append(_collapse_whitespace(cur.text()))
        else:
            if cur.tag in level_map:
                return True
            if _collect_until_first_heading(cur, level_map, parts):
                return True
        cur = cur.next
    return False


def extract_pre_section_body(
    tree: HTMLParser,
    selectors: tuple[str, ...],
) -> str:
    """Return the collapsed text that precedes the first selected heading.

    Used by sections-only indexing to preserve introductory content that is
    not owned by any section.
    """
    level_map: dict[str, int] = {}
    for selector in selectors:
        level_map[selector] = _HEADING_LEVELS[selector]

    body_node = (
        tree.css_first("[data-searchable-body]") or tree.css_first("main") or tree.css_first("body")
    )
    if body_node is None or not body_node.child:
        return ""
    parts: list[str] = []
    _collect_until_first_heading(body_node, level_map, parts)
    return " ".join(parts)


def extract_sections(
    tree: HTMLParser,
    page_url: str,
    page_title: str,
    selectors: tuple[str, ...],
) -> list[ExtractedSection]:
    """Split a parsed page into heading-bounded sections.

    Every selected HTML heading narrows the section boundaries (by HTML
    heading level rather than selector order). Only headings that carry a
    usable ``id`` become indexable sections; headings without an id act as
    boundaries but produce no document. Anchors must be stable and unique.
    """
    level_map: dict[str, int] = {}
    for selector in selectors:
        level_map[selector] = _HEADING_LEVELS[selector]

    body_node = (
        tree.css_first("[data-searchable-body]") or tree.css_first("main") or tree.css_first("body")
    )
    if body_node is None:
        return []

    frames: list[dict[str, Any]] = []
    _walk_sections(body_node, level_map, [], frames)

    page_base = page_url.split("#", 1)[0]
    seen_urls: set[str] = set()
    sections: list[ExtractedSection] = []
    for frame in frames:
        anchor = frame["anchor"]
        if not anchor:
            _warn(
                f'heading "{frame["title"]}" on {page_url} has no "id" -- '
                "skipping section indexing for it"
            )
            continue
        body = " ".join(frame["parts"])
        section_url = f"{page_base}#{anchor}"
        if section_url in seen_urls:
            _warn(
                f'duplicate section URL "{section_url}" on {page_url} -- '
                "skipping the later duplicate"
            )
            continue
        title = frame["title"]
        if not title and not body:
            continue
        seen_urls.add(section_url)
        sections.append(
            ExtractedSection(
                title=title,
                page_title=page_title,
                body=body,
                url=section_url,
                anchor=anchor,
                heading_level=frame["level"],
            )
        )
    return sections

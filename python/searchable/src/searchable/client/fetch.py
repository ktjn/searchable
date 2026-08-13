import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, cast


def resolve_url(base_url: str, rel_path: str) -> str:
    return urllib.parse.urljoin(base_url, rel_path)


def _read_bytes(url: str) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme in ("http", "https"):
        with urllib.request.urlopen(url) as response:  # noqa: S310 -- deliberate: this is the client's whole job
            if response.status >= 400:
                raise RuntimeError(f"failed to fetch {url}: {response.status}")
            return response.read()  # type: ignore[no-any-return]
    if parsed.scheme == "file":
        path = Path(urllib.request.url2pathname(parsed.path))
    else:
        path = Path(url)
    return path.read_bytes()


class ShardCache:
    def __init__(self) -> None:
        self._json_cache: dict[str, Any] = {}
        self._bytes_cache: dict[str, bytes] = {}

    def fetch_json(self, url: str) -> dict[str, Any]:
        if url in self._json_cache:
            return cast(dict[str, Any], self._json_cache[url])
        data = cast(dict[str, Any], json.loads(_read_bytes(url)))
        self._json_cache[url] = data
        return data

    def fetch_bytes(self, url: str) -> bytes:
        if url in self._bytes_cache:
            return self._bytes_cache[url]
        data = _read_bytes(url)
        self._bytes_cache[url] = data
        return data

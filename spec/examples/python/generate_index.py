#!/usr/bin/env python3
"""
Minimal reference generator proving the index format needs no library
beyond the standard library (json, hashlib, re) -- deliberately
independent of this repo's own TypeScript packages, sharing no code
with the real indexer. See docs/concepts/index-format.md and
docs/concepts/architecture.md.

Usage: python3 generate_index.py documents.json out/
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone


def tokenize(text):
    stripped = re.sub(r"<[^>]+>", " ", text)
    return re.findall(r"[a-z0-9]+", stripped.lower())


def write_json(out_dir, rel_path, data):
    content = json.dumps(data)
    digest = hashlib.sha256(content.encode()).hexdigest()[:8]
    hashed_rel = re.sub(r"\.json$", f".{digest}.json", rel_path)
    abs_path = os.path.join(out_dir, hashed_rel)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w") as f:
        f.write(content)
    return hashed_rel


def main():
    input_file, out_dir = sys.argv[1], sys.argv[2]
    with open(input_file) as f:
        docs = json.load(f)

    terms = {}
    doc_store = {}
    title_len_sum = 0
    body_len_sum = 0

    for doc in docs:
        title_tokens = tokenize(doc["title"])
        body_tokens = tokenize(doc["body"])
        title_len_sum += len(title_tokens)
        body_len_sum += len(body_tokens)

        for field, tokens in (("title", title_tokens), ("body", body_tokens)):
            positions_by_term = {}
            for pos, term in enumerate(tokens):
                positions_by_term.setdefault(term, []).append(pos)
            for term, positions in positions_by_term.items():
                entry = terms.setdefault(term, {"df": 0, "postings": []})
                posting = next(
                    (p for p in entry["postings"] if p["doc"] == doc["id"]), None
                )
                if posting is None:
                    posting = {"doc": doc["id"], "fields": {}}
                    entry["postings"].append(posting)
                    entry["df"] += 1
                posting["fields"][field] = {
                    "tf": len(positions),
                    "pos": positions,
                    "len": len(tokens),
                }

        doc_store[str(doc["id"])] = {
            "url": doc["url"],
            "fields": {"title": doc["title"], "excerpt": doc["body"][:200]},
        }

    terms_file = write_json(out_dir, "terms/en/all.json", terms)
    docs_file = write_json(out_dir, "docs/0.json", doc_store)
    ids = [d["id"] for d in docs]

    manifest = {
        "version": 2,
        "buildId": datetime.now(timezone.utc).isoformat(),
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {
            "title": {"boost": 1.0, "stored": True},
            "body": {"boost": 1.0, "stored": False},
        },
        "docCount": {"en": len(docs)},
        "avgFieldLength": {
            "en": {
                "title": title_len_sum / len(docs),
                "body": body_len_sum / len(docs),
            }
        },
        "shards": {
            "terms": [
                {
                    "lang": "en",
                    "prefix": "all",
                    "file": terms_file,
                    "termCount": len(terms),
                }
            ],
            "docs": [
                {"shard": 0, "file": docs_file, "idRange": [min(ids), max(ids)]}
            ],
        },
    }

    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    print(f"indexed {len(docs)} document(s) -> {out_dir}")


if __name__ == "__main__":
    main()

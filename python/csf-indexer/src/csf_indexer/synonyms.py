from csf_analysis import get_language_profile, normalize_phrase

# Direct port of packages/indexer/src/build-index.ts's buildSynonymShards.


def _normalize_dedup(terms: list[str], normalize) -> list[str]:
    return list(dict.fromkeys(filter(None, (normalize(t) for t in terms))))


def build_synonym_shards(raw_synonyms: dict[str, dict] | None) -> dict[str, dict]:
    synonym_shards: dict[str, dict] = {}
    if not raw_synonyms:
        return synonym_shards

    for language, source in raw_synonyms.items():
        profile = get_language_profile(language)

        def normalize(term: str, _profile=profile) -> str:
            return normalize_phrase(term, _profile)

        equivalences = []
        for group in source.get("equivalences", []):
            normalized_group = _normalize_dedup(group, normalize)
            if len(normalized_group) >= 2:
                equivalences.append(normalized_group)

        directional: dict[str, list[str]] = {}
        for key, targets in source.get("directional", {}).items():
            normalized_key = normalize(key)
            if not normalized_key:
                continue
            normalized_targets = _normalize_dedup(targets, normalize)
            if not normalized_targets:
                continue
            directional[normalized_key] = normalized_targets

        multi_word = []
        for group in source.get("multiWord", []):
            normalized_group = _normalize_dedup(group, normalize)
            if len(normalized_group) >= 2:
                multi_word.append(normalized_group)

        shard: dict = {}
        if equivalences:
            shard["equivalences"] = equivalences
        if directional:
            shard["directional"] = directional
        if multi_word:
            shard["multiWord"] = multi_word
        synonym_shards[language] = shard

    return synonym_shards

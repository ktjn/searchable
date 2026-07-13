from searchable_analysis.language_profile import (
    LanguageProfile,
    chinese,
    english,
    german,
    japanese,
    khmer,
    lao,
    thai,
)

# The one place indexer and runtime both look up a LanguageProfile by
# code, so "is language X supported" can never answer differently on
# the two sides. Plain dict lookups are safe here (unlike the TS
# original's ownProp() guard) -- Python dicts have no prototype chain
# for an attacker-controlled key like "constructor" to walk.
_PROFILES: dict[str, LanguageProfile] = {
    "en": english,
    "de": german,
    "zh": chinese,
    "ja": japanese,
    "th": thai,
    "km": khmer,
    "lo": lao,
}


def get_language_profile(code: str) -> LanguageProfile:
    profile = _PROFILES.get(code)
    if profile is None:
        raise ValueError(f'no LanguageProfile registered for "{code}"')
    return profile


def get_registered_language_codes() -> list[str]:
    return list(_PROFILES.keys())

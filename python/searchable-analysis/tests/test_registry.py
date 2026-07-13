import pytest

from searchable_analysis.language_profile import english, norwegian, norwegian_bokmal, norwegian_nynorsk
from searchable_analysis.registry import get_language_profile, get_registered_language_codes


def test_get_language_profile_returns_the_registered_profile():
    assert get_language_profile("en") is english


def test_get_language_profile_raises_for_unregistered_code():
    with pytest.raises(ValueError, match='no LanguageProfile registered for "xx"'):
        get_language_profile("xx")


def test_get_registered_language_codes_lists_all_twelve():
    codes = get_registered_language_codes()
    assert codes == ["en", "de", "sv", "nl", "nb", "nn", "no", "zh", "ja", "th", "km", "lo"]


def test_norwegian_codes_are_explicit_and_share_stemming():
    assert get_language_profile("nb") is norwegian_bokmal
    assert get_language_profile("nn") is norwegian_nynorsk
    assert get_language_profile("no") is norwegian
    assert norwegian_bokmal.stem is norwegian_nynorsk.stem is norwegian.stem

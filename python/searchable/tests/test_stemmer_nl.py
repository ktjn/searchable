from searchable.analysis.stemmer_nl import stem_dutch
from tests.snowball_fixture import assert_snowball_vocabulary


def test_dutch_snowball_vocabulary():
    assert_snowball_vocabulary("dutch", stem_dutch)

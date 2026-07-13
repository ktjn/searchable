from searchable_analysis.stemmer_sv import stem_swedish
from tests.snowball_fixture import assert_snowball_vocabulary


def test_swedish_snowball_vocabulary():
    assert_snowball_vocabulary("swedish", stem_swedish)

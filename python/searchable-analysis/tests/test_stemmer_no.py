from searchable_analysis.stemmer_no import stem_norwegian
from tests.snowball_fixture import assert_snowball_vocabulary


def test_norwegian_snowball_vocabulary():
    assert_snowball_vocabulary("norwegian", stem_norwegian)

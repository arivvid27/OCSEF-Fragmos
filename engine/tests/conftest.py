import pytest


@pytest.fixture(scope="session")
def presidio():
    """Loading spaCy en_core_web_lg and the names model takes seconds, so every test module shares one detector."""
    from sentinel.presidio_detector import PresidioDetector

    return PresidioDetector()

_RTL_LANGUAGE_CODES = {"ar", "he", "fa", "ur", "ps", "sd", "yi", "dv", "ku", "ckb"}


def is_rtl_language(code: str) -> bool:
    primary_subtag = code.split("-")[0].lower() if code else ""
    return primary_subtag in _RTL_LANGUAGE_CODES

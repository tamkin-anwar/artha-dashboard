from flask import request


def is_ajax_request() -> bool:
    """True when the request expects a JSON response rather than a full page."""
    xrw = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    accept_json = "application/json" in (request.headers.get("Accept") or "")
    return xrw or accept_json or request.path.startswith("/api/")

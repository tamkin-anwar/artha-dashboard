from flask import Blueprint

ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")

from . import routes  # noqa: E402, F401

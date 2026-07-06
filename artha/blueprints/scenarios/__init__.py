from flask import Blueprint

scenarios_bp = Blueprint("scenarios", __name__, url_prefix="/scenarios")

from . import routes  # noqa: E402, F401

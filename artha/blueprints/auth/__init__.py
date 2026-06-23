from flask import Blueprint

auth_bp = Blueprint("auth", __name__)

# Must be imported AFTER auth_bp is defined to avoid circular imports
from . import routes  # noqa: E402, F401

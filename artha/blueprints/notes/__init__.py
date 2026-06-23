from flask import Blueprint

notes_bp = Blueprint("notes", __name__)

from . import routes  # noqa: E402, F401

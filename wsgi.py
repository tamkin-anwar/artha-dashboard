import os
import logging

logging.basicConfig(level=logging.INFO)

from artha import create_app

_is_production = bool(os.environ.get("RENDER")) or (
    os.environ.get("FLASK_ENV") == "production"
)
config_name = "production" if _is_production else "development"

app = create_app(config_name)

if __name__ == "__main__":
    app.run(debug=not _is_production)

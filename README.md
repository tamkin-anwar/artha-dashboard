# Artha Dashboard

Artha is a personal finance and productivity dashboard built with Flask.

## Features
- Income & expense tracking with live charts
- Inline transaction editing
- Undo delete with toast notifications
- Notes widget
- Calculator & calendar widgets
- Dark/light theme
- Offline support (PWA-ready)

## Tech Stack
- Flask + SQLAlchemy
- Vanilla JavaScript (modular)
- Chart.js
- Tailwind-style utility CSS
- Service Worker (PWA)

## Setup
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py

"""One-time backfill: re-derive title/preview for every existing note.

Notes saved before this change have title=None (rendered as "Untitled"
even when they have content) or a title/preview that was never validated
against the new server-side derivation logic, and none of them have a
`preview` value at all yet (the column was just added). This recomputes
both from each note's stored content using the same
artha.utils.derive_title_and_preview() the live routes now use, so
historical notes match what a fresh save would produce.

Usage:
    python scripts/backfill_note_title_preview.py            # dry run — prints a diff, writes nothing
    python scripts/backfill_note_title_preview.py --commit    # applies the changes (requires the
                                                                # 496646237e1d migration to be applied first)

Only touches title/preview. Never rewrites `content`, `position`, or
`created_at`, and does not bump `updated_at` (this is a data-quality
backfill, not a real user edit).

The dry-run read deliberately goes through raw SQL selecting only the
pre-migration columns (id, user_id, title, content) rather than the ORM
model, so it can report what *would* change even before the
`preview`/`updated_at` columns exist — the Note model already expects
them, so `Note.query` would fail with "no such column" on an
unmigrated DB.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from artha import create_app
from artha.extensions import db
from artha.utils import derive_title_and_preview


def _resolve_config_name() -> str:
    """Mirror wsgi.py's own production/development resolution exactly, so
    this script targets the same DB the running app would — RENDER is set
    automatically by Render's platform; FLASK_ENV=production is the local
    opt-in for pointing at a non-default DB on purpose. create_app() with
    no argument always resolves to development/SQLite regardless of
    environment, which is NOT what we want when this runs in a production
    shell."""
    is_production = bool(os.environ.get("RENDER")) or (
        os.environ.get("FLASK_ENV") == "production"
    )
    return "production" if is_production else "development"


def _fmt(value, width=40):
    s = "<None>" if value is None else repr(value)
    if len(s) > width:
        s = s[: width - 1] + "…"
    return s


def _compute_changes():
    rows = db.session.execute(
        text("SELECT id, user_id, title, content FROM note ORDER BY id ASC")
    ).all()

    changed = []
    for row in rows:
        derived_title, derived_preview = derive_title_and_preview(row.content)
        new_title = row.title or derived_title
        new_preview = derived_preview
        if new_title != row.title:
            changed.append((row.id, row.user_id, row.title, new_title, new_preview))
    return len(rows), changed


def _masked_db_uri(uri: str) -> str:
    """Redact credentials before printing — this still runs in dry-run
    mode by default, so the URI ends up in terminal scrollback either way."""
    if "@" in uri and "://" in uri:
        scheme, rest = uri.split("://", 1)
        _, _, host_part = rest.partition("@")
        return f"{scheme}://***:***@{host_part}"
    return uri


def run(commit: bool) -> None:
    config_name = _resolve_config_name()
    app = create_app(config_name)
    print(f"config: {config_name}  |  db: {_masked_db_uri(app.config['SQLALCHEMY_DATABASE_URI'])}\n")

    with app.app_context():
        total, changed = _compute_changes()

        print(f"Scanned {total} note(s); {len(changed)} would have a title change (preview is new for all rows).\n")

        for note_id, user_id, old_title, new_title, new_preview in changed:
            print(f"note id={note_id} (user_id={user_id})")
            print(f"  title:   {_fmt(old_title)}  ->  {_fmt(new_title)}")
            print(f"  preview: <None>  ->  {_fmt(new_preview)}")
            print()

        if not commit:
            print("Dry run only — no changes written. Re-run with --commit to apply.")
            return

        # By the time --commit runs, the migration has been applied and the
        # ORM model matches the schema — safe to use it for the write.
        from artha.models import Note

        write_count = 0
        for note in Note.query.order_by(Note.id.asc()).all():
            derived_title, derived_preview = derive_title_and_preview(note.content)
            note.title = note.title or derived_title
            note.preview = derived_preview
            write_count += 1

        db.session.commit()
        print(f"Committed preview for {write_count} note(s) ({len(changed)} also got a new title).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", action="store_true", help="write changes to the DB (default is dry-run)")
    args = parser.parse_args()
    run(commit=args.commit)
    sys.exit(0)

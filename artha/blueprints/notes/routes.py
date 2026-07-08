import time
import logging

from flask import render_template, redirect, url_for, request, flash, session, jsonify
from flask_login import login_required, current_user
from sqlalchemy import func

from ...extensions import db
from ...models import Note
from ...utils import is_ajax_request
from . import notes_bp

log = logging.getLogger(__name__)


@notes_bp.route("/notes", methods=["GET", "POST"])
@login_required
def notes_page():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        content = request.form.get("content", "").strip()

        if not content:
            flash("Note content is required.", "error")
            return redirect(url_for("notes.notes_page"))

        max_pos = (
            db.session.query(func.max(Note.position))
            .filter_by(user_id=current_user.id)
            .scalar()
            or 0
        )
        new_note = Note(
            title=title or None,
            content=content,
            user_id=current_user.id,
            position=int(max_pos) + 1,
        )

        try:
            db.session.add(new_note)
            db.session.commit()
            flash("Note added!", "success")
        except Exception as e:
            db.session.rollback()
            log.error("Error adding note: %s", e, exc_info=True)
            flash("Error adding note", "error")

        return redirect(url_for("notes.notes_page"))

    notes = (
        Note.query.filter_by(user_id=current_user.id)
        .order_by(Note.position.asc(), Note.id.asc())
        .all()
    )
    return render_template("notes.html", notes=notes)


@notes_bp.route("/update_note/<int:note_id>", methods=["POST"])
@login_required
def update_note(note_id):
    note = db.session.get(Note, note_id)
    if note is None:
        return jsonify({"message": "Not found"}), 404
    if note.user_id != current_user.id:
        return jsonify({"message": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"message": "Empty content"}), 400

    note.content = content
    try:
        db.session.commit()
        return jsonify({"message": "Note updated"})
    except Exception as e:
        db.session.rollback()
        log.error("Error updating note: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@notes_bp.route("/reorder_notes", methods=["POST"])
@login_required
def reorder_notes():
    data = request.get_json(silent=True) or {}
    order = data.get("order")

    if not isinstance(order, list) or not order:
        return jsonify({"message": "Invalid order payload."}), 400

    try:
        ids = [int(x) for x in order]
    except Exception:
        return jsonify({"message": "Order must be a list of integers."}), 400

    notes = Note.query.filter(
        Note.user_id == current_user.id, Note.id.in_(ids)
    ).all()

    if {n.id for n in notes} != set(ids):
        return jsonify({"message": "Order contains unknown or unauthorized note ids."}), 403

    id_to_note = {n.id: n for n in notes}
    for idx, note_id in enumerate(ids, start=1):
        id_to_note[note_id].position = idx

    try:
        db.session.commit()
        return jsonify({"message": "Note order saved."})
    except Exception as e:
        db.session.rollback()
        log.error("Error saving note order: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@notes_bp.route("/delete_note/<int:note_id>", methods=["POST"])
@login_required
def delete_note(note_id):
    note = db.session.get(Note, note_id)
    if note is None:
        if is_ajax_request():
            return jsonify({"message": "Not found"}), 404
        flash("Note not found", "error")
        return redirect(url_for("dashboard.index"))

    if note.user_id != current_user.id:
        if is_ajax_request():
            return jsonify({"message": "Unauthorized"}), 403
        flash("Unauthorized action", "error")
        return redirect(url_for("dashboard.index"))

    session["last_deleted_note"] = {
        "user_id": note.user_id,
        "content": note.content,
        "position": int(note.position or 0),
        "deleted_at": time.time(),
    }

    try:
        db.session.delete(note)
        db.session.commit()
        if is_ajax_request():
            return jsonify({"message": "Note deleted", "can_undo": True})
        flash("Note deleted.", "success")
        return redirect(url_for("dashboard.index"))
    except Exception as e:
        db.session.rollback()
        log.error("Error deleting note: %s", e, exc_info=True)
        if is_ajax_request():
            return jsonify({"message": "Error deleting note"}), 500
        flash("Error deleting note", "error")
        return redirect(url_for("dashboard.index"))


@notes_bp.route("/undo_delete_note", methods=["POST"])
@login_required
def undo_delete_note():
    data = session.get("last_deleted_note")

    if not data or data.get("user_id") != current_user.id:
        return jsonify({"message": "Nothing to undo."}), 400

    if time.time() - float(data.get("deleted_at", 0)) > 10:
        session.pop("last_deleted_note", None)
        return jsonify({"message": "Undo window expired."}), 400

    try:
        restored_pos = int(data.get("position") or 0)
        if restored_pos <= 0:
            max_pos = (
                db.session.query(func.max(Note.position))
                .filter_by(user_id=current_user.id)
                .scalar()
                or 0
            )
            restored_pos = int(max_pos) + 1
        else:
            Note.query.filter(
                Note.user_id == current_user.id,
                Note.position >= restored_pos,
            ).update({Note.position: Note.position + 1}, synchronize_session=False)

        restored = Note(
            content=data["content"],
            user_id=current_user.id,
            position=restored_pos,
        )
        db.session.add(restored)
        db.session.commit()
        session.pop("last_deleted_note", None)

        row_html = render_template("partials/note_row.html", note=restored)
        return jsonify({"message": "Note restored.", "row_html": row_html})
    except Exception as e:
        db.session.rollback()
        log.error("Error undoing note delete: %s", e, exc_info=True)
        return jsonify({"message": "Error restoring note"}), 500

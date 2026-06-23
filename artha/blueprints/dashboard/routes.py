import logging

from flask import render_template, redirect, url_for, request, flash, jsonify
from flask_login import login_required, current_user
from sqlalchemy import func

from ...extensions import db
from ...models import Note, Transaction
from . import dashboard_bp

log = logging.getLogger(__name__)


@dashboard_bp.get("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


@dashboard_bp.route("/", methods=["GET", "POST"])
@login_required
def index():
    if request.method == "POST":
        note_content = request.form.get("note", "").strip()
        if note_content:
            max_pos = (
                db.session.query(func.max(Note.position))
                .filter_by(user_id=current_user.id)
                .scalar()
                or 0
            )
            new_note = Note(
                content=note_content,
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
        return redirect(url_for("dashboard.index"))

    notes = (
        Note.query.filter_by(user_id=current_user.id)
        .order_by(Note.position.asc(), Note.id.asc())
        .all()
    )
    transactions = (
        Transaction.query.filter_by(user_id=current_user.id)
        .order_by(Transaction.position.asc(), Transaction.id.asc())
        .all()
    )
    income = (
        db.session.query(func.sum(Transaction.amount))
        .filter_by(user_id=current_user.id, type="income")
        .scalar()
        or 0
    )
    expense = (
        db.session.query(func.sum(Transaction.amount))
        .filter_by(user_id=current_user.id, type="expense")
        .scalar()
        or 0
    )

    return render_template(
        "index.html",
        notes=notes,
        transactions=transactions,
        income=float(income),
        expense=float(expense),
        balance=float(income - expense),
    )

import calendar
import time
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from flask import render_template, redirect, url_for, request, flash, session, jsonify
from flask_login import login_required, current_user
from sqlalchemy import func

from ...extensions import db
from ...models import Transaction
from ...utils import is_ajax_request
from . import finance_bp

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

class ValidationError(Exception):
    pass


def _validate_amount(amount_str: str) -> Decimal:
    """Parse and validate a user-supplied amount string → Decimal."""
    try:
        amount = Decimal(str(amount_str))
    except InvalidOperation:
        raise ValidationError("Invalid amount format.")
    if amount < 0:
        raise ValidationError("Amount must be non-negative.")
    return amount


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@finance_bp.route("/add_transaction", methods=["POST"])
@login_required
def add_transaction():
    description = request.form.get("description", "").strip()
    amount_str = request.form.get("amount", "").strip()
    t_type = request.form.get("type", "").strip()

    if not description:
        msg = "Description is required."
        return (jsonify({"message": msg}), 400) if is_ajax_request() else (flash(msg, "error"), redirect(url_for("dashboard.index")))[1]

    try:
        amount = _validate_amount(amount_str)
    except ValidationError as exc:
        msg = str(exc)
        if is_ajax_request():
            return jsonify({"message": msg}), 400
        flash(msg, "error")
        return redirect(url_for("dashboard.index"))

    if t_type not in ("income", "expense"):
        msg = "Invalid transaction type."
        if is_ajax_request():
            return jsonify({"message": msg}), 400
        flash(msg, "error")
        return redirect(url_for("dashboard.index"))

    max_pos = (
        db.session.query(func.max(Transaction.position))
        .filter_by(user_id=current_user.id)
        .scalar()
        or 0
    )
    new_tx = Transaction(
        description=description,
        amount=amount,
        type=t_type,
        user_id=current_user.id,
        position=int(max_pos) + 1,
    )

    try:
        db.session.add(new_tx)
        db.session.commit()
        if is_ajax_request():
            return render_template("partials/transaction_row.html", tx=new_tx)
        flash("Transaction added!", "success")
        return redirect(url_for("dashboard.index"))
    except Exception as e:
        db.session.rollback()
        log.error("Error adding transaction: %s", e, exc_info=True)
        msg = "Error adding transaction"
        if is_ajax_request():
            return jsonify({"message": msg}), 500
        flash(msg, "error")
        return redirect(url_for("dashboard.index"))


@finance_bp.route("/update_transaction/<int:transaction_id>", methods=["POST"])
@login_required
def update_transaction(transaction_id):
    tx = db.session.get(Transaction, transaction_id)
    if tx is None:
        return jsonify({"message": "Not found"}), 404
    if tx.user_id != current_user.id:
        return jsonify({"message": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    desc = (data.get("description") or tx.description).strip()
    t_type = data.get("type") or tx.type

    try:
        amount = Decimal(str(data.get("amount", tx.amount)))
        if amount < 0:
            return jsonify({"message": "Amount must be non-negative."}), 400
    except InvalidOperation:
        return jsonify({"message": "Invalid amount format."}), 400

    if t_type not in ("income", "expense"):
        return jsonify({"message": "Invalid transaction type."}), 400

    tx.description = desc
    tx.amount = amount
    tx.type = t_type

    try:
        db.session.commit()
        return jsonify({"message": "Transaction updated successfully"})
    except Exception as e:
        db.session.rollback()
        log.error("Error updating transaction: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@finance_bp.route("/reorder_transactions", methods=["POST"])
@login_required
def reorder_transactions():
    data = request.get_json(silent=True) or {}
    order = data.get("order")

    if not isinstance(order, list) or not order:
        return jsonify({"message": "Invalid order payload."}), 400

    try:
        ids = [int(x) for x in order]
    except Exception:
        return jsonify({"message": "Order must be a list of integers."}), 400

    txs = Transaction.query.filter(
        Transaction.user_id == current_user.id,
        Transaction.id.in_(ids),
    ).all()

    if {t.id for t in txs} != set(ids):
        return jsonify({"message": "Order contains unknown or unauthorized transaction ids."}), 403

    id_to_tx = {t.id: t for t in txs}
    for idx, tx_id in enumerate(ids, start=1):
        id_to_tx[tx_id].position = idx

    try:
        db.session.commit()
        return jsonify({"message": "Transaction order saved."})
    except Exception as e:
        db.session.rollback()
        log.error("Error saving transaction order: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@finance_bp.route("/delete_transaction/<int:transaction_id>", methods=["POST"])
@login_required
def delete_transaction(transaction_id):
    tx = db.session.get(Transaction, transaction_id)
    if tx is None:
        if is_ajax_request():
            return jsonify({"message": "Not found"}), 404
        flash("Transaction not found", "error")
        return redirect(url_for("dashboard.index"))

    if tx.user_id != current_user.id:
        if is_ajax_request():
            return jsonify({"message": "Unauthorized"}), 403
        flash("Unauthorized", "error")
        return redirect(url_for("dashboard.index"))

    # Store as string — Decimal is not JSON-serialisable
    session["last_deleted_tx"] = {
        "user_id": tx.user_id,
        "description": tx.description,
        "amount": str(tx.amount),
        "type": tx.type,
        "position": int(tx.position or 0),
        "timestamp": (
            tx.timestamp.replace(tzinfo=timezone.utc).isoformat()
            if tx.timestamp
            else datetime.now(timezone.utc).isoformat()
        ),
        "deleted_at": time.time(),
    }

    try:
        db.session.delete(tx)
        db.session.commit()
        if is_ajax_request():
            return jsonify({"message": "Transaction deleted", "can_undo": True})
        flash("Transaction deleted!", "success")
        return redirect(url_for("dashboard.index"))
    except Exception as e:
        db.session.rollback()
        log.error("Error deleting transaction: %s", e, exc_info=True)
        if is_ajax_request():
            return jsonify({"message": "Error deleting transaction"}), 500
        flash("Error deleting transaction", "error")
        return redirect(url_for("dashboard.index"))


@finance_bp.route("/undo_delete_transaction", methods=["POST"])
@login_required
def undo_delete_transaction():
    data = session.get("last_deleted_tx")

    if not data or data.get("user_id") != current_user.id:
        return jsonify({"message": "Nothing to undo."}), 400

    if time.time() - float(data.get("deleted_at", 0)) > 10:
        session.pop("last_deleted_tx", None)
        return jsonify({"message": "Undo window expired."}), 400

    try:
        ts = None
        try:
            ts = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
        except Exception:
            ts = None

        restored_pos = int(data.get("position") or 0)
        if restored_pos <= 0:
            max_pos = (
                db.session.query(func.max(Transaction.position))
                .filter_by(user_id=current_user.id)
                .scalar()
                or 0
            )
            restored_pos = int(max_pos) + 1
        else:
            Transaction.query.filter(
                Transaction.user_id == current_user.id,
                Transaction.position >= restored_pos,
            ).update(
                {Transaction.position: Transaction.position + 1},
                synchronize_session=False,
            )

        restored = Transaction(
            description=data["description"],
            amount=Decimal(data["amount"]),
            type=data["type"],
            user_id=current_user.id,
            position=restored_pos,
            timestamp=ts or db.func.current_timestamp(),
        )
        db.session.add(restored)
        db.session.commit()
        session.pop("last_deleted_tx", None)

        row_html = render_template("partials/transaction_row.html", tx=restored)
        return jsonify({"message": "Transaction restored.", "row_html": row_html})
    except Exception as e:
        db.session.rollback()
        log.error("Error undoing delete: %s", e, exc_info=True)
        return jsonify({"message": "Error restoring transaction"}), 500


@finance_bp.get("/api/finance_totals")
@login_required
def finance_totals():
    """
    Direct DB query — the in-memory cache has been removed.

    Why: the old `finance_cache = {}` was a module-level dict that breaks
    under Gunicorn multi-worker deployments (each worker has its own copy).
    A single PostgreSQL aggregate query is fast enough for one user's data
    and is always correct across all workers.
    """
    uid = current_user.id

    income = (
        db.session.query(func.sum(Transaction.amount))
        .filter_by(user_id=uid, type="income")
        .scalar()
        or Decimal("0")
    )
    expense = (
        db.session.query(func.sum(Transaction.amount))
        .filter_by(user_id=uid, type="expense")
        .scalar()
        or Decimal("0")
    )
    balance = income - expense

    return jsonify({
        "income": float(income),
        "expense": float(expense),
        "balance": float(balance),
    })


# ---------------------------------------------------------------------------
# Monthly Tabs — full finance page with month-by-month filtering
# ---------------------------------------------------------------------------

def _month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def _prev_month_start(d: date) -> date:
    last_day_of_prev = _month_start(d.year, d.month) - timedelta(days=1)
    return _month_start(last_day_of_prev.year, last_day_of_prev.month)


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


@finance_bp.route("/finance")
@login_required
def finance_page():
    """
    Full finance page with month-by-month filtering.

    Query param:
        ?month=YYYY-MM  — show that month only
        ?month=all      — show all-time (unfiltered), like the old view
        (none)          — defaults to the current month
    """
    uid = current_user.id
    all_tx = (
        Transaction.query.filter_by(user_id=uid)
        .order_by(Transaction.position.asc(), Transaction.id.asc())
        .all()
    )

    today = date.today()
    month_param = (request.args.get("month") or "").strip()
    all_time = month_param == "all"

    if not all_time and month_param:
        try:
            sel_year, sel_month = (int(part) for part in month_param.split("-", 1))
            selected_date = _month_start(sel_year, sel_month)
        except (ValueError, TypeError):
            selected_date = _month_start(today.year, today.month)
    else:
        selected_date = _month_start(today.year, today.month)

    # Bucket every transaction by "YYYY-MM" once, rather than re-scanning
    # the full list for every month we need totals for.
    buckets = defaultdict(lambda: {"income": Decimal("0"), "expense": Decimal("0"), "txs": []})
    for tx in all_tx:
        if not tx.timestamp:
            continue
        key = tx.timestamp.strftime("%Y-%m")
        bucket = buckets[key]
        bucket["txs"].append(tx)
        if tx.type == "income":
            bucket["income"] += tx.amount
        elif tx.type == "expense":
            bucket["expense"] += tx.amount

    def bucket_for(d: date) -> dict:
        return buckets.get(d.strftime("%Y-%m"), {"income": Decimal("0"), "expense": Decimal("0"), "txs": []})

    # Last 12 months (oldest -> newest, ending at the current month) for the tab row.
    last_12 = []
    cursor_year, cursor_month = today.year, today.month
    for _ in range(12):
        last_12.append(_month_start(cursor_year, cursor_month))
        cursor_month -= 1
        if cursor_month == 0:
            cursor_month = 12
            cursor_year -= 1
    last_12.reverse()

    month_tabs = []
    for d in last_12:
        b = bucket_for(d)
        month_tabs.append({
            "value": d.strftime("%Y-%m"),
            "label": f"{calendar.month_abbr[d.month]} {d.year}",
            "net": float(b["income"] - b["expense"]),
            "is_current": (d.year == today.year and d.month == today.month),
        })

    if all_time:
        transactions = all_tx
        income = sum((t.amount for t in all_tx if t.type == "income"), Decimal("0"))
        expense = sum((t.amount for t in all_tx if t.type == "expense"), Decimal("0"))
        selected_month_value = "all"
        selected_month_label = "All time"
    else:
        b = bucket_for(selected_date)
        transactions = b["txs"]
        income = b["income"]
        expense = b["expense"]
        selected_month_value = selected_date.strftime("%Y-%m")
        selected_month_label = f"{calendar.month_name[selected_date.month]} {selected_date.year}"

    balance = income - expense

    # Comparison vs. the previous month — meaningless for "all time".
    comparison = None
    if not all_time:
        prev_bucket = bucket_for(_prev_month_start(selected_date))
        prev_income = prev_bucket["income"]
        prev_expense = prev_bucket["expense"]
        prev_balance = prev_income - prev_expense

        def _cmp(curr: Decimal, prev: Decimal, higher_is_better: bool) -> dict:
            delta = curr - prev
            up = delta >= 0
            favorable = up if higher_is_better else not up
            return {"delta": float(abs(delta)), "up": up, "favorable": favorable}

        comparison = {
            "income": _cmp(income, prev_income, True),
            "expense": _cmp(expense, prev_expense, False),
            "net": _cmp(balance, prev_balance, True),
        }

    savings_rate = float((balance / income) * 100) if income > 0 else 0.0

    # Biggest expense "category" (first word of the description, per spec)
    # and the single day of the month with the most spending.
    expense_txs = [t for t in transactions if t.type == "expense"] if not all_time else [
        t for t in all_tx if t.type == "expense"
    ]

    category_totals: dict[str, Decimal] = defaultdict(Decimal)
    day_totals: dict[int, Decimal] = defaultdict(Decimal)
    for t in expense_txs:
        first_word = (t.description or "").strip().split(" ")[0] if (t.description or "").strip() else "Other"
        category_totals[first_word.capitalize()] += t.amount
        if t.timestamp:
            day_totals[t.timestamp.day] += t.amount

    biggest_category = max(category_totals.items(), key=lambda kv: kv[1])[0] if category_totals else None
    biggest_day = max(day_totals.items(), key=lambda kv: kv[1])[0] if day_totals else None
    biggest_day_label = f"The {_ordinal(biggest_day)}" if biggest_day else None

    # 6-month trend for the bar chart (oldest -> newest). Trim any leading
    # months with no transactions so a new user with 1-2 months of history
    # doesn't see 4-5 empty bars — but still cap the window at 6 months.
    last_6 = last_12[-6:]
    months_with_data = [i for i, d in enumerate(last_6) if bucket_for(d)["txs"]]
    trend_start = months_with_data[0] if months_with_data else len(last_6) - 1
    trend_months = last_6[trend_start:]

    trend_data = []
    for d in trend_months:
        b = bucket_for(d)
        trend_data.append({
            "value": d.strftime("%Y-%m"),
            "label": f"{calendar.month_abbr[d.month]} {d.year}",
            "net": float(b["income"] - b["expense"]),
        })

    return render_template(
        "finance.html",
        transactions=transactions,
        income=float(income),
        expense=float(expense),
        balance=float(balance),
        month_tabs=month_tabs,
        selected_month_value=selected_month_value,
        selected_month_label=selected_month_label,
        all_time=all_time,
        comparison=comparison,
        savings_rate=savings_rate,
        biggest_category=biggest_category,
        biggest_day_label=biggest_day_label,
        trend_data=trend_data,
    )

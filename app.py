import os
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import func
from flask import (
    Flask, render_template, redirect, url_for,
    request, flash, session, jsonify
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin,
    login_user, logout_user,
    login_required, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash

# -------------------------
# Setup
# -------------------------
basedir = os.path.abspath(os.path.dirname(__file__))
os.makedirs(os.path.join(basedir, "instance"), exist_ok=True)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "kewpew")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(basedir, 'instance', 'site.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

logging.basicConfig(level=logging.INFO)

# -------------------------
# DB & Login
# -------------------------
db = SQLAlchemy(app)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"

# -------------------------
# Finance totals cache (per-user)
# -------------------------
finance_cache = {}  # user_id -> {"income": float, "expense": float, "timestamp": float}
CACHE_EXPIRATION = 30  # seconds


def _reset_finance_cache_for_user(user_id: int) -> None:
    finance_cache[user_id] = {"income": 0.0, "expense": 0.0, "timestamp": 0.0}


# -------------------------
# Helpers / Validators
# -------------------------
class ValidationError(Exception):
    pass


def validate_amount(amount_str: str) -> float:
    try:
        amount = float(amount_str)
        if amount < 0:
            raise ValidationError("Amount must be non-negative.")
        return amount
    except ValueError:
        raise ValidationError("Invalid amount format.")


def is_ajax_request() -> bool:
    # Your transactions.js sets this header explicitly for fetch()
    return request.headers.get("X-Requested-With") == "XMLHttpRequest"


# -------------------------
# Models
# -------------------------
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    first_name = db.Column(db.String(80), nullable=True)
    password_hash = db.Column(db.String(128), nullable=False)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f"<User {self.username}>"


class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(255), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    type = db.Column(db.String(10), nullable=False)  # 'income' or 'expense'
    timestamp = db.Column(db.DateTime, default=db.func.current_timestamp())
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


# -------------------------
# Load User
# -------------------------
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# -------------------------
# Routes
# -------------------------
@app.route("/", methods=["GET", "POST"])
@login_required
def index():
    # Notes add (form POST)
    if request.method == "POST":
        note_content = request.form.get("note", "")
        if note_content.strip():
            new_note = Note(content=note_content.strip(), user_id=current_user.id)
            try:
                db.session.add(new_note)
                db.session.commit()
                flash("Note added!", "success")
            except Exception as e:
                db.session.rollback()
                logging.error("Error adding note: %s", e, exc_info=True)
                flash("Error adding note", "error")
        return redirect(url_for("index"))

    notes = Note.query.filter_by(user_id=current_user.id).all()
    transactions = (
        Transaction.query.filter_by(user_id=current_user.id)
        .order_by(Transaction.timestamp.desc())
        .all()
    )

    income = db.session.query(func.sum(Transaction.amount)).filter_by(
        user_id=current_user.id, type="income"
    ).scalar() or 0

    expense = db.session.query(func.sum(Transaction.amount)).filter_by(
        user_id=current_user.id, type="expense"
    ).scalar() or 0

    balance = income - expense

    # legacy placeholders (safe if your template expects them; remove later if unused)
    labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    values = [12, 19, 10, 24, 18]

    return render_template(
        "index.html",
        labels=labels,
        values=values,
        notes=notes,
        transactions=transactions,
        income=income,
        expense=expense,
        balance=balance,
    )


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        first_name = request.form.get("first_name", "").strip()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            flash("Username and password are required.", "error")
            return redirect(url_for("register"))

        if User.query.filter_by(username=username).first():
            flash("Username already exists.", "error")
            return redirect(url_for("register"))

        new_user = User(username=username, first_name=first_name or None)
        new_user.set_password(password)

        try:
            db.session.add(new_user)
            db.session.commit()
            flash("Registration successful! You can now log in.", "success")
            return redirect(url_for("login"))
        except Exception as e:
            db.session.rollback()
            logging.error("Error during registration: %s", e, exc_info=True)
            flash("Error during registration", "error")
            return redirect(url_for("register"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for("index"))

        flash("Invalid credentials", "error")
        return redirect(url_for("login"))

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


# -------------------------
# Notes routes
# -------------------------
@app.route("/delete_note/<int:note_id>", methods=["POST"])
@login_required
def delete_note(note_id):
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id:
        flash("Unauthorized action", "error")
        return redirect(url_for("index"))

    session["last_deleted_note"] = {"content": note.content, "user_id": note.user_id}

    try:
        db.session.delete(note)
        db.session.commit()
        flash('Note deleted. <a href="/undo_delete" class="underline">Undo</a>', "info")
    except Exception as e:
        db.session.rollback()
        logging.error("Error deleting note: %s", e, exc_info=True)
        flash("Error deleting note", "error")

    return redirect(url_for("index"))


@app.route("/undo_delete")
@login_required
def undo_delete():
    note_data = session.pop("last_deleted_note", None)
    if note_data and note_data.get("user_id") == current_user.id:
        restored_note = Note(content=note_data["content"], user_id=note_data["user_id"])
        try:
            db.session.add(restored_note)
            db.session.commit()
            flash("Note restored!", "success")
        except Exception as e:
            db.session.rollback()
            logging.error("Error restoring note: %s", e, exc_info=True)
            flash("Error restoring note", "error")
    else:
        flash("No note to restore or unauthorized.", "error")

    return redirect(url_for("index"))


@app.route("/update_note/<int:note_id>", methods=["POST"])
@login_required
def update_note(note_id):
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    if not data or not data.get("content"):
        return jsonify({"error": "Empty content"}), 400

    note.content = data["content"].strip()

    try:
        db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        logging.error("Error updating note: %s", e, exc_info=True)
        return jsonify({"error": "Database error"}), 500


# -------------------------
# Transactions routes
# -------------------------
@app.route("/add_transaction", methods=["POST"])
@login_required
def add_transaction():
    description = request.form.get("description", "").strip()
    amount_str = request.form.get("amount", "").strip()
    t_type = request.form.get("type", "").strip()

    if not description:
        msg = "Description is required."
        if is_ajax_request():
            return jsonify({"message": msg}), 400
        flash(msg, "error")
        return redirect(url_for("index"))

    try:
        amount = validate_amount(amount_str)
    except ValidationError as e:
        msg = str(e)
        if is_ajax_request():
            return jsonify({"message": msg}), 400
        flash(msg, "error")
        return redirect(url_for("index"))

    if t_type not in ("income", "expense"):
        msg = "Invalid transaction type."
        if is_ajax_request():
            return jsonify({"message": msg}), 400
        flash(msg, "error")
        return redirect(url_for("index"))

    new_tx = Transaction(
        description=description,
        amount=amount,
        type=t_type,
        user_id=current_user.id,
    )

    try:
        db.session.add(new_tx)
        db.session.commit()
        _reset_finance_cache_for_user(current_user.id)

        # AJAX add: return only the <li> row partial
        if is_ajax_request():
            return render_template("partials/transaction_row.html", tx=new_tx)

        flash("Transaction added!", "success")
        return redirect(url_for("index"))

    except Exception as e:
        db.session.rollback()
        logging.error("Error adding transaction: %s", e, exc_info=True)

        msg = "Error adding transaction"
        if is_ajax_request():
            return jsonify({"message": msg}), 500

        flash(msg, "error")
        return redirect(url_for("index"))


@app.route("/update_transaction/<int:transaction_id>", methods=["POST"])
@login_required
def update_transaction(transaction_id):
    tx = Transaction.query.get_or_404(transaction_id)
    if tx.user_id != current_user.id:
        return jsonify({"message": "Unauthorized"}), 403

    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    desc = (data.get("description") or tx.description).strip()
    t_type = data.get("type") or tx.type

    try:
        amount = float(data.get("amount", tx.amount))
        if amount < 0:
            return jsonify({"message": "Amount must be non-negative."}), 400
    except Exception:
        return jsonify({"message": "Invalid amount format."}), 400

    if t_type not in ("income", "expense"):
        return jsonify({"message": "Invalid transaction type."}), 400

    tx.description = desc
    tx.amount = amount
    tx.type = t_type

    try:
        db.session.commit()
        _reset_finance_cache_for_user(current_user.id)
        return jsonify({"message": "Transaction updated successfully"})
    except Exception as e:
        db.session.rollback()
        logging.error("Error updating transaction: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@app.route("/delete_transaction/<int:transaction_id>", methods=["POST"])
@login_required
def delete_transaction(transaction_id):
    tx = Transaction.query.get_or_404(transaction_id)
    if tx.user_id != current_user.id:
        if is_ajax_request():
            return jsonify({"message": "Unauthorized"}), 403
        flash("Unauthorized", "error")
        return redirect(url_for("index"))

    # Store last deleted tx in session for undo (per-user)
    # Keep it small + safe (primitives only).
    session["last_deleted_tx"] = {
        "user_id": tx.user_id,
        "description": tx.description,
        "amount": float(tx.amount),
        "type": tx.type,
        "timestamp": (
            tx.timestamp.replace(tzinfo=timezone.utc).isoformat()
            if tx.timestamp else datetime.now(timezone.utc).isoformat()
        ),
        "deleted_at": time.time(),
    }

    try:
        db.session.delete(tx)
        db.session.commit()
        _reset_finance_cache_for_user(current_user.id)

        if is_ajax_request():
            return jsonify({"message": "Transaction deleted", "can_undo": True})

        flash("Transaction deleted!", "success")
        return redirect(url_for("index"))

    except Exception as e:
        db.session.rollback()
        logging.error("Error deleting transaction: %s", e, exc_info=True)

        if is_ajax_request():
            return jsonify({"message": "Error deleting transaction"}), 500

        flash("Error deleting transaction", "error")
        return redirect(url_for("index"))


@app.route("/undo_delete_transaction", methods=["POST"])
@login_required
def undo_delete_transaction():
    data = session.get("last_deleted_tx")

    if not data or data.get("user_id") != current_user.id:
        return jsonify({"message": "Nothing to undo."}), 400

    # Keep undo window tight (matches your toast UX vibe)
    deleted_at = float(data.get("deleted_at", 0))
    UNDO_WINDOW_SECONDS = 10
    if time.time() - deleted_at > UNDO_WINDOW_SECONDS:
        session.pop("last_deleted_tx", None)
        return jsonify({"message": "Undo window expired."}), 400

    try:
        # Restore timestamp if it parses
        ts = None
        try:
            ts = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
        except Exception:
            ts = None

        restored = Transaction(
            description=data["description"],
            amount=float(data["amount"]),
            type=data["type"],
            user_id=current_user.id,
            timestamp=ts if ts else db.func.current_timestamp(),
        )

        db.session.add(restored)
        db.session.commit()
        _reset_finance_cache_for_user(current_user.id)

        # Clear after success
        session.pop("last_deleted_tx", None)

        # ✅ Return row HTML so frontend can reinsert instantly
        row_html = render_template("partials/transaction_row.html", tx=restored)
        return jsonify({"message": "Transaction restored.", "row_html": row_html})

    except Exception as e:
        db.session.rollback()
        logging.error("Error undoing delete: %s", e, exc_info=True)
        return jsonify({"message": "Error restoring transaction"}), 500


# -------------------------
# Finance API
# -------------------------
@app.route("/api/finance_totals")
@login_required
def finance_totals():
    now = time.time()
    uid = current_user.id

    cached = finance_cache.get(uid)
    if not cached:
        _reset_finance_cache_for_user(uid)
        cached = finance_cache[uid]

    if now - cached["timestamp"] > CACHE_EXPIRATION:
        income = db.session.query(func.sum(Transaction.amount)).filter_by(
            user_id=uid, type="income"
        ).scalar() or 0

        expense = db.session.query(func.sum(Transaction.amount)).filter_by(
            user_id=uid, type="expense"
        ).scalar() or 0

        cached.update({"income": float(income), "expense": float(expense), "timestamp": now})

    income = float(cached["income"])
    expense = float(cached["expense"])
    balance = income - expense

    return jsonify({
        "income": round(income, 2),
        "expense": round(expense, 2),
        "balance": round(balance, 2),
    })


# -------------------------
# Offline page (PWA)
# -------------------------
@app.route("/offline.html")
def offline_page():
    return render_template("offline.html")


# -------------------------
# Security headers
# -------------------------
@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # NOTE: X-XSS-Protection is legacy, but harmless. Keep it for now.
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# -------------------------
# Error handlers
# -------------------------
@app.errorhandler(404)
def page_not_found(e):
    logging.warning("404 error: %s at %s", e, request.path)
    return render_template("404.html"), 404


@app.errorhandler(500)
def internal_error(e):
    logging.error("500 error: %s at %s", e, request.path, exc_info=True)
    db.session.rollback()
    return render_template("500.html"), 500


# -------------------------
# Run
# -------------------------
if __name__ == "__main__":
    app.run(debug=True)
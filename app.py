import os
import logging
import time
from datetime import datetime, timezone

from flask import (
    Flask,
    render_template,
    redirect,
    url_for,
    request,
    flash,
    session,
    jsonify,
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager,
    UserMixin,
    login_user,
    logout_user,
    login_required,
    current_user,
)
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix
from sqlalchemy import func

basedir = os.path.abspath(os.path.dirname(__file__))
os.makedirs(os.path.join(basedir, "instance"), exist_ok=True)

app = Flask(__name__)

is_render = os.environ.get("RENDER") is not None
is_production = is_render or (os.environ.get("FLASK_ENV") == "production")

secret = os.environ.get("SECRET_KEY")
if is_production and not secret:
    raise RuntimeError("SECRET_KEY is required in production")
if not secret:
    secret = "dev-only-change-me"
app.config["SECRET_KEY"] = secret

database_url = os.environ.get("DATABASE_URL")
if database_url:
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
else:
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(basedir, 'instance', 'site.db')}"

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

if database_url:
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
    }

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = is_production

app.config["WTF_CSRF_HEADERS"] = ["X-CSRFToken", "X-CSRF-Token"]

logging.basicConfig(level=logging.INFO)

csrf = CSRFProtect(app)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

db = SQLAlchemy(app)
migrate = Migrate(app, db)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"
login_manager.session_protection = "strong"

finance_cache = {}
CACHE_EXPIRATION = 30


@app.context_processor
def inject_csrf_token():
    return dict(csrf_token=generate_csrf)


def is_ajax_request() -> bool:
    xrw = request.headers.get("X-Requested-With") == "XMLHttpRequest"
    accept_json = "application/json" in (request.headers.get("Accept") or "")
    fetch_mode = request.headers.get("Sec-Fetch-Mode") == "cors"
    return xrw or accept_json or fetch_mode or request.path.startswith("/api/")


@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    logging.info("CSRF error: %s", e.description)
    if is_ajax_request():
        return jsonify({"message": "CSRF token missing or invalid."}), 400
    flash("Security check failed. Please refresh and try again.", "error")
    return redirect(request.referrer or url_for("index"))


def _reset_finance_cache_for_user(user_id: int) -> None:
    finance_cache[user_id] = {"income": 0.0, "expense": 0.0, "timestamp": 0.0}


class ValidationError(Exception):
    pass


def validate_amount(amount_str: str) -> float:
    try:
        amount = float(amount_str)
        if amount < 0:
            raise ValidationError("Amount must be non negative.")
        return amount
    except ValueError:
        raise ValidationError("Invalid amount format.")


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
    position = db.Column(db.Integer, nullable=False, default=0, index=True)


class Transaction(db.Model):
    __tablename__ = "transaction"

    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(255), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    type = db.Column(db.String(10), nullable=False)
    timestamp = db.Column(db.DateTime, default=db.func.current_timestamp())
    position = db.Column(db.Integer, nullable=False, default=0, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


@app.route("/", methods=["GET", "POST"])
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
                logging.error("Error adding note: %s", e, exc_info=True)
                flash("Error adding note", "error")

        return redirect(url_for("index"))

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

    balance = income - expense

    return render_template(
        "index.html",
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


@app.route("/update_note/<int:note_id>", methods=["POST"])
@login_required
def update_note(note_id):
    note = Note.query.get_or_404(note_id)
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
        logging.error("Error updating note: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@app.route("/reorder_notes", methods=["POST"])
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

    notes = Note.query.filter(Note.user_id == current_user.id, Note.id.in_(ids)).all()

    found_ids = {n.id for n in notes}
    if set(ids) != found_ids:
        return jsonify({"message": "Order contains unknown or unauthorized note ids."}), 403

    id_to_note = {n.id: n for n in notes}
    for idx, note_id in enumerate(ids, start=1):
        id_to_note[note_id].position = idx

    try:
        db.session.commit()
        return jsonify({"message": "Note order saved."})
    except Exception as e:
        db.session.rollback()
        logging.error("Error saving note order: %s", e, exc_info=True)
        return jsonify({"message": "Database error"}), 500


@app.route("/delete_note/<int:note_id>", methods=["POST"])
@login_required
def delete_note(note_id):
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id:
        if is_ajax_request():
            return jsonify({"message": "Unauthorized"}), 403
        flash("Unauthorized action", "error")
        return redirect(url_for("index"))

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
        return redirect(url_for("index"))

    except Exception as e:
        db.session.rollback()
        logging.error("Error deleting note: %s", e, exc_info=True)

        if is_ajax_request():
            return jsonify({"message": "Error deleting note"}), 500

        flash("Error deleting note", "error")
        return redirect(url_for("index"))


@app.route("/undo_delete_note", methods=["POST"])
@login_required
def undo_delete_note():
    data = session.get("last_deleted_note")

    if not data or data.get("user_id") != current_user.id:
        return jsonify({"message": "Nothing to undo."}), 400

    deleted_at = float(data.get("deleted_at", 0))
    undo_window_seconds = 10
    if time.time() - deleted_at > undo_window_seconds:
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
            ).update(
                {Note.position: Note.position + 1},
                synchronize_session=False,
            )

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
        logging.error("Error undoing note delete: %s", e, exc_info=True)
        return jsonify({"message": "Error restoring note"}), 500


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
        _reset_finance_cache_for_user(current_user.id)

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

    data = request.get_json(silent=True) or {}
    desc = (data.get("description") or tx.description).strip()
    t_type = data.get("type") or tx.type

    try:
        amount = float(data.get("amount", tx.amount))
        if amount < 0:
            return jsonify({"message": "Amount must be non negative."}), 400
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


@app.route("/reorder_transactions", methods=["POST"])
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

    found_ids = {t.id for t in txs}
    if set(ids) != found_ids:
        return jsonify({"message": "Order contains unknown or unauthorized transaction ids."}), 403

    id_to_tx = {t.id: t for t in txs}
    for idx, tx_id in enumerate(ids, start=1):
        id_to_tx[tx_id].position = idx

    try:
        db.session.commit()
        _reset_finance_cache_for_user(current_user.id)
        return jsonify({"message": "Transaction order saved."})
    except Exception as e:
        db.session.rollback()
        logging.error("Error saving transaction order: %s", e, exc_info=True)
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

    session["last_deleted_tx"] = {
        "user_id": tx.user_id,
        "description": tx.description,
        "amount": float(tx.amount),
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

    deleted_at = float(data.get("deleted_at", 0))
    undo_window_seconds = 10
    if time.time() - deleted_at > undo_window_seconds:
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
            amount=float(data["amount"]),
            type=data["type"],
            user_id=current_user.id,
            position=restored_pos,
            timestamp=ts if ts else db.func.current_timestamp(),
        )

        db.session.add(restored)
        db.session.commit()
        _reset_finance_cache_for_user(current_user.id)

        session.pop("last_deleted_tx", None)

        row_html = render_template("partials/transaction_row.html", tx=restored)
        return jsonify({"message": "Transaction restored.", "row_html": row_html})

    except Exception as e:
        db.session.rollback()
        logging.error("Error undoing delete: %s", e, exc_info=True)
        return jsonify({"message": "Error restoring transaction"}), 500


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
        income = (
            db.session.query(func.sum(Transaction.amount))
            .filter_by(user_id=uid, type="income")
            .scalar()
            or 0
        )

        expense = (
            db.session.query(func.sum(Transaction.amount))
            .filter_by(user_id=uid, type="expense")
            .scalar()
            or 0
        )

        cached.update({"income": float(income), "expense": float(expense), "timestamp": now})

    income = float(cached["income"])
    expense = float(cached["expense"])
    balance = income - expense

    return jsonify(
        {
            "income": round(income, 2),
            "expense": round(expense, 2),
            "balance": round(balance, 2),
        }
    )


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.errorhandler(404)
def page_not_found(e):
    logging.warning("404 error: %s at %s", e, request.path)
    return render_template("404.html"), 404


@app.errorhandler(500)
def internal_error(e):
    logging.error("500 error: %s at %s", e, request.path, exc_info=True)
    db.session.rollback()
    return render_template("500.html"), 500


if __name__ == "__main__":
    app.run(debug=not is_production)
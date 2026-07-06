from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from ..extensions import db

VALID_STATUSES = ("draft", "active", "completed", "archived")
VALID_PRIORITIES = ("low", "medium", "high")


class Scenario(db.Model):
    """
    A "what if" financial decision the user is weighing (e.g. "Move to a
    new apartment", "Switch to a 4-day work week"). Costs/savings are
    modeled explicitly so the impact can be computed instead of guessed.
    """

    __tablename__ = "scenario"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)

    title = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(50), nullable=False, default="other")
    description = db.Column(db.Text, nullable=True)

    one_time_cost = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    monthly_cost = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    monthly_savings = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))

    start_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)

    priority = db.Column(db.String(10), nullable=False, default="medium")
    emotional_value = db.Column(db.Integer, nullable=False, default=5)  # 1-10, how much it matters to the user
    financial_risk = db.Column(db.Integer, nullable=False, default=5)   # 1-10, how risky it is financially

    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(10), nullable=False, default="active", index=True)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # ------------------------------------------------------------------
    # Pure arithmetic — no DB access, safe to use anywhere the row is loaded
    # ------------------------------------------------------------------

    @property
    def net_monthly_impact(self) -> Decimal:
        """Positive means the scenario nets more savings than cost per month."""
        return self.monthly_savings - self.monthly_cost

    @property
    def net_yearly_impact(self) -> Decimal:
        """Full first-year impact: 12 months of net cash flow minus the upfront cost."""
        return (self.net_monthly_impact * 12) - self.one_time_cost

    @property
    def payback_months(self) -> Decimal | None:
        """
        Months of net savings needed to cover the one-time cost.
        None if there's a one-time cost but no positive monthly impact to ever recover it.
        """
        if self.one_time_cost <= 0:
            return Decimal("0")
        if self.net_monthly_impact <= 0:
            return None
        return (self.one_time_cost / self.net_monthly_impact).quantize(Decimal("0.1"))

    # ------------------------------------------------------------------
    # Recommendation & insight depend on the user's current balance, which
    # isn't stored on the row — callers (routes / context processors) pass
    # it in after querying Transaction totals.
    # ------------------------------------------------------------------

    def recommendation(self, current_balance: Decimal) -> str:
        """Return 'green' | 'yellow' | 'red'."""
        if self.financial_risk >= 7:
            return "red"
        if self.net_monthly_impact >= 0 and self.one_time_cost < (current_balance * Decimal("0.2")):
            return "green"
        return "yellow"

    def insight(self, current_balance: Decimal) -> str:
        """Rule-based plain-English summary of the numbers. No AI call."""
        rec = self.recommendation(current_balance)
        parts: list[str] = []

        if rec == "red":
            parts.append(
                f"Financial risk is rated {self.financial_risk}/10 — high enough that "
                "the numbers below shouldn't be the only thing driving this decision."
            )
        elif rec == "green":
            parts.append(
                "Numbers look favorable: it's cash-flow positive and the upfront cost "
                "is a small share of your current balance."
            )
        else:
            if self.net_monthly_impact < 0:
                parts.append(
                    f"This costs ${abs(self.net_monthly_impact):,.2f}/month more than it saves."
                )
            if current_balance > 0 and self.one_time_cost >= (current_balance * Decimal("0.2")):
                pct = (self.one_time_cost / current_balance) * 100
                parts.append(
                    f"The one-time cost is about {pct:.0f}% of your current balance — "
                    "worth budgeting for carefully before committing."
                )
            if not parts:
                parts.append("Mixed signals — review the numbers below before deciding.")

        if self.payback_months is not None and self.payback_months > 0:
            parts.append(f"At this rate, it pays for itself in about {self.payback_months} months.")
        elif self.one_time_cost > 0 and self.net_monthly_impact <= 0:
            parts.append("With no net monthly savings, the one-time cost is never recovered.")

        return " ".join(parts)

    def __repr__(self) -> str:
        return f"<Scenario {self.id} {self.title!r} status={self.status}>"

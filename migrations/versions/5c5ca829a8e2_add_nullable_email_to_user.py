"""add nullable email to user

Revision ID: 5c5ca829a8e2
Revises: a4c7ff9f5613
Create Date: 2026-04-21 00:11:50.680265
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "5c5ca829a8e2"
down_revision = "a4c7ff9f5613"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(sa.Column("email", sa.String(length=120), nullable=True))
        batch_op.create_unique_constraint("uq_user_email", ["email"])


def downgrade():
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_constraint("uq_user_email", type_="unique")
        batch_op.drop_column("email")
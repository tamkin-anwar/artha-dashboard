from ..extensions import db


class Note(db.Model):
    __tablename__ = "note"

    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0, index=True)

    def __repr__(self) -> str:
        return f"<Note {self.id}>"

// static/js/notes.js
import { showToast } from "./toast.js";

const DEBOUNCE_DELAY = 300;
const MAX_RETRIES = 2;

let saveTimeout = null;
let reorderTimeout = null;

function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
}

function csrfHeaders() {
    const token = getCsrfToken();
    return {
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": token,
        "X-CSRF-Token": token,
    };
}

function ensureSavingIndicator(editableEl) {
    const parent = editableEl.parentElement;
    if (!parent) return null;

    let indicator = parent.querySelector(".note-saving-indicator");
    if (!indicator) {
        indicator = document.createElement("span");
        indicator.className = "note-saving-indicator text-xs text-gray-500 ml-2";
        indicator.textContent = "Saving...";
        editableEl.insertAdjacentElement("afterend", indicator);
    }
    return indicator;
}

async function saveNoteContent(noteId, content, editableEl, retries = 0) {
    if (!noteId) return;

    const trimmed = (content || "").trim();
    if (!trimmed) return;

    const indicator = ensureSavingIndicator(editableEl);

    try {
        const res = await fetch(`/update_note/${noteId}`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                ...csrfHeaders(),
            },
            body: JSON.stringify({ content: trimmed }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data?.message || "Failed to save note";

            if (retries < MAX_RETRIES) {
                return saveNoteContent(noteId, trimmed, editableEl, retries + 1);
            }

            showToast(msg, "error");
            return;
        }

        showToast("Note saved", "success");
    } catch (err) {
        if (retries < MAX_RETRIES) {
            return saveNoteContent(noteId, trimmed, editableEl, retries + 1);
        }
        console.error("Error saving note:", err);
        showToast("Error saving note", "error");
    } finally {
        if (indicator) indicator.remove();
    }
}

function bindNoteEditors() {
    const editableNotes = document.querySelectorAll(".editable-note");
    if (!editableNotes.length) return;

    editableNotes.forEach((el) => {
        if (el.dataset.bound === "1") return;
        el.dataset.bound = "1";

        el.addEventListener("blur", () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveNoteContent(el.dataset.noteId, el.textContent, el);
            }, DEBOUNCE_DELAY);
        });

        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                el.blur();
            }
        });
    });
}

async function persistNoteOrder(noteListEl) {
    const ids = Array.from(noteListEl.querySelectorAll('li[data-id]'))
        .map((li) => parseInt(li.dataset.id, 10))
        .filter((n) => Number.isFinite(n));

    if (!ids.length) return;

    try {
        const res = await fetch("/reorder_notes", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                ...csrfHeaders(),
            },
            body: JSON.stringify({ order: ids }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data?.message || "Failed to save note order";
            showToast(msg, "error");
            return;
        }

        showToast("Note order saved", "success");
    } catch (err) {
        console.error("Error saving note order:", err);
        showToast("Network error while saving note order", "error");
    }
}

function initNoteSorting() {
    const noteListEl = document.getElementById("note-list");
    if (!noteListEl) return;

    if (noteListEl.dataset.sortableBound === "1") return;
    noteListEl.dataset.sortableBound = "1";

    if (!window.Sortable) {
        console.warn("Sortable missing. sortable.min.js may not be loading.");
        return;
    }

    window.Sortable.create(noteListEl, {
        animation: 150,
        draggable: 'li[data-id]',
        handle: ".note-handle",
        onEnd: () => {
            clearTimeout(reorderTimeout);
            reorderTimeout = setTimeout(() => persistNoteOrder(noteListEl), 250);
        },
    });
}

function initNotes() {
    bindNoteEditors();
    initNoteSorting();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNotes);
} else {
    initNotes();
}
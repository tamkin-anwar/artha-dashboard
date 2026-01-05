import { showToast } from "./toast.js";

const DEBOUNCE_DELAY = 300;
const MAX_RETRIES = 2;
let debounceTimeout;

// Read CSRF from <meta name="csrf-token" content="..."> (we added this in base.html)
function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
    }

    // Create a small "Saving..." indicator *next to* the editable note (not inside it)
    function ensureSavingIndicator(el) {
    const parent = el.parentElement;
    if (!parent) return null;

    let indicator = parent.querySelector(".note-saving-indicator");
    if (!indicator) {
        indicator = document.createElement("span");
        indicator.className = "note-saving-indicator text-xs text-gray-500 ml-2";
        indicator.textContent = "Saving...";
        // Put it right after the editable div
        el.insertAdjacentElement("afterend", indicator);
    }
    return indicator;
    }

    async function saveNoteContent(noteId, content, el, retries = 0) {
    if (!noteId) return;

    const trimmed = (content || "").trim();
    if (!trimmed) return;

    const csrfToken = getCsrfToken();
    const indicator = ensureSavingIndicator(el);

    try {
        const res = await fetch(`/update_note/${noteId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            // Flask-WTF checks these header names
            "X-CSRFToken": csrfToken,
            "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ content: trimmed })
        });

        if (!res.ok) {
        // Try to read server error message (if any)
        let msg = "Failed to save note";
        try {
            const data = await res.json();
            if (data?.error) msg = data.error;
            if (data?.message) msg = data.message;
        } catch (_) {}

        if (retries < MAX_RETRIES) {
            console.warn(`Retrying save for note ${noteId} (${retries + 1})`);
            return saveNoteContent(noteId, trimmed, el, retries + 1);
        }

        console.error(`Failed to save note ${noteId}`, res.status);
        showToast(msg, "error");
        return;
        }

        // Optional success toast (keep it if you like)
        showToast("Note saved");
    } catch (err) {
        if (retries < MAX_RETRIES) {
        console.warn(`Retrying save for note ${noteId} after error (${retries + 1})`, err);
        return saveNoteContent(noteId, trimmed, el, retries + 1);
        }
        console.error("Error saving note:", err);
        showToast("Error saving note", "error");
    } finally {
        if (indicator) indicator.remove();
    }
    }

    document.addEventListener("DOMContentLoaded", () => {
    const notes = document.querySelectorAll(".editable-note");
    if (!notes.length) return;

    notes.forEach((el) => {
        el.addEventListener("blur", () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
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
});
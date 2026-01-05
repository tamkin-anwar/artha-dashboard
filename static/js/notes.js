import { showToast } from "./toast.js";

const DEBOUNCE_DELAY = 300;
const MAX_RETRIES = 2;
let debounceTimeout;

async function saveNoteContent(noteId, content, el, retries = 0) {
    if (!noteId || !content.trim()) return;

    // Avoid duplicate saving indicator
    let savingIndicator = el.querySelector(".note-saving-indicator");
    if (!savingIndicator) {
        savingIndicator = document.createElement("span");
        savingIndicator.textContent = "Saving...";
        savingIndicator.className = "note-saving-indicator text-sm text-gray-500 ml-2";
        el.appendChild(savingIndicator);
    }

    try {
        const res = await fetch(`/update_note/${noteId}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            },
            body: JSON.stringify({ content: content.trim() })
        });
        if (!res.ok) {
            if (retries < MAX_RETRIES) {
                console.warn(`Retrying save for note ${noteId} (${retries + 1})`);
                return saveNoteContent(noteId, content, el, retries + 1);
            }
            console.error(`Failed to save note ${noteId}`);
            showToast("Failed to save note", "error");
        } else {
            showToast("Note saved");
        }
    } catch (err) {
        if (retries < MAX_RETRIES) {
            console.warn(`Retrying save for note ${noteId} after error (${retries + 1})`, err);
            return saveNoteContent(noteId, content, el, retries + 1);
        }
        console.error("Error saving note:", err);
        showToast("Error saving note", "error");
    } finally {
        savingIndicator.remove();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const notes = document.querySelectorAll(".editable-note");
    if (!notes.length) return;

    notes.forEach(el => {
        el.addEventListener("blur", () => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => saveNoteContent(el.dataset.noteId, el.textContent, el), DEBOUNCE_DELAY);
        });

        el.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                el.blur();
            }
        });
    });
});
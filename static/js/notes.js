// static/js/notes.js
import { showToast } from "./toast.js";

function ajaxHeader() {
    return { "X-Requested-With": "XMLHttpRequest" };
    }

    function getCsrfFromElement(el) {
    if (!el) return "";
    const input = el.querySelector('input[name="csrf_token"]');
    return input ? input.value : "";
    }

    function getAnyCsrfToken() {
    const any = document.querySelector('input[name="csrf_token"]');
    return any ? any.value : "";
    }

    function buildHeaders(csrfToken, isJson) {
    const headers = {
        ...ajaxHeader(),
        "X-CSRFToken": csrfToken
    };
    if (isJson) headers["Content-Type"] = "application/json";
    return headers;
    }

    async function fetchMaybeJson(url, options) {
    const res = await fetch(url, {
        credentials: "same-origin",
        redirect: "follow",
        ...options
    });

    const contentType = res.headers.get("content-type") || "";
    let data = {};
    if (contentType.includes("application/json")) {
        data = await res.json().catch(() => ({}));
    } else {
        data = { raw: await res.text().catch(() => "") };
    }

    return { res, data };
    }

    function initInlineEdit() {
    const noteList = document.getElementById("note-list");
    if (!noteList) return;

    let saveTimer = null;

    noteList.addEventListener("input", (e) => {
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        if (!el.classList.contains("editable-note")) return;

        const noteId = el.getAttribute("data-note-id");
        if (!noteId) return;

        const row = el.closest("li.note-row");
        if (!row) return;

        const deleteForm = row.querySelector("form.note-delete-form");
        const csrfToken = getCsrfFromElement(deleteForm) || getAnyCsrfToken();

        const content = (el.textContent || "").trim();

        if (saveTimer) window.clearTimeout(saveTimer);

        saveTimer = window.setTimeout(async () => {
        if (!content) {
            showToast("Note cannot be empty", "error");
            return;
        }

        try {
            const { res, data } = await fetchMaybeJson(`/update_note/${noteId}`, {
            method: "POST",
            headers: buildHeaders(csrfToken, true),
            body: JSON.stringify({ content })
            });

            if (!res.ok) {
            showToast(data.message || "Note update failed", "error");
            }
        } catch {
            showToast("Network error while saving note", "error");
        }
        }, 350);
    });
    }

    function initDeleteWithUndo() {
    const noteList = document.getElementById("note-list");
    if (!noteList) return;

    noteList.addEventListener("submit", async (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!form.classList.contains("note-delete-form")) return;

        e.preventDefault();
        e.stopPropagation();

        const row = form.closest("li.note-row");
        const url = form.getAttribute("action") || "";
        const csrfToken = getCsrfFromElement(form) || getAnyCsrfToken();

        if (!row || !url) return;

        const rowNext = row.nextElementSibling;
        const rowParent = row.parentElement;

        try {
        const { res, data } = await fetchMaybeJson(url, {
            method: "POST",
            headers: buildHeaders(csrfToken, false)
        });

        if (!res.ok) {
            showToast(data.message || "Delete failed", "error");
            return;
        }

        row.remove();

        showToast("Note deleted", "success", 4000, {
            actionText: "Undo",
            onAction: async () => {
            try {
                const { res: undoRes, data: undoData } = await fetchMaybeJson("/undo_delete_note", {
                method: "POST",
                headers: buildHeaders(csrfToken, false)
                });

                if (!undoRes.ok) {
                showToast(undoData.message || "Undo failed", "error");
                return;
                }

                if (!undoData.row_html) {
                showToast("Undo succeeded but no HTML returned", "error");
                return;
                }

                if (rowParent) {
                if (rowNext && rowNext.parentElement === rowParent) {
                    rowNext.insertAdjacentHTML("beforebegin", undoData.row_html);
                } else {
                    rowParent.insertAdjacentHTML("beforeend", undoData.row_html);
                }
                } else {
                noteList.insertAdjacentHTML("beforeend", undoData.row_html);
                }
            } catch {
                showToast("Network error while undoing", "error");
            }
            }
        });
        } catch {
        showToast("Network error while deleting note", "error");
        }
    });
    }

    function initReorder() {
    const noteList = document.getElementById("note-list");
    if (!noteList) return;
    if (typeof Sortable === "undefined") return;

    const csrfToken =
        getCsrfFromElement(noteList) ||
        getCsrfFromElement(document) ||
        getAnyCsrfToken();

    const getOrder = () => {
        return Array.from(noteList.querySelectorAll("li.note-row"))
        .map((li) => parseInt(li.getAttribute("data-id") || "", 10))
        .filter((n) => Number.isFinite(n));
    };

    new Sortable(noteList, {
        animation: 150,
        handle: ".note-handle",
        onEnd: async () => {
        const order = getOrder();
        if (!order.length) return;

        try {
            const { res, data } = await fetchMaybeJson("/reorder_notes", {
            method: "POST",
            headers: buildHeaders(csrfToken, true),
            body: JSON.stringify({ order })
            });

            if (!res.ok) {
            showToast(data.message || "Reorder failed", "error");
            }
        } catch {
            showToast("Network error while saving order", "error");
        }
        }
    });
    }

    document.addEventListener("DOMContentLoaded", () => {
    initInlineEdit();
    initDeleteWithUndo();
    initReorder();
});
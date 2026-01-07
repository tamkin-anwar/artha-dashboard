// static/js/transactions.js
import { updateChartData } from "./chart.js";
import { showToast } from "./toast.js";

let ariaLiveRegion = null;
let saveTimeout = null;
let txSortable = null;

/**
 * Read CSRF token from <meta name="csrf-token" content="...">
 * base.html includes:
 * <meta name="csrf-token" content="{{ csrf_token() }}">
 */
function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
    }

    function csrfHeaders() {
    const token = getCsrfToken();
    if (!token) {
        console.warn("[CSRF] Missing meta csrf-token. base.html may be cached/stale.");
    }
    return {
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": token,
        "X-CSRF-Token": token,
    };
    }

    /** Debounce wrapper */
    function debounceSaveTransaction(e) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveTransaction(e), 300);
    }

    /** Format number to $0.00 */
    function formatMoney(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return "$0.00";
    return `$${num.toFixed(2)}`;
    }

    /** Keep dataset type consistent (CSS handles coloring) */
    function applyAmountTypeDataset(amountEl, type) {
    if (!amountEl) return;
    amountEl.dataset.type = type;
    }

    /** Fetch totals and update Summary UI */
    async function updateSummaryUI() {
    const incomeEl = document.getElementById("finance-income");
    const expenseEl = document.getElementById("finance-expense");
    const balanceEl = document.getElementById("finance-balance");
    if (!incomeEl || !expenseEl || !balanceEl) return;

    try {
        const res = await fetch("/api/finance_totals", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin",
        });
        if (!res.ok) throw new Error("Failed to fetch totals");

        const data = await res.json();
        incomeEl.textContent = formatMoney(data.income);
        expenseEl.textContent = formatMoney(data.expense);
        balanceEl.textContent = formatMoney(data.balance);
    } catch (err) {
        console.warn("Could not update summary UI:", err);
    }
    }

    /**
     * Persist transaction order to backend
     */
    async function persistTransactionOrder(listEl) {
    const ids = Array.from(listEl.querySelectorAll('li[data-id]')).map(li => Number(li.dataset.id));
    if (!ids.length) return;

    const res = await fetch("/reorder_transactions", {
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
        const msg = data?.message || "Failed to save order";
        showToast(msg, "error");
        return;
    }
    }

    /**
     * Init Sortable for transactions only (NOT widgets)
     */
    function initTransactionSortable() {
    const list = document.getElementById("tx-list");
    if (!list) return;

    // Don’t double-bind
    if (list.dataset.sortableBound === "1") return;

    if (!window.Sortable) {
        console.warn("[TX Sortable] window.Sortable not found. Vendor script not loaded or cached wrong.");
        return;
    }

    txSortable = new window.Sortable(list, {
        animation: 150,
        handle: ".tx-handle",
        draggable: "li[data-id]",
        onEnd: async () => {
        try {
            await persistTransactionOrder(list);
            showToast("Order saved", "success");
        } catch (e) {
            console.warn("Persist order failed:", e);
            showToast("Could not save order", "error");
        }
        },
    });

    list.dataset.sortableBound = "1";
    }

    /**
     * Undo delete transaction (AJAX)
     * Expects: { message, row_html }
     */
    async function undoDeleteTransaction() {
    try {
        const res = await fetch("/undo_delete_transaction", {
        method: "POST",
        credentials: "same-origin",
        headers: csrfHeaders(),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
        const msg = data?.message || "Undo failed";
        showToast(msg, "error");
        if (ariaLiveRegion) ariaLiveRegion.textContent = msg;
        return;
        }

        const html = data?.row_html || "";
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;

        const restoredRow = tempDiv.querySelector("li[data-id]");
        const list = document.getElementById("tx-list");

        if (restoredRow && list) {
        list.prepend(restoredRow);

        const typeSelect = restoredRow.querySelector(".tx-type");
        const amountEl = restoredRow.querySelector(".tx-amount");
        if (typeSelect && amountEl) applyAmountTypeDataset(amountEl, typeSelect.value);

        attachRowListeners(restoredRow);

        const msg = data?.message || "Transaction restored.";
        showToast(msg, "success");
        if (ariaLiveRegion) ariaLiveRegion.textContent = msg;

        // Save order after prepend so DB matches UI
        await persistTransactionOrder(list);
        } else {
        showToast("Transaction restored, but UI could not render the row.", "error");
        }

        await updateChartData();
        await updateSummaryUI();
    } catch (err) {
        console.error("Undo delete transaction error:", err);
        showToast("Network error while undoing delete", "error");
        if (ariaLiveRegion) ariaLiveRegion.textContent = "Network error while undoing delete";
    }
    }

    /**
     * Attach delete listener to a row delete form (AJAX)
     */
    function attachDeleteListener(row) {
    const deleteForm = row.querySelector(".tx-delete-form");
    if (!deleteForm) return;

    if (deleteForm.dataset.bound === "1") return;
    deleteForm.dataset.bound = "1";

    deleteForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const rowEl = deleteForm.closest("li[data-id]");
        if (!rowEl) return;

        rowEl.setAttribute("aria-busy", "true");
        rowEl.classList.add("bg-yellow-100");

        try {
        const res = await fetch(deleteForm.action, {
            method: "POST",
            credentials: "same-origin",
            headers: csrfHeaders(),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data?.message || "Delete failed";
            rowEl.classList.remove("bg-yellow-100");
            rowEl.classList.add("bg-red-100");
            rowEl.removeAttribute("aria-busy");
            setTimeout(() => rowEl.classList.remove("bg-red-100"), 1000);

            showToast(msg, "error");
            if (ariaLiveRegion) ariaLiveRegion.textContent = msg;
            return;
        }

        rowEl.remove();

        const msg = data?.message || "Transaction deleted";
        if (ariaLiveRegion) ariaLiveRegion.textContent = msg;

        if (data?.can_undo) {
            showToast("Transaction deleted", "info", 10000, {
            actionText: "Undo",
            onAction: () => undoDeleteTransaction(),
            });
        } else {
            showToast(msg, "info");
        }

        // Save order after removal so DB matches UI
        const list = document.getElementById("tx-list");
        if (list) await persistTransactionOrder(list);

        await updateChartData();
        await updateSummaryUI();
        } catch (err) {
        console.error("Network error deleting transaction:", err);

        rowEl.classList.remove("bg-yellow-100");
        rowEl.classList.add("bg-red-100");
        rowEl.removeAttribute("aria-busy");
        setTimeout(() => rowEl.classList.remove("bg-red-100"), 1000);

        showToast("Network error while deleting transaction", "error");
        if (ariaLiveRegion) ariaLiveRegion.textContent = "Network error while deleting transaction";
        }
    });
    }

    /**
     * Attach inline edit listeners to a single transaction row
     */
    function attachRowListeners(row) {
    const desc = row.querySelector(".tx-desc");
    const amount = row.querySelector(".tx-amount");
    const typeSelect = row.querySelector(".tx-type");

    attachDeleteListener(row);

    if (desc) {
        desc.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            desc.blur();
        }
        });
        desc.addEventListener("blur", debounceSaveTransaction);
    }

    if (amount) {
        amount.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            amount.blur();
        }
        });
        amount.addEventListener("blur", debounceSaveTransaction);
    }

    if (typeSelect) {
        typeSelect.addEventListener("change", (e) => {
        const rowEl = e.target.closest("li[data-id]");
        const amountEl = rowEl?.querySelector(".tx-amount");
        applyAmountTypeDataset(amountEl, e.target.value);
        debounceSaveTransaction(e);
        });
    }
    }

    /**
     * Save transaction edits (inline)
     */
    async function saveTransaction(e) {
    const row = e.target.closest("li[data-id]");
    if (!row) return;

    const id = row.dataset.id;
    const descEl = row.querySelector(".tx-desc");
    const amountEl = row.querySelector(".tx-amount");
    const typeSelect = row.querySelector(".tx-type");
    if (!descEl || !amountEl || !typeSelect) return;

    const desc = descEl.textContent.trim();
    const amountText = amountEl.textContent.trim().replace("$", "");
    const type = typeSelect.value;

    row.classList.add("bg-yellow-100");
    row.setAttribute("aria-busy", "true");

    const amount = parseFloat(amountText);
    if (Number.isNaN(amount)) {
        row.classList.remove("bg-yellow-100");
        row.removeAttribute("aria-busy");
        showToast("Invalid amount entered", "error");
        return;
    }

    try {
        const res = await fetch(`/update_transaction/${id}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            ...csrfHeaders(),
        },
        body: JSON.stringify({ description: desc, amount, type }),
        });

        const responseData = await res.json().catch(() => ({}));

        if (!res.ok) {
        row.classList.remove("bg-yellow-100");
        row.classList.add("bg-red-100");
        row.removeAttribute("aria-busy");
        setTimeout(() => row.classList.remove("bg-red-100"), 1000);

        const errorMsg = responseData?.message || "Transaction update failed";
        showToast(errorMsg, "error");
        if (ariaLiveRegion) ariaLiveRegion.textContent = errorMsg;
        return;
        }

        row.classList.remove("bg-yellow-100");
        row.classList.add("bg-green-100");
        row.removeAttribute("aria-busy");
        setTimeout(() => row.classList.remove("bg-green-100"), 1000);

        amountEl.textContent = formatMoney(amount);
        applyAmountTypeDataset(amountEl, type);

        const successMsg = responseData?.message || "Transaction updated successfully";
        showToast(successMsg, "success");
        if (ariaLiveRegion) ariaLiveRegion.textContent = successMsg;

        await updateChartData();
        await updateSummaryUI();
    } catch (err) {
        console.error("Network error updating transaction:", err);

        row.classList.remove("bg-yellow-100");
        row.classList.add("bg-red-100");
        row.removeAttribute("aria-busy");
        setTimeout(() => row.classList.remove("bg-red-100"), 1000);

        showToast("Network error while updating transaction", "error");
        if (ariaLiveRegion) ariaLiveRegion.textContent = "Network error while updating transaction";
    }
    }

    /**
     * Handle add transaction form (no reload)
     */
    function handleAddTransactionForm(form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const csrfToken = getCsrfToken();
        const formData = new FormData(form);

        const description = (formData.get("description") || "").trim();
        const amount = (formData.get("amount") || "").toString().trim();

        if (!description || !amount || Number.isNaN(parseFloat(amount))) {
        showToast("Please provide valid details", "error");
        return;
        }

        if (!formData.get("csrf_token") && csrfToken) {
        formData.append("csrf_token", csrfToken);
        }

        try {
        const res = await fetch(form.action, {
            method: "POST",
            credentials: "same-origin",
            headers: csrfHeaders(),
            body: formData,
        });

        if (!res.ok) {
            const maybeJson = await res.json().catch(() => null);
            const msg = maybeJson?.message || "Error adding transaction";
            showToast(msg, "error");
            return;
        }

        const html = await res.text();
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;

        const newRow = tempDiv.querySelector("li[data-id]");
        const list = document.getElementById("tx-list");

        if (!newRow || !list) {
            showToast("Transaction added but UI could not render the row", "error");
            return;
        }

        list.appendChild(newRow);

        const typeSelect = newRow.querySelector(".tx-type");
        const amountEl = newRow.querySelector(".tx-amount");
        if (typeSelect && amountEl) applyAmountTypeDataset(amountEl, typeSelect.value);

        attachRowListeners(newRow);

        showToast("Transaction added!", "success");

        // Save order so new row gets a proper position relative to UI
        await persistTransactionOrder(list);

        await updateChartData();
        await updateSummaryUI();

        form.reset();
        } catch (err) {
        console.error("Error adding transaction:", err);
        showToast("Error adding transaction", "error");
        }
    });
    }

    /**
     * Apply dataset types on load for tx rows only
     */
    function applyAllTransactionDatasets() {
    const list = document.getElementById("tx-list");
    if (!list) return;

    list.querySelectorAll("li[data-id]").forEach((row) => {
        const typeSelect = row.querySelector(".tx-type");
        const amountEl = row.querySelector(".tx-amount");
        if (typeSelect && amountEl) applyAmountTypeDataset(amountEl, typeSelect.value);
    });
    }

    function initTransactions() {
    const list = document.getElementById("tx-list");
    if (!list) return; // not on this page

    if (!ariaLiveRegion) {
        ariaLiveRegion = document.createElement("div");
        ariaLiveRegion.setAttribute("aria-live", "assertive");
        ariaLiveRegion.classList.add("sr-only");
        document.body.appendChild(ariaLiveRegion);
    }

    // Only bind to finance transactions rows
    list.querySelectorAll("li[data-id]").forEach((row) => attachRowListeners(row));
    applyAllTransactionDatasets();

    const addTransactionForm = document.querySelector('form[action*="add_transaction"]');
    if (addTransactionForm) handleAddTransactionForm(addTransactionForm);

    initTransactionSortable();
    updateSummaryUI();
    }

    if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTransactions);
    } else {
    initTransactions();
}

export { saveTransaction };
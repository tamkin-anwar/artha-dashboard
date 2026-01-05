// static/js/transactions.js
import { updateChartData } from "./chart.js";
import { showToast } from "./toast.js";

const ariaLiveRegion = document.createElement("div");
ariaLiveRegion.setAttribute("aria-live", "assertive");
ariaLiveRegion.classList.add("sr-only");
document.body.appendChild(ariaLiveRegion);

let saveTimeout;

/**
 * Debounce wrapper for saving edits
 */
function debounceSaveTransaction(e) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveTransaction(e), 300);
}

/**
 * Format number to $0.00
 */
function formatMoney(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return "$0.00";
    return `$${num.toFixed(2)}`;
}

/**
 * Keep dataset type consistent (CSS handles coloring)
 */
function applyAmountTypeDataset(amountEl, type) {
    if (!amountEl) return;
    amountEl.dataset.type = type;
}

/**
 * Fetch totals and update Summary UI
 */
async function updateSummaryUI() {
    const incomeEl = document.getElementById("finance-income");
    const expenseEl = document.getElementById("finance-expense");
    const balanceEl = document.getElementById("finance-balance");
    if (!incomeEl || !expenseEl || !balanceEl) return;

    try {
        const res = await fetch("/api/finance_totals", {
            headers: { "X-Requested-With": "XMLHttpRequest" }
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
 * Undo delete transaction (AJAX)
 * Expects: { message, row_html }
 */
async function undoDeleteTransaction() {
    try {
        const res = await fetch("/undo_delete_transaction", {
            method: "POST",
            headers: { "X-Requested-With": "XMLHttpRequest" }
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data?.message || "Undo failed";
            showToast(msg, "error");
            ariaLiveRegion.textContent = msg;
            return;
        }

        const html = data?.row_html || "";
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;

        const restoredRow = tempDiv.querySelector("li[data-id]");
        const list = document.querySelector("ul.space-y-3");

        if (restoredRow && list) {
            list.prepend(restoredRow);

            const typeSelect = restoredRow.querySelector(".tx-type");
            const amountEl = restoredRow.querySelector(".tx-amount");
            if (typeSelect && amountEl) applyAmountTypeDataset(amountEl, typeSelect.value);

            attachRowListeners(restoredRow);

            const msg = data?.message || "Transaction restored.";
            showToast(msg, "success");
            ariaLiveRegion.textContent = msg;
        } else {
            showToast("Transaction restored, but UI could not render the row.", "error");
        }

        await updateChartData();
        await updateSummaryUI();
    } catch (err) {
        console.error("Undo delete transaction error:", err);
        showToast("Network error while undoing delete", "error");
        ariaLiveRegion.textContent = "Network error while undoing delete";
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
                headers: { "X-Requested-With": "XMLHttpRequest" }
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const msg = data?.message || "Delete failed";
                rowEl.classList.remove("bg-yellow-100");
                rowEl.classList.add("bg-red-100");
                rowEl.removeAttribute("aria-busy");
                setTimeout(() => rowEl.classList.remove("bg-red-100"), 1000);

                showToast(msg, "error");
                ariaLiveRegion.textContent = msg;
                return;
            }

            // Remove row from DOM
            rowEl.remove();

            const msg = data?.message || "Transaction deleted";
            ariaLiveRegion.textContent = msg;

            // ✅ Premium UX: action toast with Undo (10s window on server)
            if (data?.can_undo) {
                showToast("Transaction deleted", "info", 10000, {
                    actionText: "Undo",
                    onAction: () => undoDeleteTransaction()
                });
            } else {
                showToast(msg, "info");
            }

            await updateChartData();
            await updateSummaryUI();
        } catch (err) {
            console.error("Network error deleting transaction:", err);

            rowEl.classList.remove("bg-yellow-100");
            rowEl.classList.add("bg-red-100");
            rowEl.removeAttribute("aria-busy");
            setTimeout(() => rowEl.classList.remove("bg-red-100"), 1000);

            showToast("Network error while deleting transaction", "error");
            ariaLiveRegion.textContent = "Network error while deleting transaction";
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
            const calcDisplay = document.getElementById("calc-display");
            if (calcDisplay && document.activeElement === calcDisplay) return;

            if (e.key === "Enter") {
                e.preventDefault();
                desc.blur();
            }
        });
        desc.addEventListener("blur", debounceSaveTransaction);
    }

    if (amount) {
        amount.addEventListener("keydown", (e) => {
            const calcDisplay = document.getElementById("calc-display");
            if (calcDisplay && document.activeElement === calcDisplay) return;

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
            headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest"
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
            ariaLiveRegion.textContent = errorMsg;
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
        ariaLiveRegion.textContent = successMsg;

        await updateChartData();
        await updateSummaryUI();
    } catch (err) {
        console.error("Network error updating transaction:", err);

        row.classList.remove("bg-yellow-100");
        row.classList.add("bg-red-100");
        row.removeAttribute("aria-busy");
        setTimeout(() => row.classList.remove("bg-red-100"), 1000);

        showToast("Network error while updating transaction", "error");
        ariaLiveRegion.textContent = "Network error while updating transaction";
    }
}

/**
 * Handle add transaction form (no reload)
 */
function handleAddTransactionForm(form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const description = (formData.get("description") || "").trim();
        const amount = (formData.get("amount") || "").toString().trim();

        if (!description || !amount || Number.isNaN(parseFloat(amount))) {
            showToast("Please provide valid details", "error");
            return;
        }

        try {
            const res = await fetch(form.action, {
                method: "POST",
                headers: { "X-Requested-With": "XMLHttpRequest" },
                body: formData
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

            const newRow = tempDiv.querySelector(`li[data-id]`);
            if (!newRow) {
                showToast("Transaction added but UI could not render the row", "error");
                return;
            }

            const list = document.querySelector("ul.space-y-3");
            if (!list) {
                showToast("Transaction added but list container not found", "error");
                return;
            }

            list.appendChild(newRow);

            const typeSelect = newRow.querySelector(".tx-type");
            const amountEl = newRow.querySelector(".tx-amount");
            if (typeSelect && amountEl) applyAmountTypeDataset(amountEl, typeSelect.value);

            attachRowListeners(newRow);

            showToast("Transaction added!", "success");

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
 * Apply dataset types on load for all rows
 */
function applyAllTransactionDatasets() {
    document.querySelectorAll("li[data-id]").forEach(row => {
        const typeSelect = row.querySelector(".tx-type");
        const amountEl = row.querySelector(".tx-amount");
        if (typeSelect && amountEl) applyAmountTypeDataset(amountEl, typeSelect.value);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll("li[data-id]").forEach(row => attachRowListeners(row));
    applyAllTransactionDatasets();

    const addTransactionForm = document.querySelector('form[action*="add_transaction"]');
    if (addTransactionForm) handleAddTransactionForm(addTransactionForm);

    await updateSummaryUI();
});

export { saveTransaction };
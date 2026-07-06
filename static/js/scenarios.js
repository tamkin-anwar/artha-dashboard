// static/js/scenarios.js
import { formatMoney } from "./currency.js";

function applyMoneyFormatting() {
    document.querySelectorAll(".scenario-money[data-money-value]").forEach((el) => {
        const num = parseFloat(el.getAttribute("data-money-value"));
        if (!Number.isFinite(num)) return;

        const signed = el.getAttribute("data-money-signed") === "true";
        const suffix = el.getAttribute("data-money-suffix") || "";
        const formatted = formatMoney(Math.abs(num));

        el.textContent = (signed ? (num >= 0 ? "+" : "-") + formatted : formatted) + suffix;
    });
}

function initScaleLabels() {
    document.querySelectorAll('input[type="range"][id]').forEach((input) => {
        const label = document.querySelector(`.scenario-scale-value[data-for="${input.id}"]`);
        if (!label) return;
        input.addEventListener("input", () => {
            label.textContent = input.value;
        });
    });
}

function initDeleteConfirm() {
    document.querySelectorAll(".scenario-delete-form").forEach((form) => {
        form.addEventListener("submit", (e) => {
            if (!window.confirm("Delete this scenario? This can't be undone.")) {
                e.preventDefault();
            }
        });
    });
}

function initScenarios() {
    applyMoneyFormatting();
    initScaleLabels();
    initDeleteConfirm();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScenarios);
} else {
    initScenarios();
}

document.addEventListener("currency-refresh-ui", applyMoneyFormatting);

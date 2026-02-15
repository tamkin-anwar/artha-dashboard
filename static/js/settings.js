// static/js/settings.js (module)

import { setCurrencyCode, getCurrencyCode, applyCurrencyToAmountPrefixes } from "./currency.js";

function setSelectValueIfPresent(selectEl, value) {
    if (!selectEl) return;
    const optionExists = Array.from(selectEl.options).some((opt) => opt.value === value);
    if (optionExists) selectEl.value = value;
}

function syncCurrencySelects(code) {
    setSelectValueIfPresent(document.getElementById("currency-select"), code);
    setSelectValueIfPresent(document.getElementById("currency-select-mobile"), code);
}

function applyCurrencyEverywhere() {
    applyCurrencyToAmountPrefixes();
    document.dispatchEvent(new CustomEvent("currency-refresh-ui"));
}

function bindCurrencySelect(selectEl) {
    if (!selectEl) return;

    if (selectEl.dataset.bound === "1") return;
    selectEl.dataset.bound = "1";

    selectEl.addEventListener("change", () => {
        const code = selectEl.value;
        const saved = setCurrencyCode(code);

        syncCurrencySelects(saved);
        applyCurrencyEverywhere();
    });
}

function initCurrency() {
    const saved = getCurrencyCode();

    syncCurrencySelects(saved);

    bindCurrencySelect(document.getElementById("currency-select"));
    bindCurrencySelect(document.getElementById("currency-select-mobile"));

    applyCurrencyEverywhere();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCurrency);
} else {
    initCurrency();
}
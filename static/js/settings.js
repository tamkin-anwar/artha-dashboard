// static/js/settings.js
import { getCurrencyCode, setCurrencyCode, applyCurrencyToAmountPrefixes } from "./currency.js";
import { updateChartData } from "./chart.js";

function setSelectValue(select, value) {
    if (!select) return;
    select.value = value;
}

function bindCurrencySelects() {
    const desktop = document.getElementById("currency-select");
    const mobile = document.getElementById("currency-select-mobile");
    if (!desktop && !mobile) return;

    const applyValueEverywhere = (value) => {
        setSelectValue(desktop, value);
        setSelectValue(mobile, value);
    };

    const handleChange = async (value) => {
        setCurrencyCode(value);
        applyValueEverywhere(value);

        applyCurrencyToAmountPrefixes();
        document.dispatchEvent(new CustomEvent("currency-refresh-ui"));

        try {
            await updateChartData();
        } catch {}
    };

    const initial = getCurrencyCode();
    applyValueEverywhere(initial);
    applyCurrencyToAmountPrefixes();

    if (desktop) {
        desktop.addEventListener("change", (e) => handleChange(e.target.value));
    }
    if (mobile) {
        mobile.addEventListener("change", (e) => handleChange(e.target.value));
    }
}

function initSettings() {
    bindCurrencySelects();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSettings);
} else {
    initSettings();
}
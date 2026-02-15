// static/js/currency.js

const STORAGE_KEY = "artha_currency";

const FALLBACK = {
    code: "USD",
    locale: "en-US",
};

const CURRENCY_PRESETS = {
    USD: { code: "USD", locale: "en-US", symbol: "$" },
    GBP: { code: "GBP", locale: "en-GB", symbol: "£" },
    EUR: { code: "EUR", locale: "de-DE", symbol: "€" },
    BDT: { code: "BDT", locale: "bn-BD", symbol: "৳" },
    CAD: { code: "CAD", locale: "en-CA", symbol: "$" },
    AUD: { code: "AUD", locale: "en-AU", symbol: "$" },
};

function safeGetPreset(code) {
    return CURRENCY_PRESETS[code] || CURRENCY_PRESETS[FALLBACK.code];
}

export function getCurrencyCode() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return FALLBACK.code;
    return safeGetPreset(stored).code;
}

export function getCurrencyPreset() {
    return safeGetPreset(getCurrencyCode());
}

export function setCurrencyCode(code) {
    const preset = safeGetPreset(code);
    localStorage.setItem(STORAGE_KEY, preset.code);
    document.dispatchEvent(new CustomEvent("currency-changed", { detail: { currency: preset.code } }));
    return preset.code;
}

export function formatMoney(value) {
    const preset = getCurrencyPreset();
    const num = Number(value);
    const safeNumber = Number.isFinite(num) ? num : 0;

    try {
        return new Intl.NumberFormat(preset.locale, {
            style: "currency",
            currency: preset.code,
            maximumFractionDigits: 2,
        }).format(safeNumber);
    } catch {
        const symbol = preset.symbol || "$";
        return `${symbol}${safeNumber.toFixed(2)}`;
    }
}

export function applyCurrencyToAmountPrefixes() {
    const preset = getCurrencyPreset();
    document.querySelectorAll("[data-currency-symbol]").forEach((el) => {
        el.textContent = preset.symbol || "$";
    });
}
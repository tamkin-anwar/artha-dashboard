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

    // Lakh crore grouping with Latin digits and "৳ 1,00,000.00" style
    BDT: { code: "BDT", locale: "en-IN", symbol: "৳" },

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

    document.dispatchEvent(
        new CustomEvent("currency-changed", { detail: { currency: preset.code } })
    );

    return preset.code;
}

function intlCurrencyParts(preset, safeNumber) {
    return new Intl.NumberFormat(preset.locale, {
        style: "currency",
        currency: preset.code,
        maximumFractionDigits: 2,
        numberingSystem: "latn",
    }).formatToParts(safeNumber);
}

export function formatMoney(value) {
    const preset = getCurrencyPreset();
    const num = Number(value);
    const safeNumber = Number.isFinite(num) ? num : 0;

    try {
        // Default formatting for most currencies
        const formatted = new Intl.NumberFormat(preset.locale, {
            style: "currency",
            currency: preset.code,
            maximumFractionDigits: 2,
            numberingSystem: "latn",
        }).format(safeNumber);

        // For BDT, force "৳ " prefix with a space, keep en-IN grouping and Latin digits
        if (preset.code === "BDT") {
            const parts = intlCurrencyParts(preset, safeNumber);
            const numberOnly = parts
                .filter((p) => p.type !== "currency" && p.type !== "literal")
                .map((p) => p.value)
                .join("");

            // The above removes separators in some locales, so build it correctly:
            // Better approach: take everything except the currency symbol, then trim.
            const withoutCurrency = parts
                .filter((p) => p.type !== "currency")
                .map((p) => p.value)
                .join("")
                .trim();

            return `${preset.symbol} ${withoutCurrency}`;
        }

        return formatted;
    } catch {
        const symbol = preset.symbol || "$";
        return preset.code === "BDT"
            ? `${symbol} ${safeNumber.toFixed(2)}`
            : `${symbol}${safeNumber.toFixed(2)}`;
    }
}

export function applyCurrencyToAmountPrefixes() {
    const preset = getCurrencyPreset();
    document.querySelectorAll("[data-currency-symbol]").forEach((el) => {
        el.textContent = preset.symbol || "$";
    });
}
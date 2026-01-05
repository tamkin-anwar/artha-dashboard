document.addEventListener("DOMContentLoaded", () => {
    const calcDisplay = document.getElementById("calc-display");
    const buttons = document.querySelectorAll(".calc-btn");
    const equals = document.getElementById("calc-equals");
    if (!calcDisplay || !buttons.length || !equals) return;

    let lastInputWasError = false;

    // --- Load saved value ---
    const savedValue = localStorage.getItem('calc-last-value');
    if (savedValue) calcDisplay.value = savedValue;

    function saveValue() {
        localStorage.setItem('calc-last-value', calcDisplay.value);
    }

    function prepareForInput() {
        if (lastInputWasError) {
            calcDisplay.value = "";
            lastInputWasError = false;
        }
    }

    function appendInput(char) {
        prepareForInput();
        const operators = ["+", "-", "*", "/"];
        const lastChar = calcDisplay.value.slice(-1);

        if (operators.includes(char)) {
            if (calcDisplay.value === "" && char !== "-") return;
            if (operators.includes(lastChar) && !(char === "-" && lastChar !== "-")) {
                calcDisplay.value = calcDisplay.value.slice(0, -1) + char;
                return;
            }
        }
        calcDisplay.value += char;
    }

    // --- Handle button clicks ---
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const val = btn.textContent;
            if (val === "C") {
                calcDisplay.value = "";
                lastInputWasError = false;
                saveValue();
            } else {
                appendInput(val);
                saveValue();
            }
        });
    });

    // --- Handle equals click ---
    equals.addEventListener("click", () => {
        try {
            const result = evaluateExpression(calcDisplay.value);
            calcDisplay.value = result;
            lastInputWasError = false;
        } catch {
            calcDisplay.value = "Error";
            lastInputWasError = true;
        }
        saveValue();
    });

    // --- Keyboard input only when focused ---
    calcDisplay.addEventListener("keydown", e => {
        e.stopPropagation();
        const allowedKeys = "0123456789+-*/().";
        if (allowedKeys.includes(e.key)) {
            e.preventDefault();
            appendInput(e.key);
            saveValue();
        } else if (e.key === "Enter") {
            e.preventDefault();
            equals.click();
        } else if (e.key === "Backspace") {
            e.preventDefault();
            prepareForInput();
            calcDisplay.value = calcDisplay.value.slice(0, -1);
            saveValue();
        } else if (e.key === "Escape") {
            e.preventDefault();
            calcDisplay.value = "";
            lastInputWasError = false;
            saveValue();
        }
    });

    calcDisplay.addEventListener('blur', saveValue);

    function evaluateExpression(expr) {
        expr = expr.replace(/[^0-9+\-*/(). ]/g, "");
        if (window.math) {
            return math.evaluate(expr).toString();
        } else {
            const tokens = expr.match(/(\d+(\.\d+)?|\+|\-|\*|\/|\(|\))/g) || [];
            if (tokens.length === 0) return "0";
            const safeExpr = tokens.join(" ");
            const fn = new Function(`"use strict"; return (${safeExpr})`);
            const result = fn();
            if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
                return result.toString();
            } else {
                throw new Error("Invalid calculation result");
            }
        }
    }

    // --- Theme adaptation ---
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    function updateCalcButtonColors() {
        const textColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-color').trim() || '#000';
        buttons.forEach(btn => btn.style.color = textColor);
        equals.style.color = textColor;
    }
    updateCalcButtonColors();
    prefersDark.addEventListener('change', updateCalcButtonColors);
    document.addEventListener('theme-changed', updateCalcButtonColors);

    console.log("Calculator initialized safely (no duplicate guard needed).");
});
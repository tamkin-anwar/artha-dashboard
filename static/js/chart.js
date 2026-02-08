// static/js/chart.js
import { onThemeChange, getCurrentTheme } from "./theme.js";

export let financeChartInstance = null;
export let financeChartData = { income: 0, expense: 0 };

// Utility: get CSS variable value from :root or .dark
function getCSSVariable(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function getLegendColor() {
    const cssColor = getCSSVariable("--legend-color");
    if (cssColor) return cssColor;
    const theme = getCurrentTheme();
    return theme === "dark" ? "#fff" : "#000";
    }

    /**
     * Ensure canvas internal buffer matches CSS size * devicePixelRatio.
     * This is the main fix for blurry/pixelated charts on retina and when CSS scales the canvas.
     * Chart.js will also handle DPR, but we sync here for the spinner + any manual drawing.
     */
    function syncCanvasSize(canvas) {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));

    const dpr = window.devicePixelRatio || 1;
    const internalWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const internalHeight = Math.max(1, Math.floor(cssHeight * dpr));

    // Make sure the element keeps the CSS size while the buffer is DPR-scaled
    if (canvas.style.width !== `${cssWidth}px`) canvas.style.width = `${cssWidth}px`;
    if (canvas.style.height !== `${cssHeight}px`) canvas.style.height = `${cssHeight}px`;

    // Only update if needed to avoid flicker
    if (canvas.width !== internalWidth) canvas.width = internalWidth;
    if (canvas.height !== internalHeight) canvas.height = internalHeight;
    }

    function safeRegisterDatalabels() {
    try {
        if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
        if (!Chart.registry?.plugins?.get?.("datalabels")) {
            Chart.register(ChartDataLabels);
        }
        }
    } catch (e) {
        // Ignore; plugin still can be passed via config
    }
    }

    /**
     * Reset any transforms and scale the 2D context for DPR-correct manual drawing.
     * For Chart.js, it manages its own scaling, but we use this for spinner/fallback text.
     */
    function prepare2dForDpr(canvas, ctx) {
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Return CSS-space dimensions for drawing (not internal buffer)
    return { cssWidth, cssHeight };
    }

    function drawFallbackMessage(canvas, message) {
    if (!canvas?.getContext) return;

    syncCanvasSize(canvas);

    const ctx = canvas.getContext("2d");
    const dims = prepare2dForDpr(canvas, ctx);
    if (!dims) return;

    ctx.clearRect(0, 0, dims.cssWidth, dims.cssHeight);
    ctx.font = "14px Arial";
    ctx.fillStyle = getLegendColor();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message, dims.cssWidth / 2, dims.cssHeight / 2);
    }

    // Initialize the Chart.js doughnut chart
    export function initFinanceChart(ctx, income, expense) {
    const canvas = ctx?.canvas || ctx;

    if (!canvas || !canvas.getContext) {
        console.warn("Invalid canvas context provided to initFinanceChart.");
        return;
    }

    // Ensure crisp canvas before Chart.js lays out
    syncCanvasSize(canvas);

    if (typeof Chart === "undefined") {
        drawFallbackMessage(canvas, "Chart unavailable");
        return;
    }

    safeRegisterDatalabels();

    financeChartData = { income, expense };

    const incomeColor = getCSSVariable("--income-color") || "#10b981";
    const expenseColor = getCSSVariable("--expense-color") || "#ef4444";

    // Destroy existing chart instance to avoid duplicates
    if (financeChartInstance) {
        financeChartInstance.destroy();
        financeChartInstance = null;
    }

    financeChartInstance = new Chart(canvas, {
        type: "doughnut",
        data: {
        labels: ["Income", "Expense"],
        datasets: [
            {
            data: [income, expense],
            backgroundColor: [incomeColor, expenseColor],
            borderColor: "#000000",
            borderWidth: 2,
            },
        ],
        },
        options: {
        responsive: true,
        maintainAspectRatio: false,

        // Force Chart.js to use device pixel ratio correctly
        devicePixelRatio: window.devicePixelRatio || 1,

        plugins: {
            legend: {
            labels: { color: getLegendColor() },
            },
            datalabels: {
            color: getLegendColor(),
            },
            tooltip: {
            titleColor: getLegendColor(),
            bodyColor: getLegendColor(),
            backgroundColor: getCSSVariable("--bg-color") || "#fff",
            },
        },
        },
        plugins: typeof ChartDataLabels !== "undefined" ? [ChartDataLabels] : [],
    });
    }

    // Update the chart data dynamically
    export function updateFinanceChart(income, expense) {
    financeChartData = { income, expense };

    const canvas = document.getElementById("financeChart");
    if (!canvas) return;

    // Keep canvas buffer synced, especially after layout changes
    syncCanvasSize(canvas);

    if (typeof Chart === "undefined") {
        drawFallbackMessage(canvas, "Chart unavailable");
        return;
    }

    if (!financeChartInstance) {
        initFinanceChart(canvas.getContext("2d"), income, expense);
        return;
    }

    financeChartInstance.data.datasets[0].data = [income, expense];
    financeChartInstance.data.datasets[0].borderColor = "#000000";

    // If DPR changed (zoom, screen move), keep Chart.js aligned
    financeChartInstance.options.devicePixelRatio = window.devicePixelRatio || 1;

    financeChartInstance.update();
    }

    // Draw loading spinner on the canvas
    function drawSpinner(canvas, frame = 0) {
    if (!canvas?.getContext) return;

    syncCanvasSize(canvas);

    const ctx = canvas.getContext("2d");
    const dims = prepare2dForDpr(canvas, ctx);
    if (!dims) return;

    ctx.clearRect(0, 0, dims.cssWidth, dims.cssHeight);

    const radius = Math.min(dims.cssWidth, dims.cssHeight) / 6;
    const centerX = dims.cssWidth / 2;
    const centerY = dims.cssHeight / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((frame * Math.PI) / 30);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 1.5);
    ctx.strokeStyle = getLegendColor();
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    }

    let currentAbortController = null;

    // Fetch new chart data and update chart
    export async function updateChartData() {
    const canvas = document.getElementById("financeChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Keep crisp while loading
    syncCanvasSize(canvas);

    if (typeof Chart === "undefined") {
        drawFallbackMessage(canvas, "Chart unavailable");
        return;
    }

    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();

    let frame = 0;
    const spinnerInterval = setInterval(() => drawSpinner(canvas, frame++), 50);

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const scenarioId = urlParams.get("scenario_id");

        let endpoint = "/api/finance_totals";
        if (scenarioId) endpoint += `?scenario_id=${encodeURIComponent(scenarioId)}`;

        const res = await fetch(endpoint, {
        signal: currentAbortController.signal,
        headers: { "X-Requested-With": "XMLHttpRequest" },
        });

        if (!res.ok) throw new Error("Network response was not ok");

        const data = await res.json();
        if (typeof data.income !== "number" || typeof data.expense !== "number") {
        throw new Error("Invalid data format");
        }

        updateFinanceChart(data.income, data.expense);
    } catch (err) {
        if (err.name !== "AbortError") {
        console.error("Failed to update chart:", err);
        drawFallbackMessage(canvas, "Failed to load chart");
        }
    } finally {
        clearInterval(spinnerInterval);
    }
    }

    // Reinitialize chart if DOM replaced
    export function ensureChartIntegrity() {
    const canvas = document.getElementById("financeChart");
    if (canvas && !financeChartInstance) {
        initFinanceChart(canvas.getContext("2d"), financeChartData.income, financeChartData.expense);
    }
    }

    // Keep chart crisp on resize and zoom changes
    let resizeTimeout = null;
    window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const canvas = document.getElementById("financeChart");
        if (!canvas) return;

        syncCanvasSize(canvas);

        if (financeChartInstance) {
        financeChartInstance.options.devicePixelRatio = window.devicePixelRatio || 1;
        financeChartInstance.resize();
        financeChartInstance.update();
        }
    }, 150);
    });

    // Debounced theme change handler to update colors smoothly
    let themeUpdateTimeout = null;
    onThemeChange(() => {
    clearTimeout(themeUpdateTimeout);
    themeUpdateTimeout = setTimeout(() => {
        if (!financeChartInstance) return;

        const newColor = getLegendColor();
        financeChartInstance.options.plugins.legend.labels.color = newColor;

        if (financeChartInstance.options.plugins.datalabels) {
        financeChartInstance.options.plugins.datalabels.color = newColor;
        }

        financeChartInstance.options.plugins.tooltip.titleColor = newColor;
        financeChartInstance.options.plugins.tooltip.bodyColor = newColor;

        financeChartInstance.update();
    }, 100);
    });

    export function getFinanceChartData() {
    return { ...financeChartData };
}
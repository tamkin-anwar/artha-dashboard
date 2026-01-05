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

// Ensure canvas internal size matches CSS size (important for spinner + crisp rendering)
function syncCanvasSize(canvas) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    // Only update if needed to avoid flicker
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
}

function safeRegisterDatalabels() {
    try {
        if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
            // Register only once (Chart.js ignores duplicates but we’ll be neat)
            if (!Chart.registry?.plugins?.get?.("datalabels")) {
                Chart.register(ChartDataLabels);
            }
        }
    } catch (e) {
        // If registry API differs, ignore; passing plugin in chart config still works
    }
}

// Initialize the Chart.js doughnut chart
export function initFinanceChart(ctx, income, expense) {
    if (typeof Chart === "undefined") {
        const canvas = ctx?.canvas || ctx;
        if (canvas?.getContext) {
            syncCanvasSize(canvas);
            const context = canvas.getContext("2d");
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.font = "14px Arial";
            context.fillStyle = getLegendColor();
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText("Chart unavailable", canvas.width / 2, canvas.height / 2);
        }
        return;
    }

    const canvas = ctx?.canvas || ctx;
    if (!canvas || !canvas.getContext) {
        console.warn("Invalid canvas context provided to initFinanceChart.");
        return;
    }

    safeRegisterDatalabels();

    financeChartData = { income, expense };

    const incomeColor = getCSSVariable("--income-color") || "#10b981";
    const expenseColor = getCSSVariable("--expense-color") || "#ef4444";

    // If an instance already exists, destroy to avoid duplicates
    if (financeChartInstance) {
        financeChartInstance.destroy();
        financeChartInstance = null;
    }

    financeChartInstance = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: ["Income", "Expense"],
            datasets: [{
                data: [income, expense],
                backgroundColor: [incomeColor, expenseColor],
                borderColor: "#000000",
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
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
        // If register fails for some reason, this still works:
        plugins: (typeof ChartDataLabels !== "undefined") ? [ChartDataLabels] : [],
    });
}

// Update the chart data and colors dynamically
export function updateFinanceChart(income, expense) {
    financeChartData = { income, expense };

    const canvas = document.getElementById("financeChart");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
        syncCanvasSize(canvas);
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "14px Arial";
        ctx.fillStyle = getLegendColor();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Chart unavailable", canvas.width / 2, canvas.height / 2);
        return;
    }

    if (!financeChartInstance) {
        initFinanceChart(canvas.getContext("2d"), income, expense);
        return;
    }

    financeChartInstance.data.datasets[0].data = [income, expense];
    financeChartInstance.data.datasets[0].borderColor = "#000000";
    financeChartInstance.update();
}

// Draw loading spinner on the canvas
function drawSpinner(canvas, frame = 0) {
    if (!canvas?.getContext) return;
    syncCanvasSize(canvas);

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const radius = Math.min(canvas.width, canvas.height) / 6;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(frame * Math.PI / 30);
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

    if (typeof Chart === "undefined") {
        syncCanvasSize(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "14px Arial";
        ctx.fillStyle = getLegendColor();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Chart unavailable", canvas.width / 2, canvas.height / 2);
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
            headers: { "X-Requested-With": "XMLHttpRequest" }
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
            syncCanvasSize(canvas);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = "14px Arial";
            ctx.fillStyle = getLegendColor();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Failed to load chart", canvas.width / 2, canvas.height / 2);
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

// Debounced theme change handler to update colors smoothly
let themeUpdateTimeout = null;
onThemeChange(() => {
    if (themeUpdateTimeout) clearTimeout(themeUpdateTimeout);
    themeUpdateTimeout = setTimeout(() => {
        if (!financeChartInstance) return;

        const newColor = getLegendColor();
        financeChartInstance.options.plugins.legend.labels.color = newColor;
        financeChartInstance.options.plugins.datalabels.color = newColor;
        financeChartInstance.options.plugins.tooltip.titleColor = newColor;
        financeChartInstance.options.plugins.tooltip.bodyColor = newColor;

        financeChartInstance.update();
    }, 100);
});

export function getFinanceChartData() {
    return { ...financeChartData };
}
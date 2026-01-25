// static/js/init.js (module)

import "./flash.js";
import "./notes.js";
import "./transactions.js";
import "./calculator.js";
import "./theme.js";

import { initWidgetSorting } from "./widgets.js";
import { updateChartData } from "./chart.js";

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        await navigator.serviceWorker.register("/static/service-worker.js");
    } catch (err) {
        console.warn("Service worker registration failed:", err);
    }
}

function createLoadingIndicator() {
    const el = document.createElement("div");
    el.textContent = "Loading dashboard...";
    el.className = "text-center text-gray-500 my-4 animate-pulse";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    return el;
}

function createErrorBanner() {
    const el = document.createElement("div");
    el.textContent = "Failed to load dashboard data. Refresh and try again.";
    el.className = "flash-message text-red-500 text-center my-2";
    el.setAttribute("role", "alert");
    return el;
}

async function initDashboardDataWithRetry({ maxRetries = 3, retryDelayMs = 1500 } = {}) {
    let retryCount = 0;

    while (retryCount <= maxRetries) {
        try {
            await updateChartData();
            return { ok: true, retries: retryCount };
        } catch (err) {
            retryCount += 1;
            if (retryCount > maxRetries) {
                return { ok: false, retries: retryCount, error: err };
            }
            await new Promise(resolve => window.setTimeout(resolve, retryDelayMs));
        }
    }

    return { ok: false, retries: maxRetries + 1 };
}

async function initDashboard() {
    initWidgetSorting();
    await registerServiceWorker();

    const loadingIndicator = createLoadingIndicator();
    document.body.prepend(loadingIndicator);

    const result = await initDashboardDataWithRetry({ maxRetries: 3, retryDelayMs: 1500 });

    loadingIndicator.remove();

    if (result.ok) {
        document.dispatchEvent(
            new CustomEvent("dashboard-ready", { detail: { retries: result.retries } })
        );
        return;
    }

    document.body.prepend(createErrorBanner());
}

window.addEventListener("DOMContentLoaded", initDashboard);
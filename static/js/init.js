// static/js/init.js (module)

// Load modules (side effects / listeners)
import "./flash.js";
import "./notes.js";
import "./transactions.js";
import "./calculator.js";
import "./theme.js";

import { initWidgetSorting } from "./widgets.js";
import { updateChartData } from "./chart.js";

/**
 * Register service worker (PWA)
 */
async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        await navigator.serviceWorker.register("/static/service-worker.js");
    } catch (err) {
        console.warn("Service worker registration failed:", err);
    }
}

/**
 * Initializes dashboard modules and ensures chart data is up to date.
 */
async function initDashboard() {
    initWidgetSorting();
    await registerServiceWorker();

    // Lightweight loading indicator
    const loadingIndicator = document.createElement("div");
    loadingIndicator.textContent = "Loading dashboard...";
    loadingIndicator.className = "text-center text-gray-500 my-4 animate-pulse";
    loadingIndicator.setAttribute("role", "status");
    loadingIndicator.setAttribute("aria-live", "polite");
    document.body.prepend(loadingIndicator);

    let retryCount = 0;
    const maxRetries = 3;

    async function attemptUpdate() {
        try {
            await updateChartData();
            loadingIndicator.remove();
            document.dispatchEvent(new CustomEvent("dashboard-ready", { detail: { retries: retryCount } }));
        } catch (err) {
            retryCount++;
            if (retryCount < maxRetries) {
                setTimeout(attemptUpdate, 1500);
            } else {
                loadingIndicator.remove();
                const errorContainer = document.createElement("div");
                errorContainer.textContent = "⚠️ Failed to load dashboard data. Refresh and try again.";
                errorContainer.className = "flash-message text-red-500 text-center my-2";
                errorContainer.setAttribute("role", "alert");
                document.body.prepend(errorContainer);
            }
        }
    }

    await attemptUpdate();
}

window.addEventListener("DOMContentLoaded", initDashboard);
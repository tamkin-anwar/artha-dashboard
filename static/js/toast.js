// static/js/toast.js
// Accessible, stackable toast notifications with optional action button (e.g., Undo)

let toastQueue = [];
const MAX_TOASTS = 5;

/**
 * Show a toast notification
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} duration - ms (set 0 to persist until manual close)
 * @param {{ actionText?: string, onAction?: Function }} options
 */
export function showToast(message, type = "info", duration = 3000, options = {}) {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "toast-container";
        container.setAttribute("aria-live", "polite");
        document.body.appendChild(container);
    }

    // Limit queue size
    if (toastQueue.length >= MAX_TOASTS) {
        const oldestToast = toastQueue.shift();
        if (oldestToast) removeToast(oldestToast);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "alert");
    toast.tabIndex = 0;

    // Message
    const msgSpan = document.createElement("span");
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    // Optional action button (Undo, Retry, etc.)
    if (options?.actionText && typeof options?.onAction === "function") {
        const actionBtn = document.createElement("button");
        actionBtn.type = "button";
        actionBtn.className = "toast-action-btn";
        actionBtn.textContent = options.actionText;
        actionBtn.addEventListener("click", () => {
            try {
                options.onAction();
            } finally {
                removeToast(toast);
            }
        });

        // Keyboard accessibility
        actionBtn.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                try {
                    options.onAction();
                } finally {
                    removeToast(toast);
                }
            }
        });

        toast.appendChild(actionBtn);
    }

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.setAttribute("aria-label", "Dismiss message");
    closeBtn.innerHTML = "&times;";
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => removeToast(toast));
    closeBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            removeToast(toast);
        }
    });
    toast.appendChild(closeBtn);

    toastQueue.push(toast);
    container.appendChild(toast);

    // Trigger animation
    void toast.offsetWidth;
    toast.classList.add("visible");

    // Auto-remove (if duration > 0), pause on hover
    let autoRemoveTimeout = null;

    const startTimer = () => {
        if (duration <= 0) return;
        autoRemoveTimeout = setTimeout(() => removeToast(toast), duration);
    };

    const stopTimer = () => {
        if (autoRemoveTimeout) clearTimeout(autoRemoveTimeout);
        autoRemoveTimeout = null;
    };

    startTimer();

    toast.addEventListener("mouseenter", stopTimer);
    toast.addEventListener("mouseleave", startTimer);

    toast.addEventListener("transitionend", (e) => {
        if (e.propertyName === "opacity" && toast.classList.contains("exit")) {
            toast.remove();
            toastQueue = toastQueue.filter(t => t !== toast);
        }
    });

    return toast;
}

function removeToast(toast) {
    if (!toast) return;
    toast.classList.remove("visible");
    toast.classList.add("exit");
}
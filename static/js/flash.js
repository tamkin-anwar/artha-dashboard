document.addEventListener("DOMContentLoaded", () => {
    const FADE_DELAY = 4000;
    const FADE_DURATION = 700;

    const flashMessages = document.querySelectorAll(".flash-message");
    if (!flashMessages.length) return;

    // Ensure flash messages are announced to screen readers, and add close button
    flashMessages.forEach(msg => {
        if (!msg.hasAttribute("role")) msg.setAttribute("role", "alert");
        if (!msg.parentElement.hasAttribute("aria-live")) {
            msg.parentElement.setAttribute("aria-live", "assertive");
        }

        // Add close button if not already present
        if (!msg.querySelector(".flash-close-btn")) {
            const closeBtn = document.createElement("button");
            closeBtn.className = "flash-close-btn ml-4 text-white font-bold focus:outline-none focus:ring-2 focus:ring-white rounded";
            closeBtn.setAttribute("aria-label", "Dismiss message");
            closeBtn.innerHTML = "&times;";
            closeBtn.type = "button";
            msg.appendChild(closeBtn);

            // Close handler
            closeBtn.addEventListener("click", () => {
                fadeOutAndRemove(msg);
            });

            // Keyboard accessibility: close on Enter or Space
            closeBtn.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fadeOutAndRemove(msg);
                }
            });
        }
    });

    // Check if CSS transitions are supported before applying fade-out
    const supportsTransitions = 'transition' in document.documentElement.style ||
                                'WebkitTransition' in document.documentElement.style;

    // Helper to fade out and remove element
    function fadeOutAndRemove(element) {
        clearFadeTimers(element);
        if (supportsTransitions) {
            // Use Tailwind style: transition-opacity and duration in ms
            element.classList.add("opacity-0", "transition-opacity", `duration-[${FADE_DURATION}ms]`);
            element._removeTimeout = setTimeout(() => element.remove(), FADE_DURATION);
        } else {
            element.remove();
        }
    }

    // Store timeouts per message for pause/resume logic
    function clearFadeTimers(element) {
        if (element._fadeTimeout) clearTimeout(element._fadeTimeout);
        if (element._removeTimeout) clearTimeout(element._removeTimeout);
    }

    function startFadeTimer(element) {
        element._fadeTimeout = setTimeout(() => {
            fadeOutAndRemove(element);
        }, FADE_DELAY);
    }

    flashMessages.forEach((msg) => {
        // Start fade timer initially
        startFadeTimer(msg);

        // Pause fade on mouse enter
        msg.addEventListener("mouseenter", () => {
            clearFadeTimers(msg);
        });
        // Resume fade on mouse leave
        msg.addEventListener("mouseleave", () => {
            startFadeTimer(msg);
        });
    });
});
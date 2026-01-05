// static/js/theme.js

let currentTheme = "light"; // Tracks the current theme globally

// Configurable toggle button IDs for easier future extension
const toggleButtonIds = ["toggle-theme", "toggle-theme-mobile"];

// Allows other modules to react when theme changes
export function onThemeChange(callback) {
    document.addEventListener("theme-changed", callback);
}

// Allows removing the theme change listener for cleanup
export function removeThemeChangeListener(callback) {
    document.removeEventListener("theme-changed", callback);
}

// Returns the current theme
export function getCurrentTheme() {
    return currentTheme;
}

// Sets the theme explicitly (used by toggleTheme and programmatic calls)
export function setTheme(theme) {
    applyTheme(theme);
}

// Debounce flag to prevent rapid toggles
let toggleDebounce = false;

// Toggles between light and dark themes using centralized applyTheme
export function toggleTheme() {
    if (toggleDebounce) return; // Ignore if toggling too fast
    toggleDebounce = true;
    applyTheme(currentTheme === "dark" ? "light" : "dark");
    setTimeout(() => { toggleDebounce = false; }, 300);
}

// Loads stored theme or system preference on initial load
function loadStoredTheme() {
    let storedTheme = localStorage.getItem("theme");
    if (storedTheme !== "dark" && storedTheme !== "light") {
        storedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        localStorage.setItem("theme", storedTheme);
    }
    setTheme(storedTheme);
}

// Init theme logic on DOM ready
document.addEventListener("DOMContentLoaded", () => {
    loadStoredTheme();

    toggleButtonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener("click", () => {
                toggleTheme();
            });
        }
    });

    // Dispatch event specifically indicating initialization complete
    document.dispatchEvent(new Event("theme-initialized"));
});

// Returns true if the current theme is dark
export function isDarkTheme() {
    return currentTheme === "dark";
}

// Applies theme programmatically with optional callback suppression
export function applyTheme(theme, suppressEvent = false) {
    try {
        const isDark = theme === "dark";
        document.documentElement.classList.toggle("dark", isDark);
        currentTheme = isDark ? "dark" : "light";
        localStorage.setItem("theme", currentTheme);

        // Update aria-pressed to string "true" or "false"
        toggleButtonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.setAttribute("aria-pressed", currentTheme === "dark" ? "true" : "false");
        });

        if (!suppressEvent) {
            document.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme: currentTheme } }));
        }
    } catch (error) {
        console.error("Theme apply failed:", error);
    }
}
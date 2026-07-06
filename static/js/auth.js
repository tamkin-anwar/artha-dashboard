// static/js/auth.js
// Show/hide toggle for password fields on auth pages.

const toggleBtn = document.getElementById("toggle-password");
if (toggleBtn) initPasswordToggle(toggleBtn);

function initPasswordToggle(toggleBtn) {
    const input      = document.getElementById(toggleBtn.getAttribute("aria-controls"));
    const eyeIcon    = document.getElementById("toggle-password-icon-eye");
    const eyeOffIcon = document.getElementById("toggle-password-icon-eye-off");
    if (!input) return;

    toggleBtn.addEventListener("click", () => {
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";

        toggleBtn.setAttribute("aria-pressed", String(visible));
        toggleBtn.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        eyeIcon?.classList.toggle("hidden", visible);
        eyeOffIcon?.classList.toggle("hidden", !visible);
    });
}

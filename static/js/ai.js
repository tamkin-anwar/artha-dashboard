// static/js/ai.js
// Artha AI chat widget — handles /api/ai/chat and /api/ai/insights

const widget = document.getElementById("artha-ai-widget");
if (widget) initAI();

function initAI() {
    const messagesEl  = document.getElementById("ai-messages");
    const emptyState  = document.getElementById("ai-empty-state");
    const inputEl     = document.getElementById("ai-input");
    const sendBtn     = document.getElementById("ai-send-btn");
    const insightsBtn = document.getElementById("ai-insights-btn");
    const clearBtn    = document.getElementById("ai-clear-btn");
    const CSRF        = widget.dataset.csrf;

    // Client-owned conversation history — sent with every request,
    // never stored on the server.
    let history = [];
    let busy    = false;

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    function hideEmpty() {
        if (emptyState) emptyState.style.display = "none";
    }

    function showEmpty() {
        if (emptyState) emptyState.style.display = "";
    }

    function formatText(raw) {
        // Minimal safe rendering: escape HTML, then apply basic markdown.
        return raw
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            .replace(/\n/g, "<br>");
    }

    function appendMessage(role, text) {
        hideEmpty();
        const isUser = role === "user";

        const row = document.createElement("div");
        row.className = `flex ${isUser ? "justify-end" : "justify-start"}`;

        const bubble = document.createElement("div");
        bubble.className = [
            "max-w-[88%] px-3 py-2 rounded-xl text-sm leading-relaxed",
            isUser
                ? "bg-blue-600 text-white rounded-br-none"
                : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-none",
        ].join(" ");

        bubble.innerHTML = formatText(text);
        row.appendChild(bubble);
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendLoading() {
        hideEmpty();
        const row = document.createElement("div");
        row.id = "ai-loading-row";
        row.className = "flex justify-start";
        row.innerHTML = `
            <div class="px-3 py-2.5 rounded-xl rounded-bl-none bg-gray-100 dark:bg-gray-700">
                <span class="flex space-x-1 items-center">
                    <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay:0ms"></span>
                    <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay:120ms"></span>
                    <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay:240ms"></span>
                </span>
            </div>`;
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeLoading() {
        document.getElementById("ai-loading-row")?.remove();
    }

    function appendError(msg) {
        removeLoading();
        const row = document.createElement("div");
        row.className = "flex justify-start";
        row.innerHTML = `
            <div class="max-w-[88%] px-3 py-2 rounded-xl rounded-bl-none text-sm
                        text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20">
                ${msg}
            </div>`;
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // -----------------------------------------------------------------------
    // State management
    // -----------------------------------------------------------------------

    function setBusy(state) {
        busy              = state;
        sendBtn.disabled     = state;
        insightsBtn.disabled = state;
        inputEl.disabled     = state;
        if (state) appendLoading();
        else       removeLoading();
    }

    // -----------------------------------------------------------------------
    // API: chat
    // -----------------------------------------------------------------------

    async function sendMessage(message) {
        if (busy || !message.trim()) return;

        appendMessage("user", message);
        // Push user turn into history before the request so it's part of
        // context, but we send history *without* this latest message since
        // the route appends it internally.
        const historySnapshot = [...history];
        history.push({ role: "user", content: message });
        setBusy(true);

        try {
            const res  = await fetch("/api/ai/chat", {
                method:  "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken":  CSRF,
                },
                body: JSON.stringify({ message, history: historySnapshot }),
            });

            const data = await res.json();
            setBusy(false);

            if (!res.ok || data.error) {
                appendError(data.error || "Something went wrong — please try again.");
                history.pop(); // remove the failed user turn
                return;
            }

            appendMessage("assistant", data.reply);
            history.push({ role: "assistant", content: data.reply });

        } catch {
            setBusy(false);
            appendError("Network error — check your connection.");
            history.pop();
        }
    }

    // -----------------------------------------------------------------------
    // API: insights
    // -----------------------------------------------------------------------

    async function fetchInsights() {
        if (busy) return;
        hideEmpty();
        setBusy(true);

        try {
            const res  = await fetch("/api/ai/insights", {
                method:  "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken":  CSRF,
                },
            });

            const data = await res.json();
            setBusy(false);

            if (!res.ok || data.error) {
                appendError(data.error || "Could not generate insights.");
                return;
            }

            appendMessage("assistant", data.insights);
            history.push({ role: "assistant", content: data.insights });

        } catch {
            setBusy(false);
            appendError("Network error — check your connection.");
        }
    }

    // -----------------------------------------------------------------------
    // Clear conversation
    // -----------------------------------------------------------------------

    function clearConversation() {
        if (busy) return;
        history = [];
        messagesEl.innerHTML = "";
        // Re-add empty state element
        const empty = document.createElement("div");
        empty.id = "ai-empty-state";
        empty.className = "flex flex-col items-center justify-center h-full text-center";
        empty.innerHTML = `
            <p class="text-gray-400 dark:text-gray-500 text-sm">Ask me anything about your finances.</p>
            <p class="text-gray-300 dark:text-gray-600 text-xs mt-1">Or hit <span class="font-medium">✦ Insights</span> for an instant report.</p>`;
        messagesEl.appendChild(empty);
    }

    // -----------------------------------------------------------------------
    // Event listeners
    // -----------------------------------------------------------------------

    sendBtn.addEventListener("click", () => {
        const msg = inputEl.value.trim();
        if (!msg) return;
        inputEl.value = "";
        sendMessage(msg);
    });

    inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const msg = inputEl.value.trim();
            if (!msg) return;
            inputEl.value = "";
            sendMessage(msg);
        }
    });

    insightsBtn.addEventListener("click", fetchInsights);
    clearBtn.addEventListener("click", clearConversation);
}

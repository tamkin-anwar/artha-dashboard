// static/js/widgets.js (module)

function packMasonryGrid(container) {
    const styles = window.getComputedStyle(container);

    const rowHeight = parseFloat(styles.getPropertyValue("grid-auto-rows")) || 10;

    const rowGapRaw =
        styles.getPropertyValue("row-gap") ||
        styles.getPropertyValue("gap") ||
        "0px";

    const rowGap = parseFloat(rowGapRaw) || 0;

    const children = Array.from(container.children).filter((el) => el.classList?.contains("widget"));

    children.forEach((widget) => {
        widget.style.gridRowEnd = "";
    });

    children.forEach((widget) => {
        const fullHeight = widget.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((fullHeight + rowGap) / (rowHeight + rowGap)));
        widget.style.gridRowEnd = `span ${span}`;
    });
}

function rafPack(container) {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => packMasonryGrid(container));
    });
}

function debounce(fn, waitMs) {
    let t = null;
    return (...args) => {
        if (t) window.clearTimeout(t);
        t = window.setTimeout(() => fn(...args), waitMs);
    };
}

function setupAutoPacking(container) {
    let isDragging = false;

    const safePack = () => {
        if (!isDragging) rafPack(container);
    };

    const onResize = debounce(() => safePack(), 120);
    window.addEventListener("resize", onResize);

    const widgetResizeObserver = new ResizeObserver(() => {
        safePack();
    });

    Array.from(container.children).forEach((widget) => {
        if (widget.classList?.contains("widget")) widgetResizeObserver.observe(widget);
    });

    const mutationObserver = new MutationObserver(() => {
        safePack();
    });

    mutationObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    rafPack(container);

    return {
        setDragging(value) {
            isDragging = value;
            if (!isDragging) rafPack(container);
        },
    };
}

function ensureWidgetHandle(widget) {
    if (!widget || !widget.classList?.contains("widget")) return;

    // If a handle already exists, do nothing
    if (widget.querySelector(".widget-handle")) return;

    const handle = document.createElement("div");
    handle.className =
        "widget-handle flex items-center justify-between mb-3 px-3 py-2 rounded-lg " +
        "bg-gray-200/70 dark:bg-gray-800/60 text-gray-700 dark:text-gray-200 " +
        "select-none cursor-move";
    handle.setAttribute("role", "button");
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("aria-label", "Drag widget");

    const left = document.createElement("div");
    left.className = "flex items-center gap-2";

    const grip = document.createElement("span");
    grip.className = "text-lg leading-none";
    grip.textContent = "⋮⋮";

    const label = document.createElement("span");
    label.className = "text-sm font-semibold";
    label.textContent = "Move";

    left.appendChild(grip);
    left.appendChild(label);

    const hint = document.createElement("span");
    hint.className = "text-xs opacity-70";
    hint.textContent = "Drag here";

    handle.appendChild(left);
    handle.appendChild(hint);

    // Insert handle as the first child so it sits above widget content
    widget.insertBefore(handle, widget.firstChild);

    // Improve scroll behavior on touch devices
    // Drag starts only from the handle, so allow normal scroll elsewhere
    handle.style.touchAction = "none";
}

export function initWidgetSorting() {
    const container = document.getElementById("dashboard-widgets");
    if (!container) return;

    // Inject handles for every widget so drag only works from the top bar everywhere
    Array.from(container.children).forEach((widget) => ensureWidgetHandle(widget));

    const savedOrder = JSON.parse(localStorage.getItem("widgetOrder"));
    if (savedOrder && savedOrder.length) {
        const widgetMap = {};
        Array.from(container.children).forEach((widget) => {
            if (widget.id) widgetMap[widget.id] = widget;
        });

        savedOrder.forEach((id) => {
            if (widgetMap[id]) container.appendChild(widgetMap[id]);
        });
    }

    const packingController = setupAutoPacking(container);

    if (typeof Sortable === "undefined") {
        console.warn("SortableJS not loaded.");
        return;
    }

    new Sortable(container, {
        animation: 200,
        ghostClass: "widget-ghost",
        chosenClass: "widget-chosen",
        dragClass: "widget-drag",

        draggable: ".widget",
        handle: ".widget-handle",

        // Helps prevent accidental drags while scrolling on touch
        delay: 150,
        delayOnTouchOnly: true,
        touchStartThreshold: 10,

        forceFallback: true,

        onStart: () => {
            packingController.setDragging(true);
            rafPack(container);
        },
        onEnd: () => {
            const order = Array.from(container.children)
                .filter((el) => el.classList?.contains("widget"))
                .map((widget) => widget.id);

            localStorage.setItem("widgetOrder", JSON.stringify(order));
            packingController.setDragging(false);
        },
    });
}
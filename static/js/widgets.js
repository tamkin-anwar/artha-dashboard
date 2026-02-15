// static/js/widgets.js (module)

function packMasonryGrid(container) {
    const styles = window.getComputedStyle(container);
    const rowHeight = parseFloat(styles.getPropertyValue("grid-auto-rows")) || 10;

    const rowGapRaw =
        styles.getPropertyValue("row-gap") ||
        styles.getPropertyValue("gap") ||
        "0px";

    const rowGap = parseFloat(rowGapRaw) || 0;

    const children = Array.from(container.children).filter((el) =>
        el.classList && el.classList.contains("widget")
    );

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
        if (widget.classList && widget.classList.contains("widget")) {
            widgetResizeObserver.observe(widget);
        }
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

function isInteractiveElement(el) {
    if (!el) return false;

    const selector =
        "input, textarea, select, button, a, label, [contenteditable='true'], [role='button'], [role='textbox']";

    return Boolean(el.closest(selector));
}

function ensureDragZones(container) {
    const widgets = Array.from(container.querySelectorAll(".widget"));

    widgets.forEach((widget) => {
        if (widget.querySelector(".widget-drag-zone")) return;

        const zone = document.createElement("div");
        zone.className = "widget-drag-zone";
        zone.setAttribute("aria-hidden", "true");

        widget.prepend(zone);
    });
}

export function initWidgetSorting() {
    const container = document.getElementById("dashboard-widgets");
    if (!container) return;

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

    ensureDragZones(container);

    new Sortable(container, {
        animation: 200,
        ghostClass: "widget-ghost",
        chosenClass: "widget-chosen",
        dragClass: "widget-drag",

        draggable: ".widget",
        handle: ".widget-drag-zone",

        delay: 140,
        delayOnTouchOnly: true,
        touchStartThreshold: 8,

        scroll: true,
        scrollSensitivity: 60,
        scrollSpeed: 14,

        forceFallback: true,
        fallbackTolerance: 6,

        onMove: (evt) => {
            if (isInteractiveElement(evt.originalEvent?.target)) return false;
            return true;
        },

        onStart: () => {
            packingController.setDragging(true);
            document.documentElement.classList.add("is-widget-dragging");
            rafPack(container);
        },

        onEnd: () => {
            const order = Array.from(container.children).map((widget) => widget.id);
            localStorage.setItem("widgetOrder", JSON.stringify(order));
            packingController.setDragging(false);
            document.documentElement.classList.remove("is-widget-dragging");
        },
    });
}
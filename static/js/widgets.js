// static/js/widgets.js (module)

export function initWidgetSorting() {
    const container = document.getElementById("dashboard-widgets");
    if (!container) return;

    // Load widget order from localStorage
    const savedOrder = JSON.parse(localStorage.getItem("widgetOrder"));
    if (savedOrder && savedOrder.length) {
        const widgetMap = {};
        Array.from(container.children).forEach(widget => {
            if (widget.id) widgetMap[widget.id] = widget;
        });

        savedOrder.forEach(id => {
            if (widgetMap[id]) container.appendChild(widgetMap[id]);
        });
    }

    // Enable drag-and-drop sorting
    if (typeof Sortable === "undefined") {
        console.warn("SortableJS not loaded.");
        return;
    }

    new Sortable(container, {
        animation: 200,
        ghostClass: "",
        onEnd: () => {
            const order = Array.from(container.children).map(widget => widget.id);
            localStorage.setItem("widgetOrder", JSON.stringify(order));
        }
    });
}
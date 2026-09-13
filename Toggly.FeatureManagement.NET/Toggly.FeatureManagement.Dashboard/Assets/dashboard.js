document.addEventListener("DOMContentLoaded", () => {
    const summary = document.querySelector(".validation-summary-errors");
    if (summary) summary.focus();
    document.querySelectorAll("form[data-unsaved-warning]").forEach(form => {
        let dirty = false;
        form.addEventListener("input", () => { dirty = true; });
        form.addEventListener("change", () => { dirty = true; });
        form.addEventListener("submit", () => { dirty = false; });
        window.addEventListener("beforeunload", event => {
            if (dirty) {
                event.preventDefault();
                event.returnValue = "";
            }
        });
    });
});

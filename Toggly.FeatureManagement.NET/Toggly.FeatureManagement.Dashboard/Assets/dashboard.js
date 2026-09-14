document.addEventListener("DOMContentLoaded", () => {
    const summary = document.querySelector(".validation-summary-errors");
    if (summary) summary.focus();

    document.querySelectorAll("form[data-unsaved-warning]").forEach(form => {
        let dirty = false;
        form.addEventListener("input", () => { dirty = true; });
        form.addEventListener("change", () => { dirty = true; });
        form.addEventListener("submit", () => { dirty = false; });
        form.dataset.dirtyTracker = "true";
        form._togglyIsDirty = () => dirty;
        form._togglyClearDirty = () => { dirty = false; };
        window.addEventListener("beforeunload", event => {
            if (dirty) {
                event.preventDefault();
                event.returnValue = "";
            }
        });
    });

    const confirmIfDirty = (next) => {
        const open = document.querySelector(".conditions-form.is-open");
        if (open && typeof open._togglyIsDirty === "function" && open._togglyIsDirty()) {
            if (!window.confirm("You have unsaved condition changes. Leave this feature and discard them?")) return;
            open._togglyClearDirty();
        }
        next();
    };

    const collapse = (form) => {
        form.classList.remove("is-open");
        form.classList.add("is-collapsed");
        form.closest(".feature-card")?.classList.remove("is-expanded");
        form._togglyClearDirty?.();
    };

    const expand = (card) => {
        const form = card.querySelector("[data-conditions-form]");
        if (!form) return;
        form.classList.add("is-open");
        form.classList.remove("is-collapsed");
        card.classList.add("is-expanded");
    };

    document.querySelectorAll("[data-feature-toggle]").forEach(toggle => {
        toggle.addEventListener("click", event => event.stopPropagation());
        toggle.addEventListener("change", () => {
            const card = toggle.closest(".feature-card");
            const form = card.querySelector("[data-conditions-form]");
            const enabledField = form.querySelector("[data-enabled-field]");
            const copy = form.querySelector("[data-turn-off-copy]");
            const turnOff = form.querySelector("[data-turn-off]");
            const persistedOn = card.dataset.persistedEnabled === "true";
            const ruleCount = Number(card.dataset.persistedRuleCount || "0");
            confirmIfDirty(() => {
                document.querySelectorAll(".conditions-form.is-open").forEach(open => {
                    if (open !== form) collapse(open);
                });
                enabledField.value = toggle.checked ? "true" : "false";
                if (toggle.checked) {
                    copy.classList.add("is-hidden");
                    turnOff.hidden = false;
                    if (!persistedOn && ruleCount === 0 && !form.querySelector('[data-rule-name="AlwaysOn"]')) {
                        const select = form.querySelector('select[name="newRuleName"]');
                        if (select) select.value = "AlwaysOn";
                    }
                    expand(card);
                } else {
                    copy.classList.remove("is-hidden");
                    turnOff.hidden = true;
                    expand(card);
                }
            });
            if (form.classList.contains("is-collapsed")) toggle.checked = persistedOn;
        });
    });

    document.querySelectorAll("[data-turn-off]").forEach(button => {
        button.addEventListener("click", () => {
            const form = button.closest("[data-conditions-form]");
            const toggle = form.closest(".feature-card").querySelector("[data-feature-toggle]");
            form.querySelector("[data-enabled-field]").value = "false";
            toggle.checked = false;
            form.querySelector("[data-turn-off-copy]").classList.remove("is-hidden");
            button.hidden = true;
        });
    });

    document.querySelectorAll("[data-close-conditions]").forEach(button => {
        button.addEventListener("click", () => {
            const form = button.closest("[data-conditions-form]");
            const card = form.closest(".feature-card");
            const toggle = card.querySelector("[data-feature-toggle]");
            collapse(form);
            toggle.checked = card.dataset.persistedEnabled === "true";
        });
    });

    document.querySelectorAll(".tab, .rail-link, .feature-name, .button[href]").forEach(link => {
        link.addEventListener("click", event => {
            const open = document.querySelector(".conditions-form.is-open");
            if (open && typeof open._togglyIsDirty === "function" && open._togglyIsDirty()) {
                if (!window.confirm("You have unsaved condition changes. Leave this feature and discard them?")) {
                    event.preventDefault();
                } else open._togglyClearDirty();
            }
        });
    });

    const modal = document.getElementById("copy-csharp-modal");
    const openCopy = document.querySelector("[data-open-copy-csharp]");
    const status = modal?.querySelector(".copy-status");
    openCopy?.addEventListener("click", () => { modal.hidden = false; });
    modal?.querySelector("[data-close-copy-csharp]")?.addEventListener("click", () => { modal.hidden = true; });
    modal?.querySelector("[data-copy-csharp]")?.addEventListener("click", async () => {
        const text = document.getElementById("copy-csharp-source")?.textContent ?? "";
        try {
            await navigator.clipboard.writeText(text);
            if (status) status.textContent = "Copied C# to the clipboard.";
        } catch {
            if (status) status.textContent = "Copy failed. Select the sample and copy it manually.";
        }
    });
});

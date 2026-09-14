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

    const serialize = (form) => new URLSearchParams(new FormData(form)).toString();
    const leaveMessage = "You have unsaved condition changes. Leave this feature and discard them?";

    document.querySelectorAll("[data-conditions-form]").forEach(form => {
        form._snapshot = form.innerHTML;
        form._baseline = serialize(form);
    });

    const isDirty = (form) => form.dataset.serverDraft === "true" || serialize(form) !== form._baseline;

    const persistToggle = (card) => card.querySelector("[data-feature-toggle]");

    const collapse = (form) => {
        form.classList.remove("is-open");
        form.classList.add("is-collapsed");
        form.closest(".feature-card")?.classList.remove("is-expanded");
    };

    const expand = (card) => {
        const form = card.querySelector("[data-conditions-form]");
        if (!form) return;
        form.classList.add("is-open");
        form.classList.remove("is-collapsed");
        card.classList.add("is-expanded");
    };

    const restore = (form) => {
        form.innerHTML = form._snapshot;
        form._baseline = serialize(form);
        const card = form.closest(".feature-card");
        const toggle = persistToggle(card);
        if (toggle) toggle.checked = card.dataset.persistedEnabled === "true";
        form.dataset.serverDraft = "false";
    };

    const discard = (form) => {
        if (form.dataset.serverDraft === "true" && form.dataset.listHref) {
            window.location.assign(form.dataset.listHref);
            return true;
        }
        restore(form);
        collapse(form);
        return false;
    };

    const confirmIfDirty = (next) => {
        const open = document.querySelector(".conditions-form.is-open");
        if (open && isDirty(open)) {
            if (!window.confirm(leaveMessage)) return false;
            if (discard(open)) return false;
        } else if (open) collapse(open);
        next();
        return true;
    };

    const setEnabled = (form, on) => {
        const field = form.querySelector("[data-enabled-field]");
        if (field) field.value = on ? "true" : "false";
        const copy = form.querySelector("[data-turn-off-copy]");
        const turnOff = form.querySelector("[data-turn-off]");
        copy?.classList.toggle("is-hidden", on);
        if (turnOff) turnOff.hidden = !on;
    };

    const ensureAlwaysOn = (form) => {
        if (form.querySelector('[data-rule-name="AlwaysOn"]')) return;
        const template = document.getElementById("toggly-always-on-rule");
        const userGroup = form.querySelector("[data-user-group]");
        if (!template || !userGroup) return;
        const index = form.querySelectorAll(".rule-row").length;
        const holder = document.createElement("div");
        holder.innerHTML = template.innerHTML.replaceAll("INDEX", String(index));
        const row = holder.firstElementChild;
        const label = userGroup.querySelector('label[for^="new-user-filter-"]');
        userGroup.insertBefore(row, label);
    };

    const applyDraftOn = (card, form, toggle) => {
        setEnabled(form, true);
        toggle.checked = true;
        const persistedOn = card.dataset.persistedEnabled === "true";
        const ruleCount = Number(card.dataset.persistedRuleCount || "0");
        if (!persistedOn && ruleCount === 0) ensureAlwaysOn(form);
        expand(card);
    };

    const applyDraftOff = (card, form, toggle) => {
        setEnabled(form, false);
        toggle.checked = false;
        expand(card);
    };

    window.addEventListener("beforeunload", event => {
        const open = document.querySelector(".conditions-form.is-open");
        if (open && isDirty(open)) {
            event.preventDefault();
            event.returnValue = "";
        }
    });

    document.addEventListener("change", event => {
        const toggle = event.target.closest("[data-feature-toggle]");
        if (!toggle) return;
        const card = toggle.closest(".feature-card");
        const form = card?.querySelector("[data-conditions-form]");
        if (!card || !form) return;
        const intended = toggle.checked;
        const open = document.querySelector(".conditions-form.is-open");
        if (open && open !== form && isDirty(open)) {
            if (!window.confirm(leaveMessage)) {
                toggle.checked = card.dataset.persistedEnabled === "true";
                return;
            }
            if (discard(open)) {
                toggle.checked = card.dataset.persistedEnabled === "true";
                return;
            }
        } else if (open && open !== form) collapse(open);
        if (card.dataset.persistedEnabled === "true" && !intended) {
            toggle.checked = true;
            applyDraftOn(card, form, toggle);
            return;
        }
        if (intended) applyDraftOn(card, form, toggle);
        else applyDraftOff(card, form, toggle);
    });

    document.addEventListener("click", event => {
        const toggleHit = event.target.closest("label.toggle, [data-feature-toggle]");
        if (toggleHit) {
            const card = toggleHit.closest(".feature-card");
            const toggle = card?.querySelector("[data-feature-toggle]");
            const form = card?.querySelector("[data-conditions-form]");
            if (card && toggle && form && card.dataset.persistedEnabled === "true" && toggle.checked) {
                event.preventDefault();
                const open = document.querySelector(".conditions-form.is-open");
                if (open && open !== form && isDirty(open)) {
                    if (!window.confirm(leaveMessage)) return;
                    if (discard(open)) return;
                } else if (open && open !== form) collapse(open);
                applyDraftOn(card, form, toggle);
                return;
            }
        }

        const leave = event.target.closest(".tab, .rail-link, .feature-name, a.button[href]");
        if (leave) {
            const open = document.querySelector(".conditions-form.is-open");
            if (open && isDirty(open) && !window.confirm(leaveMessage)) {
                event.preventDefault();
            }
            return;
        }

        const close = event.target.closest("[data-close-conditions]");
        if (close) {
            const form = close.closest("[data-conditions-form]");
            if (form) discard(form);
            return;
        }

        const turnOff = event.target.closest("[data-turn-off]");
        if (turnOff) {
            const form = turnOff.closest("[data-conditions-form]");
            const card = form?.closest(".feature-card");
            if (form && card) applyDraftOff(card, form, persistToggle(card));
            return;
        }

        const card = event.target.closest(".feature-card");
        if (card && !event.target.closest("a, button, input, select, textarea, label.toggle, .conditions-form")) {
            const form = card.querySelector("[data-conditions-form]");
            if (!form || form.classList.contains("is-open")) return;
            if (card.dataset.persistedEnabled !== "true") return;
            confirmIfDirty(() => {
                persistToggle(card).checked = true;
                applyDraftOn(card, form, persistToggle(card));
            });
        }
    });

    document.querySelector("form.filters")?.addEventListener("submit", event => {
        const open = document.querySelector(".conditions-form.is-open");
        if (open && isDirty(open) && !window.confirm(leaveMessage)) event.preventDefault();
    });

    const modal = document.getElementById("copy-csharp-modal");
    const openCopy = document.querySelector("[data-open-copy-csharp]");
    const status = modal?.querySelector(".copy-status");
    let lastFocus = null;

    const focusables = () => [...(modal?.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? [])]
        .filter(el => !el.hasAttribute("disabled") && !el.closest("[hidden]"));

    const closeModal = () => {
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        lastFocus?.focus();
    };

    const openModal = () => {
        if (!modal) return;
        lastFocus = document.activeElement;
        modal.hidden = false;
        (modal.querySelector("[data-close-copy-csharp]") ?? modal.querySelector(".modal-card"))?.focus();
    };

    openCopy?.addEventListener("click", openModal);
    modal?.querySelectorAll("[data-close-copy-csharp]")?.forEach(button => button.addEventListener("click", closeModal));
    modal?.addEventListener("click", event => {
        if (event.target === modal) closeModal();
    });
    modal?.querySelector("[data-copy-csharp]")?.addEventListener("click", async () => {
        const text = document.getElementById("copy-csharp-source")?.textContent ?? "";
        try {
            await navigator.clipboard.writeText(text);
            if (status) status.textContent = "Copied C# to the clipboard.";
        } catch {
            if (status) status.textContent = "Copy failed. Select the sample and copy it manually.";
        }
    });
    document.addEventListener("keydown", event => {
        if (!modal || modal.hidden) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeModal();
            return;
        }
        if (event.key !== "Tab") return;
        const nodes = focusables();
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
});

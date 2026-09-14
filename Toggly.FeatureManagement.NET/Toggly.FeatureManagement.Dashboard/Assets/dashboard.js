document.addEventListener("DOMContentLoaded", () => {
    const promptUnload = (event) => { event.preventDefault(); };
    const summary = document.querySelector(".validation-summary-errors");
    if (summary) summary.focus();

    document.querySelectorAll("form[data-unsaved-warning]").forEach(form => {
        let dirty = false;
        form.addEventListener("input", () => { dirty = true; });
        form.addEventListener("change", () => { dirty = true; });
        form.addEventListener("submit", () => { dirty = false; });
        window.addEventListener("beforeunload", event => {
            if (dirty) promptUnload(event);
        });
    });

    const serialize = (form) => {
        const kept = [];
        for (const [key, value] of new FormData(form)) {
            if (typeof value !== "string") continue;
            if (key === "newRuleName" || key === "command" || key === "removeRuleIndex" || key === "__RequestVerificationToken" || key === "Key" || key === "ExpectedRevision" || key === "ContextKind") continue;
            kept.push(`${key}=${value}`);
        }
        return kept.join("&");
    };
    const leaveMessage = "You have unsaved condition changes. Leave this feature and discard them?";
    const allowUnload = (form) => { form.dataset.allowUnload = "true"; };

    document.querySelectorAll("[data-conditions-form]").forEach(form => {
        form._snapshot = form.innerHTML;
        form._baseline = serialize(form);
        form.addEventListener("submit", () => allowUnload(form));
    });

    const isDirty = (form) => form.dataset.allowUnload !== "true" && (form.dataset.serverDraft === "true" || serialize(form) !== form._baseline);

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
        delete form.dataset.allowUnload;
    };

    const discard = (form) => {
        if (form.dataset.serverDraft === "true" && form.dataset.listHref) {
            allowUnload(form);
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

    const enabledValue = (form) => persistToggle(form.closest(".feature-card"))?.checked === true;
    const setEnabled = (form, on) => {
        const toggle = persistToggle(form.closest(".feature-card"));
        if (toggle) toggle.checked = on;
        const field = form.querySelector('input[type="hidden"][name="Enabled"]');
        if (field) field.value = on ? "true" : "false";
        const copy = form.querySelector("[data-turn-off-copy]");
        const turnOff = form.querySelector("[data-turn-off]");
        copy?.classList.toggle("is-hidden", on);
        if (turnOff) turnOff.hidden = !on;
    };

    const applyDraftOn = (card, form, toggle) => {
        setEnabled(form, true);
        toggle.checked = true;
        expand(card);
    };

    const applyDraftOff = (card, form, toggle) => {
        setEnabled(form, false);
        toggle.checked = false;
        expand(card);
    };

    const leaveOpenForm = (form) => {
        const open = document.querySelector(".conditions-form.is-open");
        if (!open || open === form) return false;
        if (!isDirty(open)) {
            collapse(open);
            return false;
        }
        if (!window.confirm(leaveMessage)) return true;
        return discard(open);
    };

    const holdsEnabledToggle = (card, toggle, form) =>
        card.dataset.persistedEnabled === "true" && toggle.checked && enabledValue(form);

    window.addEventListener("beforeunload", event => {
        const open = document.querySelector(".conditions-form.is-open");
        if (open && isDirty(open)) promptUnload(event);
    });

    document.addEventListener("change", event => {
        const toggle = event.target.closest("[data-feature-toggle]");
        if (!toggle) return;
        const card = toggle.closest(".feature-card");
        const form = card?.querySelector("[data-conditions-form]");
        if (!card || !form) return;
        const intended = toggle.checked;
        if (leaveOpenForm(form)) {
            toggle.checked = card.dataset.persistedEnabled === "true";
            return;
        }
        if (card.dataset.persistedEnabled === "true" && !intended) {
            toggle.checked = true;
            applyDraftOn(card, form, toggle);
            return;
        }
        if (intended) applyDraftOn(card, form, toggle);
        else applyDraftOff(card, form, toggle);
    });

    const handleToggleHit = (event) => {
        const toggleHit = event.target.closest("label.toggle, [data-feature-toggle]");
        if (!toggleHit) return false;
        const card = toggleHit.closest(".feature-card");
        const toggle = card?.querySelector("[data-feature-toggle]");
        const form = card?.querySelector("[data-conditions-form]");
        if (!card || !toggle || !form || !holdsEnabledToggle(card, toggle, form)) return false;
        event.preventDefault();
        if (leaveOpenForm(form)) return true;
        applyDraftOn(card, form, toggle);
        return true;
    };

    const handleLeave = (event) => {
        const leave = event.target.closest(".tab, .rail-link, .feature-name, .conditions-link, a.button[href]");
        if (!leave) return false;
        const open = document.querySelector(".conditions-form.is-open");
        if (open && isDirty(open) && !window.confirm(leaveMessage)) event.preventDefault();
        else if (open) allowUnload(open);
        return true;
    };

    const handleClose = (event) => {
        const close = event.target.closest("[data-close-conditions]");
        if (!close) return false;
        const form = close.closest("[data-conditions-form]");
        if (form) discard(form);
        return true;
    };

    const handleTurnOff = (event) => {
        const turnOff = event.target.closest("[data-turn-off]");
        if (!turnOff) return false;
        event.preventDefault();
        if (turnOff instanceof HTMLButtonElement && turnOff.disabled) return true;
        const form = turnOff.closest("[data-conditions-form]");
        const card = form?.closest(".feature-card");
        if (form && card) applyDraftOff(card, form, persistToggle(card));
        return true;
    };

    const handleCardExpand = (event) => {
        const card = event.target.closest(".feature-card");
        if (!card || event.target.closest("a, button, input, select, textarea, label.toggle, .conditions-form")) return;
        const form = card.querySelector("[data-conditions-form]");
        if (!form || form.classList.contains("is-open")) return;
        if (card.dataset.persistedEnabled !== "true") return;
        confirmIfDirty(() => {
            persistToggle(card).checked = true;
            applyDraftOn(card, form, persistToggle(card));
        });
    };

    document.addEventListener("click", event => {
        if (handleToggleHit(event)) return;
        if (handleLeave(event)) return;
        if (handleClose(event)) return;
        if (handleTurnOff(event)) return;
        handleCardExpand(event);
    });

    document.querySelector("form.filters")?.addEventListener("submit", event => {
        const open = document.querySelector(".conditions-form.is-open");
        if (open && isDirty(open) && !window.confirm(leaveMessage)) event.preventDefault();
        else if (open) allowUnload(open);
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
        const last = nodes.at(-1);
        if (event.shiftKey && first.isSameNode(document.activeElement)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && last.isSameNode(document.activeElement)) {
            event.preventDefault();
            first.focus();
        }
    });
});

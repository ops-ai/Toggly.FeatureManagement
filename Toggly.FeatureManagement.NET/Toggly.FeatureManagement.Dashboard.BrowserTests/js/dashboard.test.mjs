import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const dashboardScript = new URL(
    "../../Toggly.FeatureManagement.Dashboard/Assets/dashboard.js",
    import.meta.url
);

const alwaysOnTemplateInner = `
  <fieldset class="rule-row" data-rule-name="AlwaysOn">
    <legend>Always On</legend>
    <input type="hidden" name="Rules[INDEX].Name" value="AlwaysOn" />
  </fieldset>`;

const fixture = `<!doctype html>
<html>
<body>
<div class="validation-summary-errors" tabindex="-1">Name is required.</div>
<form class="settings" data-unsaved-warning>
  <input name="Name" value="Checkout" />
  <button type="submit">Save settings</button>
</form>
<form class="filters" action="#filter" method="get">
  <input name="search" value="" />
  <button type="submit">Filter</button>
</form>
<article class="feature-card" data-feature-key="NewCheckout" data-persisted-enabled="false" data-persisted-rule-count="0">
  <div class="feature-card-header">
    <label class="toggle">
      <input type="checkbox" data-feature-toggle="NewCheckout" aria-label="Toggle New checkout" name="Enabled" value="true" form="conditions-NewCheckout" />
    </label>
    <a class="feature-name" href="#edit-NewCheckout">New checkout</a>
    <a class="conditions-link" href="#expand-NewCheckout">Conditions</a>
  </div>
  <form id="conditions-NewCheckout" method="post" class="conditions-form is-collapsed" data-conditions-form="NewCheckout" data-server-draft="false" data-list-href="/features">
    <input type="hidden" name="__RequestVerificationToken" value="token" />
    <input type="hidden" name="Key" value="NewCheckout" />
    <input type="hidden" name="ExpectedRevision" value="1" />
    <input type="hidden" name="ContextKind" value="" />
    <input type="hidden" name="Enabled" value="false" />
    <p class="turn-off-copy" data-turn-off-copy>This feature will be turned off.</p>
    <section data-user-group>
      <label for="new-user-filter-NewCheckout">Add user filter</label>
      <select id="new-user-filter-NewCheckout" name="newRuleName"><option value="Targeting">Targeting</option></select>
      <button type="submit" name="command" value="add-rule">Add user filter</button>
    </section>
    <button type="submit">Save</button>
    <button type="submit" name="command" value="turn-off" data-turn-off hidden>Turn feature off</button>
    <button type="button" data-close-conditions>Cancel</button>
  </form>
</article>
<article class="feature-card" data-feature-key="Search" data-persisted-enabled="true" data-persisted-rule-count="1">
  <div class="feature-card-header">
    <label class="toggle">
      <input type="checkbox" data-feature-toggle="Search" aria-label="Toggle Search" name="Enabled" value="true" form="conditions-Search" checked />
    </label>
    <a class="feature-name" href="#edit-Search">Search</a>
    <a class="tab" href="#contexts">Contexts</a>
    <a class="button" href="#export">Export</a>
  </div>
  <form id="conditions-Search" method="post" class="conditions-form is-collapsed" data-conditions-form="Search" data-server-draft="false" data-list-href="/features">
    <input type="hidden" name="Enabled" value="true" />
    <p class="turn-off-copy is-hidden" data-turn-off-copy>This feature will be turned off.</p>
    <section data-user-group>
      <fieldset class="rule-row" data-rule-name="AlwaysOn"><legend>Always On</legend></fieldset>
      <label for="new-user-filter-Search">Add user filter</label>
      <select id="new-user-filter-Search" name="newRuleName"><option value="AlwaysOn">Always On</option></select>
    </section>
    <button type="submit">Save</button>
    <button type="submit" name="command" value="turn-off" data-turn-off>Turn feature off</button>
    <button type="button" data-close-conditions>Cancel</button>
    <button type="submit" name="command" value="turn-off" data-turn-off disabled>Disabled off</button>
  </form>
</article>
<article class="feature-card" data-feature-key="Orphan" data-persisted-enabled="false" data-persisted-rule-count="0">
  <label class="toggle"><input type="checkbox" data-feature-toggle="Orphan" name="Enabled" value="true" form="conditions-Orphan" /></label>
  <form id="conditions-Orphan" method="post" class="conditions-form is-collapsed" data-conditions-form="Orphan" data-server-draft="true" data-list-href="#discard-orphan">
    <input type="hidden" name="Enabled" value="false" />
    <section data-user-group></section>
    <button type="button" data-close-conditions>Cancel</button>
  </form>
</article>
<template id="toggly-always-on-rule">${alwaysOnTemplateInner}</template>
<div id="copy-csharp-modal" class="modal" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" tabindex="-1">
    <pre><code id="copy-csharp-source">public enum FeatureFlags { NewCheckout }</code></pre>
    <p class="copy-status"></p>
    <button type="button" data-close-copy-csharp>Close</button>
    <button type="button" data-copy-csharp>Copy C#</button>
  </div>
</div>
<button type="button" data-open-copy-csharp>Copy C#</button>
</body>
</html>`;

const click = (window, target) => {
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
};

const change = (window, target) => {
    target.dispatchEvent(new window.Event("change", { bubbles: true }));
};

const keydown = (window, target, key, extra = {}) => {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
};

describe("dashboard.js", { concurrency: false }, () => {
    /** @type {Window} */
    let window;
    /** @type {Document} */
    let document;
    before(async () => {
        const virtualConsole = new VirtualConsole();
        virtualConsole.sendTo(console, { omitJSDOMErrors: true });
        const dom = new JSDOM(fixture, {
            url: "http://127.0.0.1/internal/features",
            pretendToBeVisual: true,
            runScripts: "outside-only",
            virtualConsole
        });
        window = dom.window;
        document = window.document;
        Object.defineProperty(window.navigator, "clipboard", {
            configurable: true,
            value: { writeText: async (text) => { window.__copied = text; } }
        });
        globalThis.window = window;
        globalThis.document = document;
        globalThis.HTMLButtonElement = window.HTMLButtonElement;
        globalThis.FormData = window.FormData;
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: window.navigator
        });
        globalThis.Event = window.Event;
        globalThis.MouseEvent = window.MouseEvent;
        globalThis.KeyboardEvent = window.KeyboardEvent;
        await import(dashboardScript.href);
        document.dispatchEvent(new window.Event("DOMContentLoaded"));
    });

    afterEach(() => {
        window.confirm = () => true;
        window.__copied = undefined;
        window.location.hash = "";
        const modal = document.getElementById("copy-csharp-modal");
        if (modal) modal.hidden = true;
        for (const form of document.querySelectorAll("[data-conditions-form]")) {
            if (form.dataset.conditionsForm !== "Orphan") {
                form.querySelector("[data-close-conditions]")?.dispatchEvent(
                    new window.MouseEvent("click", { bubbles: true, cancelable: true })
                );
            }
            form.classList.remove("is-open");
            form.classList.add("is-collapsed");
            form.closest(".feature-card")?.classList.remove("is-expanded");
            delete form.dataset.allowUnload;
            form.dataset.serverDraft = form.dataset.conditionsForm === "Orphan" ? "true" : "false";
        }
        document.querySelector('[data-feature-toggle="NewCheckout"]').checked = false;
        document.querySelector('[data-feature-toggle="Search"]').checked = true;
        document.querySelector('[data-feature-toggle="Orphan"]').checked = false;
        let template = document.getElementById("toggly-always-on-rule");
        if (!template) {
            template = document.createElement("template");
            template.id = "toggly-always-on-rule";
            document.body.append(template);
        }
        template.innerHTML = alwaysOnTemplateInner;
    });

    test("focuses the validation summary on load", () => {
        assert.equal(document.activeElement, document.querySelector(".validation-summary-errors"));
    });

    test("marks settings forms dirty and warns on unload", () => {
        const form = document.querySelector("form[data-unsaved-warning]");
        form.dispatchEvent(new window.Event("input", { bubbles: true }));
        const unload = new window.Event("beforeunload", { cancelable: true });
        window.dispatchEvent(unload);
        assert.equal(unload.defaultPrevented, true);
        form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
        const clean = new window.Event("beforeunload", { cancelable: true });
        window.dispatchEvent(clean);
        assert.equal(clean.defaultPrevented, false);
    });

    test("turns an empty persisted-off feature on without inserting Always On", () => {
        const card = document.querySelector('[data-feature-key="NewCheckout"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        toggle.checked = true;
        change(window, toggle);
        assert.equal(form.classList.contains("is-open"), true);
        assert.equal(form.querySelector('[data-rule-name="AlwaysOn"]'), null);
        assert.equal(toggle.checked, true);
        assert.equal(form.querySelector("[data-turn-off]").hidden, false);
        assert.equal(form.querySelector("[data-turn-off-copy]").classList.contains("is-hidden"), true);
    });

    test("does not insert Always On when the rule already exists", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        const before = form.querySelectorAll('[data-rule-name="AlwaysOn"]').length;
        toggle.checked = true;
        change(window, toggle);
        assert.equal(form.querySelectorAll('[data-rule-name="AlwaysOn"]').length, before);
    });

    test("keeps a persisted-on feature on and opens conditions when toggling off", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        toggle.checked = false;
        change(window, toggle);
        assert.equal(toggle.checked, true);
        assert.equal(form.classList.contains("is-open"), true);
        assert.equal(toggle.checked, true);
    });

    test("applies a draft-off for a persisted-off feature", () => {
        const card = document.querySelector('[data-feature-key="NewCheckout"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        toggle.checked = false;
        change(window, toggle);
        assert.equal(toggle.checked, false);
        assert.equal(form.classList.contains("is-open"), true);
        assert.equal(toggle.checked, false);
        assert.equal(form.querySelector("[data-turn-off]").hidden, true);
        assert.equal(form.querySelector("[data-turn-off-copy]").classList.contains("is-hidden"), false);
    });

    test("reopens persisted-on conditions when the switch is clicked while already on", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        click(window, card.querySelector("label.toggle"));
        assert.equal(form.classList.contains("is-open"), true);
        assert.equal(toggle.checked, true);
    });

    test("opens persisted-on conditions from an empty card click", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        click(window, card);
        assert.equal(form.classList.contains("is-open"), true);
        assert.equal(card.classList.contains("is-expanded"), true);
    });

    test("does not open conditions from a persisted-off card click", () => {
        const card = document.querySelector('[data-feature-key="NewCheckout"]');
        const form = card.querySelector("[data-conditions-form]");
        click(window, card);
        assert.equal(form.classList.contains("is-open"), false);
    });

    test("warns before leaving dirty conditions and can cancel", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        click(window, form.querySelector("[data-turn-off]"));
        window.confirm = () => false;
        const link = card.querySelector(".feature-name");
        const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
        link.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(form.classList.contains("is-open"), true);
    });

    test("allows navigation after confirming dirty conditions", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        click(window, form.querySelector("[data-turn-off]"));
        window.confirm = () => true;
        click(window, card.querySelector(".tab"));
        assert.equal(form.dataset.allowUnload, "true");
    });

    test("blocks filter submit when dirty conditions are declined", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        click(window, form.querySelector("[data-turn-off]"));
        window.confirm = () => false;
        const submit = new window.Event("submit", { bubbles: true, cancelable: true });
        document.querySelector("form.filters").dispatchEvent(submit);
        assert.equal(submit.defaultPrevented, true);
    });

    test("allows filter submit after confirming dirty conditions", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        window.confirm = () => true;
        const submit = new window.Event("submit", { bubbles: true, cancelable: true });
        document.querySelector("form.filters").dispatchEvent(submit);
        assert.equal(submit.defaultPrevented, false);
        assert.equal(form.dataset.allowUnload, "true");
    });

    test("restores and collapses when canceling a client draft", () => {
        const card = document.querySelector('[data-feature-key="NewCheckout"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        toggle.checked = true;
        change(window, toggle);
        click(window, form.querySelector("[data-close-conditions]"));
        assert.equal(form.classList.contains("is-collapsed"), true);
        assert.equal(toggle.checked, false);
        assert.equal(form.querySelector('[data-rule-name="AlwaysOn"]'), null);
    });

    test("navigates away when canceling a server draft", () => {
        const card = document.querySelector('[data-feature-key="Orphan"]');
        const form = card.querySelector("[data-conditions-form]");
        click(window, form.querySelector("[data-close-conditions]"));
        assert.equal(window.location.hash, "#discard-orphan");
    });

    test("reverts a conflicting toggle when leaving dirty conditions is declined", () => {
        const search = document.querySelector('[data-feature-key="Search"]');
        const searchToggle = search.querySelector("[data-feature-toggle]");
        const searchForm = search.querySelector("[data-conditions-form]");
        searchToggle.checked = true;
        change(window, searchToggle);
        searchForm.querySelector('input[type="hidden"][name="Enabled"]').value = "false";
        searchToggle.checked = false;
        window.confirm = () => false;
        const checkoutToggle = document.querySelector('[data-feature-toggle="NewCheckout"]');
        checkoutToggle.checked = true;
        change(window, checkoutToggle);
        assert.equal(checkoutToggle.checked, false);
        assert.equal(searchForm.classList.contains("is-open"), true);
    });

    test("discards a server draft when switching to another feature", () => {
        const orphan = document.querySelector('[data-feature-key="Orphan"]');
        const orphanToggle = orphan.querySelector("[data-feature-toggle]");
        orphanToggle.checked = true;
        change(window, orphanToggle);
        window.confirm = () => true;
        const searchToggle = document.querySelector('[data-feature-toggle="Search"]');
        searchToggle.checked = true;
        change(window, searchToggle);
        assert.equal(window.location.hash, "#discard-orphan");
        assert.equal(searchToggle.checked, true);
    });

    test("collapses a clean open form when opening another feature", () => {
        const search = document.querySelector('[data-feature-key="Search"]');
        const searchToggle = search.querySelector("[data-feature-toggle]");
        const searchForm = search.querySelector("[data-conditions-form]");
        searchToggle.checked = true;
        change(window, searchToggle);
        const checkoutToggle = document.querySelector('[data-feature-toggle="NewCheckout"]');
        checkoutToggle.checked = true;
        change(window, checkoutToggle);
        assert.equal(searchForm.classList.contains("is-collapsed"), true);
        assert.equal(document.querySelector('[data-conditions-form="NewCheckout"]').classList.contains("is-open"), true);
    });

    test("turns a feature off from the conditions action", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        click(window, form.querySelector("[data-turn-off]"));
        assert.equal(toggle.checked, false);
        assert.equal(toggle.checked, false);
    });

    test("ignores a disabled turn-off control", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        const disabled = [...form.querySelectorAll("[data-turn-off]")].find(button => button.disabled);
        click(window, disabled);
        assert.equal(toggle.checked, true);
        assert.equal(toggle.checked, true);
    });

    test("does not insert Always On when the user-group label is missing", () => {
        const card = document.querySelector('[data-feature-key="Orphan"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        toggle.checked = true;
        change(window, toggle);
        assert.equal(form.querySelector('[data-rule-name="AlwaysOn"]'), null);
    });

    test("skips Always On when the template is missing", () => {
        const template = document.getElementById("toggly-always-on-rule");
        template.remove();
        const card = document.querySelector('[data-feature-key="NewCheckout"]');
        const toggle = card.querySelector("[data-feature-toggle]");
        const form = card.querySelector("[data-conditions-form]");
        form.querySelector("[data-rule-name='AlwaysOn']")?.remove();
        toggle.checked = true;
        change(window, toggle);
        assert.equal(form.querySelector('[data-rule-name="AlwaysOn"]'), null);
    });

    test("warns on unload when open conditions are dirty", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        click(window, form.querySelector("[data-turn-off]"));
        const unload = new window.Event("beforeunload", { cancelable: true });
        window.dispatchEvent(unload);
        assert.equal(unload.defaultPrevented, true);
    });

    test("allows conditions submit without an unload warning", () => {
        const card = document.querySelector('[data-feature-key="Search"]');
        const form = card.querySelector("[data-conditions-form]");
        const toggle = card.querySelector("[data-feature-toggle]");
        toggle.checked = true;
        change(window, toggle);
        form.dispatchEvent(new window.Event("submit", { bubbles: true }));
        assert.equal(form.dataset.allowUnload, "true");
        const unload = new window.Event("beforeunload", { cancelable: true });
        window.dispatchEvent(unload);
        assert.equal(unload.defaultPrevented, false);
    });

    test("card click declines dirty conditions without opening another feature", () => {
        const orphanToggle = document.querySelector('[data-feature-toggle="Orphan"]');
        orphanToggle.checked = true;
        change(window, orphanToggle);
        window.confirm = () => false;
        const search = document.querySelector('[data-feature-key="Search"]');
        click(window, search);
        assert.equal(search.querySelector("[data-conditions-form]").classList.contains("is-open"), false);
        assert.equal(document.querySelector('[data-conditions-form="Orphan"]').classList.contains("is-open"), true);
    });

    test("card click discards a dirty server draft before opening another feature", () => {
        const orphanToggle = document.querySelector('[data-feature-toggle="Orphan"]');
        orphanToggle.checked = true;
        change(window, orphanToggle);
        window.confirm = () => true;
        click(window, document.querySelector('[data-feature-key="Search"]'));
        assert.equal(window.location.hash, "#discard-orphan");
    });

    test("persisted-on switch click declines dirty conditions on another feature", () => {
        const orphanToggle = document.querySelector('[data-feature-toggle="Orphan"]');
        orphanToggle.checked = true;
        change(window, orphanToggle);
        window.confirm = () => false;
        const search = document.querySelector('[data-feature-key="Search"]');
        click(window, search.querySelector("label.toggle"));
        assert.equal(document.querySelector('[data-conditions-form="Orphan"]').classList.contains("is-open"), true);
    });

    test("persisted-on switch click discards a dirty server draft on another feature", () => {
        const orphanToggle = document.querySelector('[data-feature-toggle="Orphan"]');
        orphanToggle.checked = true;
        change(window, orphanToggle);
        window.confirm = () => true;
        click(window, document.querySelector('[data-feature-key="Search"] label.toggle'));
        assert.equal(window.location.hash, "#discard-orphan");
    });

    test("opens, copies, and closes the Copy C# modal", async () => {
        const modal = document.getElementById("copy-csharp-modal");
        const opener = document.querySelector("[data-open-copy-csharp]");
        opener.focus();
        click(window, opener);
        assert.equal(modal.hidden, false);
        await document.querySelector("[data-copy-csharp]").click();
        await Promise.resolve();
        assert.equal(window.__copied, "public enum FeatureFlags { NewCheckout }");
        assert.equal(modal.querySelector(".copy-status").textContent, "Copied C# to the clipboard.");
        click(window, modal);
        assert.equal(modal.hidden, true);
    });

    test("reports a Copy C# failure and traps focus", async () => {
        Object.defineProperty(window.navigator, "clipboard", {
            configurable: true,
            value: { writeText: async () => { throw new Error("denied"); } }
        });
        const modal = document.getElementById("copy-csharp-modal");
        click(window, document.querySelector("[data-open-copy-csharp]"));
        await document.querySelector("[data-copy-csharp]").click();
        await Promise.resolve();
        assert.match(modal.querySelector(".copy-status").textContent, /Copy failed/);
        const close = modal.querySelector("[data-close-copy-csharp]");
        const copy = modal.querySelector("[data-copy-csharp]");
        copy.focus();
        keydown(window, document, "Tab");
        assert.equal(document.activeElement, close);
        close.focus();
        keydown(window, document, "Tab", { shiftKey: true });
        assert.equal(document.activeElement, copy);
        keydown(window, document, "Escape");
        assert.equal(modal.hidden, true);
        Object.defineProperty(window.navigator, "clipboard", {
            configurable: true,
            value: { writeText: async (text) => { window.__copied = text; } }
        });
    });

    test("ignores unrelated keys while the modal is open", () => {
        const modal = document.getElementById("copy-csharp-modal");
        click(window, document.querySelector("[data-open-copy-csharp]"));
        keydown(window, document, "ArrowDown");
        assert.equal(modal.hidden, false);
        click(window, modal.querySelector("[data-close-copy-csharp]"));
        assert.equal(modal.hidden, true);
    });
});

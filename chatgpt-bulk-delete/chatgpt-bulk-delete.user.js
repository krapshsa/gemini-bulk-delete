// ==UserScript==
// @name         ChatGPT Bulk Delete Conversations
// @namespace    https://chatgpt.com/
// @version      2.1.1
// @description  Select and bulk delete ChatGPT conversations from the sidebar.
// @author       vcc
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @noframes
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // =========================================================================
    // Utilities
    // =========================================================================
    function css(strings, ...values) {
        const rules = strings.reduce(
            (result, part, index) => result + part + (values[index] ?? ''),
            ''
        );
        GM_addStyle(rules);
    }

    function isolateCheckboxEvents(checkbox) {
        for (const eventName of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
            checkbox.addEventListener(eventName, event => event.stopPropagation());
        }
        checkbox.addEventListener('dblclick', event => {
            event.preventDefault();
            event.stopPropagation();
        });
    }

    // =========================================================================
    // Styles
    // =========================================================================
    const CHECKBOX_CLASS = 'chatgpt-bulk-checkbox';
    const ITEM_CHECKBOX_CLASS = 'chatgpt-bulk-item-checkbox';
    const SELECT_ALL_CLASS = 'chatgpt-bulk-select-all';
    const SELECTED_CLASS = 'chatgpt-bulk-selected';
    const TOOLBAR_CLASS = 'chatgpt-bulk-toolbar';
    const PROCESSED_ATTRIBUTE = 'data-chatgpt-bulk-processed';

    css`
        :root {
            --chatgpt-bulk-border: rgba(127, 127, 127, 0.55);
            --chatgpt-bulk-accent: #10a37f;
            --chatgpt-bulk-accent-hover: #0d8f70;
            --chatgpt-bulk-danger: #e5484d;
            --chatgpt-bulk-selected-bg: rgba(16, 163, 127, 0.12);
            --chatgpt-bulk-checkmark: #fff;
        }

        .${CHECKBOX_CLASS} {
            appearance: none;
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            margin: 0 8px 0 2px;
            border: 2px solid var(--chatgpt-bulk-border);
            border-radius: 5px;
            background: transparent;
            cursor: pointer;
            flex: 0 0 auto;
            position: relative;
            transition: border-color .2s ease, background-color .2s ease;
            z-index: 2;
        }

        .${CHECKBOX_CLASS}:hover {
            border-color: var(--chatgpt-bulk-accent-hover);
        }

        .${CHECKBOX_CLASS}:checked {
            border-color: var(--chatgpt-bulk-accent);
            background: var(--chatgpt-bulk-accent);
        }

        .${CHECKBOX_CLASS}:checked::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 46%;
            width: 4px;
            height: 8px;
            border: solid var(--chatgpt-bulk-checkmark);
            border-width: 0 2px 2px 0;
            transform: translate(-50%, -50%) rotate(45deg);
        }

        .${SELECTED_CLASS} {
            background: var(--chatgpt-bulk-selected-bg) !important;
        }

        .${TOOLBAR_CLASS} {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 6px;
            opacity: 0;
            visibility: hidden;
            transition: opacity .2s ease, visibility .2s ease;
        }

        .${TOOLBAR_CLASS}.visible {
            opacity: 1;
            visibility: visible;
        }

        .${TOOLBAR_CLASS} span {
            font-size: 12px;
            white-space: nowrap;
        }

        .${TOOLBAR_CLASS} button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            padding: 5px;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: var(--chatgpt-bulk-danger);
            cursor: pointer;
        }

        .${TOOLBAR_CLASS} button:hover:not(:disabled) {
            background: rgba(229, 72, 77, .12);
        }

        .${TOOLBAR_CLASS} button:disabled {
            opacity: .45;
            cursor: not-allowed;
        }

        .${TOOLBAR_CLASS} svg {
            width: 19px;
            height: 19px;
            fill: currentColor;
        }

        .${SELECT_ALL_CLASS} {
            width: 17px;
            height: 17px;
            margin-left: 8px;
        }
    `;

    // =========================================================================
    // Core Logic
    // =========================================================================
    class ChatGPTBulkDelete {
        constructor() {
            this.selected = new Set();
            this.deleting = false;
            this.refreshQueued = false;
            this.toolbarEl = null;
            this.countEl = null;
            this.deleteButton = null;
            this.selectAllCheckbox = null;
        }

        init() {
            this.observer = new MutationObserver(() => this.queueRefresh());
            this.observer.observe(document.body, { childList: true, subtree: true });
            this.refresh();
        }

        conversationLinks() {
            return [...document.querySelectorAll('nav[aria-label="Chat history"] a[href^="/c/"]')];
        }

        conversationId(link) {
            return link.getAttribute('href')?.match(/^\/c\/([^/?#]+)/)?.[1] ?? null;
        }

        queueRefresh() {
            if (this.refreshQueued) return;
            this.refreshQueued = true;
            requestAnimationFrame(() => {
                this.refreshQueued = false;
                this.refresh();
            });
        }

        refresh() {
            this.removeMissingSelections();
            this.injectCheckboxes();
            this.injectToolbar();
            this.updateToolbar();
        }

        removeMissingSelections() {
            const availableIds = new Set(this.conversationLinks().map(link => this.conversationId(link)));
            for (const id of this.selected) {
                if (!availableIds.has(id)) this.selected.delete(id);
            }
        }

        injectCheckboxes() {
            for (const link of this.conversationLinks()) {
                const id = this.conversationId(link);
                if (!id) continue;

                const existingCheckbox = link.querySelector(`.${ITEM_CHECKBOX_CLASS}`);
                if (existingCheckbox) {
                    existingCheckbox.checked = this.selected.has(id);
                    link.toggleAttribute(PROCESSED_ATTRIBUTE, true);
                    link.classList.toggle(SELECTED_CLASS, existingCheckbox.checked);
                    continue;
                }

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = `${CHECKBOX_CLASS} ${ITEM_CHECKBOX_CLASS}`;
                checkbox.checked = this.selected.has(id);
                checkbox.title = 'Select conversation';
                checkbox.setAttribute('aria-label', `Select ${link.textContent.trim() || 'conversation'}`);
                isolateCheckboxEvents(checkbox);
                checkbox.addEventListener('change', event => this.handleItemChange(event, id));

                link.prepend(checkbox);
                link.toggleAttribute(PROCESSED_ATTRIBUTE, true);
                link.classList.toggle(SELECTED_CLASS, checkbox.checked);
            }
        }

        findRecentsButton() {
            const buttons = document.querySelectorAll('nav[aria-label="Chat history"] button');
            return [...buttons].find(button => /^(Recents|最近|近期|最近使用)$/.test(button.textContent.trim()));
        }

        injectToolbar() {
            if (this.toolbarEl?.isConnected) return;

            const recentsButton = this.findRecentsButton();
            if (!recentsButton) return;

            const selectAll = document.createElement('input');
            selectAll.type = 'checkbox';
            selectAll.className = `${CHECKBOX_CLASS} ${SELECT_ALL_CLASS}`;
            selectAll.title = 'Select all visible conversations';
            selectAll.setAttribute('aria-label', 'Select all visible conversations');
            isolateCheckboxEvents(selectAll);
            selectAll.addEventListener('change', event => this.handleSelectAll(event));

            const toolbar = document.createElement('span');
            toolbar.className = TOOLBAR_CLASS;
            const count = document.createElement('span');
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.title = 'Delete selected conversations';
            deleteButton.setAttribute('aria-label', 'Delete selected conversations');
            const svgNamespace = 'http://www.w3.org/2000/svg';
            const icon = document.createElementNS(svgNamespace, 'svg');
            const path = document.createElementNS(svgNamespace, 'path');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('aria-hidden', 'true');
            path.setAttribute('d', 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z');
            icon.appendChild(path);
            deleteButton.appendChild(icon);
            deleteButton.addEventListener('click', event => {
                event.stopPropagation();
                void this.deleteSelectedItems();
            });

            toolbar.append(count, deleteButton);
            recentsButton.insertAdjacentElement('afterend', selectAll);
            selectAll.insertAdjacentElement('afterend', toolbar);

            this.selectAllCheckbox = selectAll;
            this.toolbarEl = toolbar;
            this.countEl = count;
            this.deleteButton = deleteButton;
        }

        handleItemChange(event, id) {
            const checkbox = event.currentTarget;
            checkbox.checked ? this.selected.add(id) : this.selected.delete(id);
            checkbox.closest('a')?.classList.toggle(SELECTED_CLASS, checkbox.checked);
            this.updateToolbar();
        }

        handleSelectAll(event) {
            const checked = event.currentTarget.checked;
            for (const checkbox of document.querySelectorAll(`.${ITEM_CHECKBOX_CLASS}`)) {
                const link = checkbox.closest('a');
                const id = link && this.conversationId(link);
                if (!id) continue;
                checkbox.checked = checked;
                checked ? this.selected.add(id) : this.selected.delete(id);
                link.classList.toggle(SELECTED_CLASS, checked);
            }
            this.updateToolbar();
        }

        updateToolbar() {
            if (!this.toolbarEl?.isConnected) return;
            const count = this.selected.size;
            this.toolbarEl.classList.toggle('visible', count > 0 || this.deleting);
            this.countEl.textContent = this.deleting ? `Deleting… (${count})` : `${count} selected`;
            this.deleteButton.disabled = this.deleting || count === 0;

            const itemCheckboxes = [...document.querySelectorAll(`.${ITEM_CHECKBOX_CLASS}`)];
            const checkedCount = itemCheckboxes.filter(checkbox => checkbox.checked).length;
            this.selectAllCheckbox.checked = itemCheckboxes.length > 0 && checkedCount === itemCheckboxes.length;
            this.selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < itemCheckboxes.length;
            this.selectAllCheckbox.disabled = this.deleting || itemCheckboxes.length === 0;
        }

        isVisible(element) {
            if (!element) return false;
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        }

        async waitFor(predicate, timeout = 5000, description = 'ChatGPT UI') {
            const check = () => {
                try { return predicate() || null; } catch { return null; }
            };
            const initial = check();
            if (initial) return initial;

            return new Promise((resolve, reject) => {
                const observer = new MutationObserver(() => {
                    const result = check();
                    if (!result) return;
                    clearTimeout(timer);
                    observer.disconnect();
                    resolve(result);
                });
                const timer = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timed out waiting for ${description}`));
                }, timeout);
                observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            });
        }

        delay(milliseconds) {
            return new Promise(resolve => setTimeout(resolve, milliseconds));
        }

        visibleMatchingElements(selector, pattern) {
            return [...document.querySelectorAll(selector)]
                .filter(element => this.isVisible(element) && pattern.test(element.textContent.trim()));
        }

        optionButtonFor(link) {
            const selector = 'button[aria-label^="Open conversation options for"], button[data-testid*="conversation-options"]';
            return link.parentElement?.querySelector(selector) || link.querySelector(selector);
        }

        async deleteConversation(id) {
            const link = this.conversationLinks().find(item => this.conversationId(item) === id);
            if (!link) throw new Error(`Conversation not found: ${id}`);

            link.scrollIntoView({ block: 'nearest' });
            link.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            link.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

            const optionsButton = await this.waitFor(
                () => this.optionButtonFor(link), 2000, 'conversation options button'
            );
            optionsButton.click();

            const deletePattern = /^(Delete|刪除|删除)$/i;
            const menuDelete = await this.waitFor(
                () => this.visibleMatchingElements('[role="menuitem"], [role="menu"] button', deletePattern)[0],
                3000,
                'delete menu item'
            );
            menuDelete.click();

            const confirmDelete = await this.waitFor(() => {
                const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(dialog => this.isVisible(dialog));
                return dialogs.flatMap(dialog => [...dialog.querySelectorAll('button')])
                    .find(button => this.isVisible(button) && deletePattern.test(button.textContent.trim()));
            }, 3000, 'delete confirmation');
            confirmDelete.click();

            // The backend/sidebar update can take several seconds. Do not wait for
            // the conversation row to disappear; only allow the modal to close so
            // the next conversation's menu can be operated safely.
            try {
                await this.waitFor(
                    () => !confirmDelete.isConnected || !this.isVisible(confirmDelete),
                    1500,
                    'confirmation dialog to close'
                );
            } catch {
                // The delete request has already been submitted. A short hand-off
                // delay is enough even if ChatGPT keeps the old node temporarily.
                await this.delay(100);
            }
            this.selected.delete(id);
            this.updateToolbar();
        }

        async deleteSelectedItems() {
            if (this.deleting || this.selected.size === 0) return;

            const ids = [...this.selected];
            const failures = [];
            this.deleting = true;
            this.updateToolbar();

            for (const id of ids) {
                try {
                    await this.deleteConversation(id);
                } catch (error) {
                    failures.push(id);
                    console.error('[ChatGPT Bulk Delete]', id, error);
                }
            }

            this.deleting = false;
            this.refresh();
            if (failures.length > 0) {
                alert(`Finished, but ${failures.length} conversation(s) could not be deleted. See the console for details.`);
            }
        }
    }

    const app = new ChatGPTBulkDelete();
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => app.init(), { once: true });
    } else {
        app.init();
    }
})();

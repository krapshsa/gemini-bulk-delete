// ==UserScript==
// @name         ChatGPT Bulk Delete Conversations
// @namespace    https://chatgpt.com/
// @version      2.3.0
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
            checkbox.addEventListener(eventName, event => {
                event.stopPropagation();
            });
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
    const STOP_BUTTON_CLASS = 'chatgpt-bulk-stop';
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

        .${TOOLBAR_CLASS} button[hidden] {
            display: none;
        }

        .${TOOLBAR_CLASS} .${STOP_BUTTON_CLASS} {
            color: currentColor;
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
    // Configuration
    // =========================================================================
    const SELECTORS = {
        historyNav: 'nav[aria-label="Chat history"]',
        conversationLink: 'nav[aria-label="Chat history"] a[href^="/c/"]',
        optionsButton: [
            'button[aria-label^="Open conversation options for"]',
            'button[data-testid*="conversation-options"]',
        ].join(', '),
        deleteAction: [
            '[role="menuitem"][data-testid*="delete"]',
            '[role="menu"] button[data-testid*="delete"]',
        ].join(', '),
        menuAction: '[role="menuitem"], [role="menu"] button',
        dialog: '[role="dialog"]',
        confirmButton: 'button[data-testid="confirm-button"]',
    };

    const TEXT = {
        recents: /^(Recents|最近|近期|最近使用)$/,
        delete: /^(Delete|刪除|删除)$/i,
    };

    // =========================================================================
    // State
    // =========================================================================
    class SelectionStore {
        constructor() {
            this.selected = new Set();
            this.listeners = new Set();
            this.deleting = false;
            this.stopRequested = false;
            this.completedCount = 0;
            this.totalCount = 0;
        }

        subscribe(listener) {
            this.listeners.add(listener);
            return () => {
                this.listeners.delete(listener);
            };
        }

        notify() {
            for (const listener of this.listeners) {
                listener(this);
            }
        }

        setSelected(id, selected) {
            if (selected) {
                this.selected.add(id);
            } else {
                this.selected.delete(id);
            }
            this.notify();
        }

        setMany(ids, selected) {
            for (const id of ids) {
                if (selected) {
                    this.selected.add(id);
                } else {
                    this.selected.delete(id);
                }
            }
            this.notify();
        }

        remove(id) {
            if (this.selected.delete(id)) {
                this.notify();
            }
        }

        beginDeletion(totalCount) {
            this.deleting = true;
            this.stopRequested = false;
            this.completedCount = 0;
            this.totalCount = totalCount;
            this.notify();
        }

        markItemCompleted() {
            this.completedCount += 1;
            this.notify();
        }

        requestStop() {
            if (!this.deleting) {
                return;
            }
            this.stopRequested = true;
            this.notify();
        }

        finishDeletion() {
            this.deleting = false;
            this.notify();
        }
    }

    // =========================================================================
    // ChatGPT DOM adapter
    // =========================================================================
    class ChatGPTAdapter {
        conversationLinks() {
            return [...document.querySelectorAll(SELECTORS.conversationLink)];
        }

        conversationId(link) {
            return link.getAttribute('href')?.match(/^\/c\/([^/?#]+)/)?.[1] ?? null;
        }

        findConversation(id) {
            return this.conversationLinks().find(link => {
                return this.conversationId(link) === id;
            }) ?? null;
        }

        findToolbarAnchor() {
            const nav = document.querySelector(SELECTORS.historyNav);
            if (!nav) {
                return null;
            }

            const buttons = [...nav.querySelectorAll('button')];
            const localizedAnchor = buttons.find(button => {
                return TEXT.recents.test(button.textContent.trim());
            });
            if (localizedAnchor) {
                return localizedAnchor;
            }

            const firstConversation = nav.querySelector('a[href^="/c/"]');
            if (!firstConversation) {
                return null;
            }
            return buttons.filter(button => {
                return Boolean(
                    button.compareDocumentPosition(firstConversation)
                    & Node.DOCUMENT_POSITION_FOLLOWING
                );
            }).at(-1) ?? null;
        }

        optionButtonFor(link) {
            return link.parentElement?.querySelector(SELECTORS.optionsButton)
                ?? link.querySelector(SELECTORS.optionsButton);
        }

        visibleMatchingElements(selector, pattern) {
            return [...document.querySelectorAll(selector)].filter(element => {
                return this.isVisible(element) && pattern.test(element.textContent.trim());
            });
        }

        firstVisible(selector) {
            return [...document.querySelectorAll(selector)].find(element => {
                return this.isVisible(element);
            }) ?? null;
        }

        visibleDialogs() {
            return [...document.querySelectorAll(SELECTORS.dialog)].filter(dialog => {
                return this.isVisible(dialog);
            });
        }

        isVisible(element) {
            if (!element) {
                return false;
            }
            const style = getComputedStyle(element);
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && element.getClientRects().length > 0;
        }

        async waitFor(predicate, timeout = 5000, description = 'ChatGPT UI') {
            const check = () => {
                try {
                    return predicate() || null;
                } catch {
                    return null;
                }
            };
            const initial = check();
            if (initial) {
                return initial;
            }

            return new Promise((resolve, reject) => {
                const observer = new MutationObserver(() => {
                    const result = check();
                    if (!result) {
                        return;
                    }
                    clearTimeout(timer);
                    observer.disconnect();
                    resolve(result);
                });
                const timer = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timed out waiting for ${description}`));
                }, timeout);
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                });
            });
        }

        delay(milliseconds) {
            return new Promise(resolve => {
                setTimeout(resolve, milliseconds);
            });
        }
    }

    // =========================================================================
    // View
    // =========================================================================
    class BulkDeleteView {
        constructor(adapter, store, handlers) {
            this.adapter = adapter;
            this.store = store;
            this.handlers = handlers;
            this.refreshQueued = false;
            this.toolbarEl = null;
            this.countEl = null;
            this.deleteButton = null;
            this.stopButton = null;
            this.selectAllCheckbox = null;
        }

        queueRefresh() {
            if (this.refreshQueued) {
                return;
            }
            this.refreshQueued = true;
            requestAnimationFrame(() => {
                this.refreshQueued = false;
                this.reconcile();
            });
        }

        reconcile() {
            this.reconcileCheckboxes();
            this.ensureToolbar();
            this.render();
        }

        reconcileCheckboxes() {
            for (const link of this.adapter.conversationLinks()) {
                const id = this.adapter.conversationId(link);
                if (!id) {
                    continue;
                }

                const existingCheckbox = link.querySelector(`.${ITEM_CHECKBOX_CLASS}`);
                const boundId = link.getAttribute(PROCESSED_ATTRIBUTE);
                if (existingCheckbox && boundId === id) {
                    continue;
                }
                if (existingCheckbox) {
                    existingCheckbox.remove();
                }

                const checkbox = this.createItemCheckbox();
                link.prepend(checkbox);
                link.setAttribute(PROCESSED_ATTRIBUTE, id);
            }
        }

        createItemCheckbox() {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = `${CHECKBOX_CLASS} ${ITEM_CHECKBOX_CLASS}`;
            checkbox.title = 'Select conversation';
            checkbox.setAttribute('aria-label', 'Select conversation');
            isolateCheckboxEvents(checkbox);
            checkbox.addEventListener('change', event => {
                this.handlers.onItemChange(event.currentTarget);
            });
            return checkbox;
        }

        ensureToolbar() {
            if (this.toolbarEl?.isConnected) {
                return;
            }

            const anchor = this.adapter.findToolbarAnchor();
            if (!anchor) {
                this.clearToolbarReferences();
                return;
            }

            const selectAll = document.createElement('input');
            selectAll.type = 'checkbox';
            selectAll.className = `${CHECKBOX_CLASS} ${SELECT_ALL_CLASS}`;
            selectAll.title = 'Select all visible conversations';
            selectAll.setAttribute('aria-label', 'Select all visible conversations');
            isolateCheckboxEvents(selectAll);
            selectAll.addEventListener('change', event => {
                this.handlers.onSelectAll(event.currentTarget.checked);
            });

            const toolbar = document.createElement('span');
            toolbar.className = TOOLBAR_CLASS;
            const count = document.createElement('span');
            const deleteButton = this.createDeleteButton();
            const stopButton = this.createStopButton();
            toolbar.append(count, deleteButton, stopButton);
            anchor.insertAdjacentElement('afterend', selectAll);
            selectAll.insertAdjacentElement('afterend', toolbar);

            this.selectAllCheckbox = selectAll;
            this.toolbarEl = toolbar;
            this.countEl = count;
            this.deleteButton = deleteButton;
            this.stopButton = stopButton;
        }

        createDeleteButton() {
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
                void this.handlers.onDelete();
            });
            return deleteButton;
        }

        createStopButton() {
            const stopButton = document.createElement('button');
            stopButton.type = 'button';
            stopButton.className = STOP_BUTTON_CLASS;
            stopButton.title = 'Stop after the current conversation';
            stopButton.setAttribute('aria-label', 'Stop deletion');
            stopButton.hidden = true;

            const svgNamespace = 'http://www.w3.org/2000/svg';
            const icon = document.createElementNS(svgNamespace, 'svg');
            const rect = document.createElementNS(svgNamespace, 'rect');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('aria-hidden', 'true');
            rect.setAttribute('x', '6');
            rect.setAttribute('y', '6');
            rect.setAttribute('width', '12');
            rect.setAttribute('height', '12');
            rect.setAttribute('rx', '1');
            icon.appendChild(rect);
            stopButton.appendChild(icon);
            stopButton.addEventListener('click', event => {
                event.stopPropagation();
                this.handlers.onStop();
            });
            return stopButton;
        }

        clearToolbarReferences() {
            this.selectAllCheckbox = null;
            this.toolbarEl = null;
            this.countEl = null;
            this.deleteButton = null;
            this.stopButton = null;
        }

        visibleConversationIds() {
            return this.adapter.conversationLinks().map(link => {
                return this.adapter.conversationId(link);
            }).filter(id => {
                return Boolean(id);
            });
        }

        render() {
            for (const link of this.adapter.conversationLinks()) {
                const id = this.adapter.conversationId(link);
                const checkbox = link.querySelector(`.${ITEM_CHECKBOX_CLASS}`);
                if (!id || !checkbox) {
                    continue;
                }
                const selected = this.store.selected.has(id);
                checkbox.checked = selected;
                checkbox.disabled = this.store.deleting;
                link.classList.toggle(SELECTED_CLASS, selected);
                checkbox.setAttribute(
                    'aria-label',
                    `Select ${link.textContent.trim() || 'conversation'}`
                );
            }

            if (!this.toolbarEl?.isConnected) {
                return;
            }

            const count = this.store.selected.size;
            this.toolbarEl.classList.toggle('visible', count > 0 || this.store.deleting);
            this.countEl.textContent = this.store.deleting
                ? `${this.store.stopRequested ? 'Stopping' : 'Deleting'}… `
                    + `${this.store.completedCount}/${this.store.totalCount}`
                : `${count} selected`;
            this.deleteButton.disabled = this.store.deleting || count === 0;
            this.deleteButton.hidden = this.store.deleting;
            this.stopButton.hidden = !this.store.deleting;
            this.stopButton.disabled = this.store.stopRequested;

            const visibleIds = this.visibleConversationIds();
            const selectedVisibleCount = visibleIds.filter(id => {
                return this.store.selected.has(id);
            }).length;
            this.selectAllCheckbox.checked = visibleIds.length > 0
                && selectedVisibleCount === visibleIds.length;
            this.selectAllCheckbox.indeterminate = selectedVisibleCount > 0
                && selectedVisibleCount < visibleIds.length;
            this.selectAllCheckbox.disabled = this.store.deleting || visibleIds.length === 0;
        }
    }

    // =========================================================================
    // Delete queue
    // =========================================================================
    class DeleteQueue {
        constructor(adapter, store) {
            this.adapter = adapter;
            this.store = store;
        }

        async run(ids) {
            const failures = [];
            this.store.beginDeletion(ids.length);
            try {
                for (const id of ids) {
                    if (this.store.stopRequested) {
                        break;
                    }
                    try {
                        await this.deleteConversation(id);
                        this.store.remove(id);
                    } catch (error) {
                        failures.push(id);
                        console.error('[ChatGPT Bulk Delete]', id, error);
                    } finally {
                        this.store.markItemCompleted();
                    }
                }
            } finally {
                this.store.finishDeletion();
            }
            return {
                failures,
                stopped: this.store.completedCount < ids.length,
            };
        }

        async deleteConversation(id) {
            const link = this.adapter.findConversation(id);
            if (!link) {
                throw new Error(`Conversation not found: ${id}`);
            }

            await this.openConversationMenu(link);
            await this.chooseDeleteAction();
            const confirmButton = await this.confirmDeletion();
            await this.waitForConfirmationToClose(confirmButton);
            await this.waitForConversationUpdate(id);
        }

        async openConversationMenu(link) {
            link.scrollIntoView({ block: 'nearest' });
            link.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            link.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

            const optionsButton = await this.adapter.waitFor(
                () => {
                    return this.adapter.optionButtonFor(link);
                },
                2000,
                'conversation options button'
            );
            optionsButton.click();
        }

        async chooseDeleteAction() {
            const menuDelete = await this.adapter.waitFor(
                () => {
                    return this.adapter.firstVisible(SELECTORS.deleteAction)
                        ?? this.adapter.visibleMatchingElements(
                            SELECTORS.menuAction,
                            TEXT.delete
                        )[0];
                },
                3000,
                'delete menu item'
            );
            menuDelete.click();
        }

        async confirmDeletion() {
            const confirmDelete = await this.adapter.waitFor(
                () => {
                    for (const dialog of this.adapter.visibleDialogs()) {
                        const semanticConfirm = dialog.querySelector(SELECTORS.confirmButton);
                        if (this.adapter.isVisible(semanticConfirm)) {
                            return semanticConfirm;
                        }
                        const localizedConfirm = [...dialog.querySelectorAll('button')]
                            .find(button => {
                                return this.adapter.isVisible(button)
                                    && TEXT.delete.test(button.textContent.trim());
                            });
                        if (localizedConfirm) {
                            return localizedConfirm;
                        }
                    }
                    return null;
                },
                3000,
                'delete confirmation'
            );
            confirmDelete.click();
            return confirmDelete;
        }

        async waitForConfirmationToClose(confirmButton) {
            try {
                await this.adapter.waitFor(
                    () => {
                        return !confirmButton.isConnected
                            || !this.adapter.isVisible(confirmButton);
                    },
                    1500,
                    'confirmation dialog to close'
                );
            } catch {
                await this.adapter.delay(100);
            }
        }

        async waitForConversationUpdate(id) {
            try {
                await this.adapter.waitFor(
                    () => {
                        return !this.adapter.findConversation(id);
                    },
                    2000,
                    'conversation row to update'
                );
            } catch {
                console.warn(
                    '[ChatGPT Bulk Delete]',
                    `Deletion was submitted, but conversation ${id} is still visible.`
                );
            }
        }
    }

    // =========================================================================
    // Controller
    // =========================================================================
    class ChatGPTBulkDelete {
        constructor() {
            this.store = new SelectionStore();
            this.adapter = new ChatGPTAdapter();
            this.view = new BulkDeleteView(this.adapter, this.store, {
                onItemChange: checkbox => {
                    this.handleItemChange(checkbox);
                },
                onSelectAll: checked => {
                    this.handleSelectAll(checked);
                },
                onDelete: () => {
                    return this.deleteSelectedItems();
                },
                onStop: () => {
                    this.store.requestStop();
                },
            });
            this.deleteQueue = new DeleteQueue(this.adapter, this.store);
            this.store.subscribe(() => {
                this.view.render();
            });
        }

        init() {
            this.observer = new MutationObserver(mutations => {
                if (this.shouldReconcile(mutations)) {
                    this.view.queueRefresh();
                }
            });
            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href'],
            });
            this.view.reconcile();
        }

        shouldReconcile(mutations) {
            if (!this.view.toolbarEl?.isConnected) {
                return true;
            }

            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    if (mutation.target.matches?.('a[href^="/c/"]')) {
                        return true;
                    }
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) {
                        continue;
                    }
                    if (
                        node.matches(SELECTORS.conversationLink)
                        || node.querySelector(SELECTORS.conversationLink)
                        || (
                            node.matches(SELECTORS.historyNav)
                            && node.querySelector('a[href^="/c/"]')
                        )
                    ) {
                        return true;
                    }
                }
            }
            return false;
        }

        handleItemChange(checkbox) {
            const link = checkbox.closest('a');
            const id = link && this.adapter.conversationId(link);
            if (!id) {
                return;
            }
            this.store.setSelected(id, checkbox.checked);
        }

        handleSelectAll(checked) {
            this.store.setMany(this.view.visibleConversationIds(), checked);
        }

        async deleteSelectedItems() {
            if (this.store.deleting || this.store.selected.size === 0) {
                return;
            }

            const ids = [...this.store.selected];
            const result = await this.deleteQueue.run(ids);
            this.view.reconcile();
            if (result.failures.length > 0) {
                alert(`Finished, but ${result.failures.length} conversation(s) could not be deleted. See the console for details.`);
            }
        }
    }

    const app = new ChatGPTBulkDelete();
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            app.init();
        }, { once: true });
    } else {
        app.init();
    }
})();

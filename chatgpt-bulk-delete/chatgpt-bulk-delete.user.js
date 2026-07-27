// ==UserScript==
// @name         ChatGPT Bulk Delete Conversations
// @namespace    https://chatgpt.com/
// @version      3.0.15
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

    const CLASS = {
        checkbox: 'chatgpt-bulk-checkbox',
        itemCheckbox: 'chatgpt-bulk-item-checkbox',
        selected: 'chatgpt-bulk-selected',
        row: 'chatgpt-bulk-row',
        toolbar: 'chatgpt-bulk-toolbar',
        toolbarAnchor: 'chatgpt-bulk-toolbar-anchor',
        toolbarRow: 'chatgpt-bulk-toolbar-row',
    };

    const SELECTOR = {
        conversation: 'a[href^="/c/"]',
        options: 'button[data-conversation-options-trigger]',
        menu: '[role="menu"]',
        deleteAction: '[data-testid="delete-chat-menu-item"]',
        dialog: '[role="dialog"]',
        confirm: 'button[data-testid="confirm-button"]',
    };

    const DELETE_TEXT = /^(Delete|刪除|删除)$/i;

    GM_addStyle(`
        .${CLASS.checkbox} {
            appearance: auto;
            -webkit-appearance: checkbox;
            width: 18px;
            height: 18px;
            margin: 0;
            accent-color: #10a37f;
            cursor: pointer;
        }

        .${CLASS.checkbox}:disabled {
            cursor: not-allowed;
            opacity: .55;
        }

        .${CLASS.row} {
            position: relative;
        }

        .${CLASS.row} > .${CLASS.itemCheckbox} {
            position: absolute;
            inset-inline-start: 16px;
            top: 50%;
            z-index: 4;
            transform: translateY(-50%);
        }

        /* Reserve checkbox space both before sync() decorates a new link and
           while ChatGPT replaces that link with its inline title editor. */
        #history a[href^="/c/"],
        .${CLASS.row} > .${CLASS.itemCheckbox} + * {
            padding-inline-start: 36px !important;
        }

        .${CLASS.selected} {
            background: rgba(16, 163, 127, .12) !important;
        }

        .${CLASS.toolbarRow} {
            justify-content: flex-start !important;
        }

        .${CLASS.toolbarAnchor} {
            width: auto !important;
            flex: 0 0 auto !important;
            padding-inline-end: 4px !important;
        }

        .${CLASS.toolbarRow} > :last-child:not(.${CLASS.toolbar}) {
            margin-inline-start: auto !important;
        }

        .${CLASS.toolbar} {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-inline-start: 2px;
            font-size: 12px;
            vertical-align: middle;
        }

        .${CLASS.toolbar} button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: #e5484d;
            cursor: pointer;
        }

        .${CLASS.toolbar} button:hover:not(:disabled) {
            background: rgba(229, 72, 77, .12);
        }

        .${CLASS.toolbar} button:disabled {
            cursor: not-allowed;
            opacity: .45;
        }

        .${CLASS.toolbar} [hidden] {
            display: none;
        }
    `);

    function isVisible(element) {
        if (!element) {
            return false;
        }
        const style = getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0'
            && element.getClientRects().length > 0;
    }

    function isOperable(element) {
        return isVisible(element)
            && !element.disabled
            && element.getAttribute('aria-disabled') !== 'true';
    }

    function waitFor(find, timeout, label) {
        const check = () => {
            try {
                return find() || null;
            } catch {
                return null;
            }
        };
        const initial = check();
        if (initial) {
            return Promise.resolve(initial);
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
                reject(new Error(`Timed out waiting for ${label}`));
            }, timeout);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
            });
        });
    }

    class ChatGPTBulkDelete {
        constructor() {
            this.selected = new Set();
            this.running = false;
            this.syncQueued = false;
            this.toolbar = null;
            this.countLabel = null;
            this.deleteButton = null;
            this.selectAll = null;
        }

        init() {
            new MutationObserver(() => this.scheduleSync()).observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href'],
            });
            this.sync();
        }

        scheduleSync() {
            if (this.syncQueued) {
                return;
            }
            this.syncQueued = true;
            requestAnimationFrame(() => {
                this.syncQueued = false;
                this.sync();
            });
        }

        history() {
            return document.getElementById('history');
        }

        links() {
            return [...(this.history()?.querySelectorAll(SELECTOR.conversation) ?? [])];
        }

        idOf(link) {
            return link.querySelector(SELECTOR.options)
                ?.dataset.conversationOptionsTrigger ?? null;
        }

        sync() {
            const links = this.links();

            for (const link of links) {
                const id = this.idOf(link);
                const row = link.parentElement;
                if (!id || !row) {
                    continue;
                }
                link.querySelector(`.${CLASS.itemCheckbox}`)?.remove();
                row.classList.add(CLASS.row);

                let checkbox = link.previousElementSibling;
                if (
                    !(checkbox instanceof HTMLInputElement)
                    || !checkbox.classList.contains(CLASS.itemCheckbox)
                    || checkbox.dataset.conversationId !== id
                ) {
                    if (checkbox?.classList.contains(CLASS.itemCheckbox)) {
                        checkbox.remove();
                    }
                    checkbox = this.createItemCheckbox(id);
                    row.insertBefore(checkbox, link);
                }
            }

            this.ensureToolbar();
            this.render();
        }

        createItemCheckbox(id) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = `${CLASS.checkbox} ${CLASS.itemCheckbox}`;
            checkbox.dataset.conversationId = id;
            for (const eventName of ['pointerdown', 'click']) {
                checkbox.addEventListener(eventName, event => event.stopPropagation());
            }
            checkbox.addEventListener('change', event => {
                if (event.currentTarget.checked) {
                    this.selected.add(id);
                } else {
                    this.selected.delete(id);
                }
                this.render();
            });
            return checkbox;
        }

        ensureToolbar() {
            if (this.toolbar?.isConnected) {
                return;
            }

            const anchor = this.findToolbarAnchor();
            if (!anchor) {
                return;
            }

            const selectAll = document.createElement('input');
            selectAll.type = 'checkbox';
            selectAll.className = CLASS.checkbox;
            selectAll.title = 'Select all visible conversations';
            selectAll.setAttribute('aria-label', selectAll.title);
            selectAll.addEventListener('click', event => event.stopPropagation());
            selectAll.addEventListener('change', event => {
                for (const id of this.visibleIds()) {
                    if (event.currentTarget.checked) {
                        this.selected.add(id);
                    } else {
                        this.selected.delete(id);
                    }
                }
                this.render();
            });

            const countLabel = document.createElement('span');
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = '🗑';
            deleteButton.title = 'Delete selected conversations';
            deleteButton.setAttribute('aria-label', deleteButton.title);
            deleteButton.addEventListener('click', event => {
                event.stopPropagation();
                void this.deleteSelected();
            });

            const toolbar = document.createElement('span');
            toolbar.className = CLASS.toolbar;
            toolbar.append(selectAll, countLabel, deleteButton);
            anchor.classList.add(CLASS.toolbarAnchor);
            anchor.parentElement?.classList.add(CLASS.toolbarRow);
            anchor.insertAdjacentElement('afterend', toolbar);

            this.toolbar = toolbar;
            this.countLabel = countLabel;
            this.deleteButton = deleteButton;
            this.selectAll = selectAll;
        }

        findToolbarAnchor() {
            return this.history()
                ?.previousElementSibling
                ?.querySelector('h2')
                ?.closest('button') ?? null;
        }

        visibleIds() {
            const checkboxes = this.history()
                ?.querySelectorAll(`.${CLASS.itemCheckbox}`) ?? [];
            return [...checkboxes]
                .filter(isVisible)
                .map(checkbox => checkbox.dataset.conversationId)
                .filter(Boolean);
        }

        render() {
            for (const link of this.links()) {
                const id = this.idOf(link);
                const checkbox = link.previousElementSibling;
                if (!id || !checkbox?.classList.contains(CLASS.itemCheckbox)) {
                    continue;
                }
                const selected = this.selected.has(id);
                checkbox.checked = selected;
                checkbox.disabled = this.running;
                checkbox.setAttribute(
                    'aria-label',
                    `Select ${link.textContent.trim() || 'conversation'}`
                );
                link.classList.toggle(CLASS.selected, selected);
            }

            if (!this.toolbar?.isConnected) {
                return;
            }
            const count = this.selected.size;
            this.countLabel.hidden = count === 0;
            this.deleteButton.hidden = count === 0;
            this.countLabel.textContent = String(count);
            this.countLabel.title = `${count} selected`;
            this.countLabel.setAttribute('aria-label', this.countLabel.title);
            this.deleteButton.disabled = this.running;
            this.toolbar.setAttribute('aria-busy', String(this.running));

            const visibleIds = this.visibleIds();
            const selectedVisible = visibleIds.filter(id => this.selected.has(id)).length;
            this.selectAll.checked = visibleIds.length > 0
                && selectedVisible === visibleIds.length;
            this.selectAll.indeterminate = selectedVisible > 0
                && selectedVisible < visibleIds.length;
            this.selectAll.disabled = this.running || visibleIds.length === 0;
        }

        deleteActions() {
            return [...document.querySelectorAll(SELECTOR.deleteAction)]
                .filter(isOperable);
        }

        confirmButtons() {
            const buttons = [];
            for (const dialog of document.querySelectorAll(SELECTOR.dialog)) {
                if (!isVisible(dialog)) {
                    continue;
                }
                const semantic = dialog.querySelector(SELECTOR.confirm);
                const textMatch = [...dialog.querySelectorAll('button')].find(button => {
                    return isOperable(button) && DELETE_TEXT.test(button.textContent.trim());
                });
                const confirm = isOperable(semantic) ? semantic : textMatch;
                if (confirm) {
                    buttons.push(confirm);
                }
            }
            return buttons;
        }

        async submitDelete(id) {
            let submitted = false;
            try {
                const link = this.links().find(item => this.idOf(item) === id);
                if (!link) {
                    throw new Error(`Conversation not found: ${id}`);
                }

                link.scrollIntoView({ block: 'nearest' });
                for (const target of [link.parentElement, link]) {
                    for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
                        target?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
                    }
                }

                const options = await waitFor(() => {
                    const button = link.querySelector(SELECTOR.options);
                    return isOperable(button) ? button : null;
                }, 2500, 'conversation options button');

                const oldDeleteActions = new Set(this.deleteActions());
                options.click();
                const deleteAction = await waitFor(() => {
                    return this.deleteActions().find(item => !oldDeleteActions.has(item));
                }, 2500, 'delete menu item');

                const oldConfirmButtons = new Set(this.confirmButtons());
                deleteAction.click();
                const confirm = await waitFor(() => {
                    return this.confirmButtons().find(item => !oldConfirmButtons.has(item));
                }, 2500, 'delete confirmation');
                const dialog = confirm.closest(SELECTOR.dialog);
                if (!dialog) {
                    throw new Error('Delete confirmation dialog was not found');
                }

                confirm.click();
                submitted = true;

                // Do not wait for the sidebar row; it can remain long after the
                // request is accepted. Only wait for the shared dialog to close.
                await waitFor(
                    () => !dialog.isConnected || !isVisible(dialog),
                    1500,
                    'delete confirmation dialog to close'
                );
            } catch (error) {
                if (error && typeof error === 'object') {
                    error.deleteSubmitted = submitted;
                }
                throw error;
            }
        }

        openLayers() {
            return [
                ...document.querySelectorAll(`${SELECTOR.menu}, ${SELECTOR.dialog}`),
            ].filter(isVisible);
        }

        async recoverUi() {
            if (this.openLayers().length === 0) {
                return true;
            }
            const target = document.activeElement instanceof Element
                ? document.activeElement
                : document.body;
            target.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
            }));
            try {
                await waitFor(
                    () => this.openLayers().length === 0,
                    1000,
                    'open menu or dialog to close'
                );
                return true;
            } catch {
                return false;
            }
        }

        async deleteSelected() {
            if (this.running || this.selected.size === 0) {
                return;
            }

            const ids = [...this.selected];
            const submitted = new Set();
            const failed = [];
            let halted = '';
            this.running = true;
            this.render();

            try {
                if (!await this.recoverUi()) {
                    halted = 'An existing ChatGPT menu or dialog could not be closed.';
                } else {
                    for (const id of ids) {
                        try {
                            await this.submitDelete(id);
                            submitted.add(id);
                        } catch (error) {
                            console.error('[ChatGPT Bulk Delete]', id, error);
                            if (error?.deleteSubmitted) {
                                submitted.add(id);
                                halted = 'A request was submitted, but ChatGPT did not release the dialog.';
                                break;
                            }
                            failed.push(id);
                            if (!await this.recoverUi()) {
                                halted = 'ChatGPT did not return to a safe UI state.';
                                break;
                            }
                        }
                    }
                }
            } finally {
                for (const id of submitted) {
                    this.selected.delete(id);
                }
                this.running = false;
                this.sync();
            }

            const messages = [];
            if (failed.length > 0) {
                messages.push(`${failed.length} conversation(s) could not be submitted.`);
            }
            if (halted) {
                messages.push(halted, 'The remaining conversations were not processed.');
            }
            if (messages.length > 0) {
                alert(messages.join('\n'));
            }
        }
    }

    new ChatGPTBulkDelete().init();
})();

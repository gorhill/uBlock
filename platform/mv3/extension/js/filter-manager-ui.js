/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2025-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import { browser, sendMessage } from './ext.js';
import { dom, qs$, qsa$ } from './dom.js';
import { nodeFromTemplate } from './dashboard.js';
import punycode from './punycode.js';

/******************************************************************************/

const dataContainer = qs$('section[data-pane="filters"] .hostnames');

/******************************************************************************/

function isValidHostname(hostname) {
    try {
        const url = new URL(`https://${hostname}/`);
        return url.hostname === hostname;
    } catch {
    }
    return false;
}

/******************************************************************************/

function toPrettySelector(selector) {
    if ( selector.startsWith('{') === false ) { return selector; }
    try {
        return JSON.parse(selector).raw;
    } catch {
    }
    return selector;
}

/******************************************************************************/

function hostnameFromNode(node) {
    const li = node.closest('li.hostname');
    if ( li === null ) { return; }
    const span = qs$(li, '.hostname[data-pretty]');
    if ( span === null ) { return; }
    return span.dataset.ugly || undefined;
}

function selectorFromNode(node) {
    const li = node.closest('li.selector');
    if ( li === null ) { return; }
    const span = qs$(li, '.selector[data-pretty]');
    if ( span === null ) { return; }
    return span.dataset.ugly || undefined;
}

function selectorsFromNode(node, all = false) {
    const li = node.closest('li.hostname');
    if ( li === null ) { return []; }
    const qsel = all
        ? 'li.selector [contenteditable]'
        : 'li.selector:not(.removed) [contenteditable]';
    return Array.from(qsa$(li, qsel)).map(a => a.dataset.ugly);
}

/******************************************************************************/

async function removeSelectorsFromHostname(node) {
    const hostnameNode = node.closest('li.hostname');
    if ( hostnameNode === null ) { return; }
    const hostname = hostnameFromNode(hostnameNode);
    if ( hostname === undefined ) { return; }
    const selectors = Array.from(
        qsa$(hostnameNode, 'li.selector.removed [contenteditable]')
    ).map(a => a.dataset.ugly);
    if ( selectors.length === 0 ) { return; }
    dom.cl.add(dom.body, 'busy');
    updateContentEditability();
    await sendMessage({ what: 'removeCustomFilters', hostname, selectors });
    await debounceRenderCustomFilters();
    dom.cl.remove(dom.body, 'busy');
    updateContentEditability();
}

async function unremoveSelectorsFromHostname(node) {
    const hostnameNode = node.closest('li.hostname');
    if ( hostnameNode === null ) { return; }
    const hostname = hostnameFromNode(hostnameNode);
    if ( hostname === undefined ) { return; }
    const selectors = Array.from(
        qsa$(hostnameNode, 'li.selector:not(.removed) [contenteditable]')
    ).map(a => a.dataset.ugly);
    if ( selectors.length === 0 ) { return; }
    dom.cl.add(dom.body, 'busy');
    updateContentEditability();
    await sendMessage({ what: 'addCustomFilters', hostname, selectors });
    await debounceRenderCustomFilters();
    dom.cl.remove(dom.body, 'busy');
    updateContentEditability();
}

/******************************************************************************/

function dataFromDOM() {
    const data = new Map();
    for ( const hostnameNode of qsa$('li.hostname') ) {
        const hostname = hostnameFromNode(hostnameNode);
        const selectors = [];
        for ( const selectorNode of qsa$(hostnameNode, 'li.selector') ) {
            selectors.push(selectorFromNode(selectorNode));
        }
        data.set(hostname, selectors);
    }
    return data;
}

/******************************************************************************/

async function renderCustomFilters() {
    const data = await sendMessage({ what: 'getAllCustomFilters' });
    if ( Boolean(data) === false ) { return; }
    const storedData = new Map(data);
    const domData = dataFromDOM();
    const hostnames = Array.from(
        new Set([
            ...Array.from(storedData.keys()),
            ...Array.from(domData.keys()),
        ])
    ).sort();
    const fragment = document.createDocumentFragment();
    for ( const hostname of hostnames ) {
        const hostnameNode = nodeFromTemplate('customFiltersHostname');
        const label = qs$(hostnameNode, 'span.hostname');
        label.dataset.ugly = hostname;
        const pretty = punycode.toUnicode(hostname);
        label.dataset.pretty = pretty;
        dom.text(label, pretty);
        const storedSelectors = new Set(storedData.get(hostname));
        const domSelectors = new Set(domData.get(hostname));
        const selectors = Array.from(
            new Set([
                ...Array.from(storedSelectors),
                ...Array.from(domSelectors),
            ])
        ).sort();
        const ulSelectors = qs$(hostnameNode, '.selectors');
        for ( const selector of selectors ) {
            const selectorNode = nodeFromTemplate('customFiltersSelector');
            const label = qs$(selectorNode, 'span.selector');
            label.dataset.ugly = selector;
            const pretty = toPrettySelector(selector);
            label.dataset.pretty = pretty;
            dom.text(label, pretty);
            if ( storedSelectors.has(selector) === false ) {
                dom.cl.add(selectorNode, 'removed');
            }
            ulSelectors.append(selectorNode);
        }
        fragment.append(hostnameNode);
    }
    dom.remove('section[data-pane="filters"] .hostnames > .hostname');
    dataContainer.prepend(fragment);
}

async function debounceRenderCustomFilters() {
    let { debouncer } = debounceRenderCustomFilters;
    if ( debouncer === undefined ) {
        debouncer = debounceRenderCustomFilters.debouncer = {};
        debouncer.promise = new Promise(resolve => {
            debouncer.resolve = resolve;
        });
    }
    if ( debouncer.timer !== undefined ) {
        self.clearTimeout(debouncer.timer);
    }
    debouncer.timer = self.setTimeout(( ) => {
        const { resolve } = debounceRenderCustomFilters.debouncer;
        debounceRenderCustomFilters.debouncer = undefined;
        renderCustomFilters().then(resolve);
    }, 151);
    return debouncer.promise;
}
debounceRenderCustomFilters.debouncer = undefined;

/******************************************************************************/

function updateContentEditability() {
    if ( dom.cl.has(dom.body, 'busy') ) {
        dom.attr('[contenteditable]', 'contenteditable', 'false');
        return;
    }
    dom.attr('section[data-pane="filters"] li:not(.removed) [contenteditable]',
        'contenteditable',
        'plaintext-only'
    );
    // No point editing a removed hostname
    dom.attr('section[data-pane="filters"] li.hostname:not(:has(li.selector:not(.removed))) > div [contenteditable]',
        'contenteditable',
        'false'
    );
    // No point editing a removed selector
    dom.attr('section[data-pane="filters"] .selector.removed [contenteditable]',
        'contenteditable',
        'false'
    );
}

/******************************************************************************/

async function onHostnameChanged(target, before, after) {
    const uglyAfter = punycode.toASCII(after);
    if ( isValidHostname(uglyAfter) === false ) {
        target.textContent = before;
        return;
    }

    dom.cl.add(dom.body, 'busy');
    updateContentEditability();

    // Remove old hostname from storage
    await sendMessage({ what: 'removeAllCustomFilters',
        hostname: target.dataset.ugly,
    });

    // Add selectors under new hostname to storage
    target.dataset.ugly = uglyAfter;
    target.dataset.pretty = after;
    await sendMessage({ what: 'addCustomFilters',
        hostname: hostnameFromNode(target),
        selectors: selectorsFromNode(target),
    });

    await debounceRenderCustomFilters();
    dom.cl.remove(dom.body, 'busy');
    updateContentEditability();
}

async function onSelectorChanged(target, before, after) {
    // Validate selector
    const parserModule = await import('./static-filtering-parser.js');
    const compiler = new parserModule.ExtSelectorCompiler({ nativeCssHas: true });
    const result = {};
    if ( compiler.compile(after, result) === false ) {
        target.textContent = before;
        return;
    }

    const hostname = hostnameFromNode(target);

    dom.cl.add(dom.body, 'busy');
    updateContentEditability();

    // Remove old selector from storage
    await sendMessage({ what: 'removeCustomFilters',
        hostname,
        selectors: [ target.dataset.ugly ],
    });

    // Add new selector to storage
    target.dataset.ugly = result.compiled;
    target.dataset.pretty = result.raw;
    await sendMessage({ what: 'addCustomFilters',
        hostname,
        selectors: [ result.compiled ],
    });

    await debounceRenderCustomFilters();
    dom.cl.remove(dom.body, 'busy');
    updateContentEditability();
}

function onTextChanged(target) {
    const before = target.dataset.pretty;
    const after = target.textContent.trim();
    if ( after !== target.textContent ) {
        target.textContent = after;
    }
    if ( after === before ) { return; }
    if ( after === '' ) {
        target.textContent = before;
        return;
    }
    if ( target.matches('.hostname') ) {
        onHostnameChanged(target, before, after);
    } else if ( target.matches('.selector') ) {
        onSelectorChanged(target, before, after);
    }
}

/******************************************************************************/

function startEdit(ev) {
    focusedEditableContent = ev.target;
}

function endEdit(ev) {
    const { target } = ev;
    if ( target.textContent !== target.dataset.pretty ) {
        onTextChanged(target);
    }
    focusedEditableContent = null;
}

function commitEdit(ev) {
    const { target } = ev;
    if ( target === focusedEditableContent ) {
        if ( ev.inputType === 'insertLineBreak' ) { target.blur(); }
        return;
    }
    onTextChanged(target);
}

let focusedEditableContent = null;

/******************************************************************************/

function onTrashClicked(ev) {
    const { target } = ev;
    const node = target.closest('li.selector');
    if ( node ) {
        dom.cl.add(node, 'removed');
    } else {
        dom.cl.add(qsa$(target.closest('li.hostname'), 'li.selector'), 'removed');
    }
    removeSelectorsFromHostname(target);
}

function onUndoClicked(ev) {
    const { target } = ev;
    const node = target.closest('li.selector');
    if ( node ) {
        dom.cl.remove(node, 'removed');
    } else {
        dom.cl.remove(qsa$(target.closest('li.hostname'), 'li.selector'), 'removed');
    }
    unremoveSelectorsFromHostname(target);
}

/******************************************************************************/

async function importFromText(text) {
    const parserModule = await import('./static-filtering-parser.js');
    const parser = new parserModule.AstFilterParser({ nativeCssHas: true });
    const lines = text.split(/\n/);
    const hostnameToSelectorsMap = new Map();

    for ( const line of lines ) {
        parser.parse(line);
        if ( parser.hasError() ) { continue; }
        if ( parser.isCosmeticFilter() === false ) { continue; }
        if ( parser.hasOptions() === false ) { continue; }
        const { compiled, exception } = parser.result;
        if ( compiled === undefined ) { continue; }
        if ( exception ) { continue; }
        const hostnames = new Set();
        for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
            if ( bad ) { continue; }
            if ( hn.includes('/') ) { continue; }
            if ( hn.includes('*') ) { continue; }
            if ( not ) { hostnames.length = 0; break; }
            hostnames.add(hn);
        }
        for ( const hn of hostnames ) {
            const selectors = hostnameToSelectorsMap.get(hn) || new Set();
            if ( selectors.size === 0 ) {
                hostnameToSelectorsMap.set(hn, selectors)
            }
            selectors.add(compiled);
        }
    }

    if ( hostnameToSelectorsMap.size === 0 ) { return; }

    dom.cl.add(dom.body, 'busy');
    updateContentEditability();

    const promises = [];
    for ( const [ hostname, selectors ] of hostnameToSelectorsMap ) {
        promises.push(
            sendMessage({ what: 'addCustomFilters',
                hostname,
                selectors: Array.from(selectors),
            })
        );
    }
    await Promise.all(promises);

    await debounceRenderCustomFilters();
    dom.cl.remove(dom.body, 'busy');
    updateContentEditability();
}

/******************************************************************************/

function importFromTextarea() {
    dom.prop('section[data-pane="filters"] details', 'open', false);
    const textarea = qs$('section[data-pane="filters"] .importFromText textarea');
    importFromText(textarea.value);
    textarea.value = '';
}

/******************************************************************************/

function importFromFile() {
    const input = qs$('section[data-pane="filters"] input[type="file"]');
    input.onchange = ev => {
        input.onchange = null;
        const file = ev.target.files[0];
        if ( file === undefined || file.name === '' ) { return; }
        const fr = new FileReader();
        fr.onload = ( ) => {
            if ( typeof fr.result !== 'string' ) { return; }
            importFromText(fr.result);
        };
        fr.readAsText(file);
    };
    // Reset to empty string, this will ensure a change event is properly
    // triggered if the user pick a file, even if it's the same as the last
    // one picked.
    input.value = '';
    input.click();
    dom.prop('section[data-pane="filters"] details', 'open', false);
}

/******************************************************************************/

function exportToFile() {
    const lines = [];
    for ( const hostnameNode of qsa$('.hostnames li.hostname') ) {
        const hostname = punycode.toUnicode(hostnameFromNode(hostnameNode));
        const selectors = selectorsFromNode(hostnameNode);
        for ( const selector of selectors ) {
            lines.push(`${hostname}##${toPrettySelector(selector)}`);
        }
        lines.push('');
    }
    const text = lines.join('\n').trim();
    if ( text.length === 0 ) { return; }
    const a = document.createElement('a');
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text + '\n')}`;
    dom.attr(a, 'download', 'my-ubol-filters.txt');
    dom.attr(a, 'type', 'text/plain');
    a.click();
    dom.prop('section[data-pane="filters"] details', 'open', false);
}

/******************************************************************************/

async function start() {
    renderCustomFilters();

    dom.on(dataContainer, 'focusin', 'section[data-pane="filters"] [contenteditable]', startEdit);
    dom.on(dataContainer, 'focusout', 'section[data-pane="filters"] [contenteditable]', endEdit);
    dom.on(dataContainer, 'input', 'section[data-pane="filters"] [contenteditable]', commitEdit);
    dom.on(dataContainer, 'click', 'section[data-pane="filters"] .remove', onTrashClicked);
    dom.on(dataContainer, 'click', 'section[data-pane="filters"] .undo', onUndoClicked);
    dom.on('section[data-pane="filters"] [data-i18n="addButton"]', 'click', importFromTextarea);
    dom.on('section[data-pane="filters"] [data-i18n="importAndAppendButton"]', 'click', importFromFile);
    dom.on('section[data-pane="filters"] [data-i18n="exportButton"]', 'click', exportToFile);

    browser.storage.local.onChanged.addListener((changes, area) => {
        if ( area !== undefined && area !== 'local' ) { return; }
        if ( Object.keys(changes).some(a => a.startsWith('site.')) ) {
            debounceRenderCustomFilters();
        }
    });
}

/******************************************************************************/

// Update pane on-demand
dom.onFirstShown(start, qs$('section[data-pane="filters"]'));

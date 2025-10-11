/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2014-present Raymond Hill

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

// Important!
// Isolate from global scope
(function uBOL_cssProceduralAPI() {

if ( self.ProceduralFiltererAPI !== undefined ) {
    if ( self.ProceduralFiltererAPI instanceof Promise === false ) { return; }
}

/******************************************************************************/

const nonVisualElements = {
    head: true,
    link: true,
    meta: true,
    script: true,
    style: true,
};

const regexFromString = (s, exact = false) => {
    if ( s === '' ) { return /^/; }
    const match = /^\/(.+)\/([imu]*)$/.exec(s);
    if ( match !== null ) {
        return new RegExp(match[1], match[2] || undefined);
    }
    const reStr = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(exact ? `^${reStr}$` : reStr);
};

const randomToken = ( ) => {
    const n = Math.random();
    return String.fromCharCode(n * 25 + 97) +
        Math.floor(
            (0.25 + n * 0.75) * Number.MAX_SAFE_INTEGER
        ).toString(36).slice(-8);
};

/******************************************************************************/

// 'P' stands for 'Procedural'

class PSelectorTask {
    destructor() {
    }
    begin() {
    }
    end() {
    }
}

/******************************************************************************/

class PSelectorVoidTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        console.info(`uBO: :${task[0]}() operator does not exist`);
    }
    transpose() {
    }
}

/******************************************************************************/

class PSelectorHasTextTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.needle = regexFromString(task[1]);
    }
    transpose(node, output) {
        if ( this.needle.test(node.textContent) ) {
            output.push(node);
        }
    }
}

/******************************************************************************/

class PSelectorIfTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.pselector = new PSelector(filterer, task[1]);
    }
    transpose(node, output) {
        if ( this.pselector.test(node) === this.target ) {
            output.push(node);
        }
    }
    target = true;
}

class PSelectorIfNotTask extends PSelectorIfTask {
    target = false;
}

/******************************************************************************/

class PSelectorMatchesAttrTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.reAttr = regexFromString(task[1].attr, true);
        this.reValue = regexFromString(task[1].value, true);
    }
    transpose(node, output) {
        if ( typeof node.getAttributeNames !== 'function' ) { return; }
        const attrs = node.getAttributeNames();
        for ( const attr of attrs ) {
            if ( this.reAttr.test(attr) === false ) { continue; }
            if ( this.reValue.test(node.getAttribute(attr)) === false ) { continue; }
            output.push(node);
        }
    }
}

/******************************************************************************/

class PSelectorMatchesCSSTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.name = task[1].name;
        this.pseudo = task[1].pseudo ? `::${task[1].pseudo}` : null;
        let arg0 = task[1].value, arg1;
        if ( Array.isArray(arg0) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.value = new RegExp(arg0, arg1);
    }
    transpose(node, output) {
        const style = window.getComputedStyle(node, this.pseudo);
        if ( style !== null && this.value.test(style[this.name]) ) {
            output.push(node);
        }
    }
}
class PSelectorMatchesCSSAfterTask extends PSelectorMatchesCSSTask {
    constructor(filterer, task) {
        super(filterer, task);
        this.pseudo = '::after';
    }
}

class PSelectorMatchesCSSBeforeTask extends PSelectorMatchesCSSTask {
    constructor(filterer, task) {
        super(filterer, task);
        this.pseudo = '::before';
    }
}

/******************************************************************************/

class PSelectorMatchesMediaTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.filterer = filterer;
        this.mql = window.matchMedia(task[1]);
        if ( this.mql.media === 'not all' ) { return; }
        this.boundHandler = this.handler.bind(this);
        this.mql.addEventListener('change', this.boundHandler);
    }
    destructor() {
        super.destructor();
        this.mql.removeEventListener('change', this.boundHandler);
    }
    transpose(node, output) {
        if ( this.mql.matches === false ) { return; }
        output.push(node);
    }
    handler() {
        if ( this.filterer instanceof Object === false ) { return; }
        this.filterer.uBOL_DOMChanged();
    }
}

/******************************************************************************/

class PSelectorMatchesPathTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.needle = regexFromString(
            task[1].replace(/\P{ASCII}/gu, s => encodeURIComponent(s))
        );
    }
    transpose(node, output) {
        if ( this.needle.test(self.location.pathname + self.location.search) ) {
            output.push(node);
        }
    }
}

/******************************************************************************/

class PSelectorMatchesPropTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.props = task[1].attr.split('.');
        this.reValue = task[1].value !== ''
            ? regexFromString(task[1].value, true)
            : null;
    }
    transpose(node, output) {
        let value = node;
        for ( const prop of this.props ) {
            if ( value === undefined ) { return; }
            if ( value === null ) { return; }
            value = value[prop];
        }
        if ( this.reValue === null ) {
            if ( value === undefined ) { return; }
        } else if ( this.reValue.test(value) === false ) {
            return;
        }
        output.push(node);
    }
}

/******************************************************************************/

class PSelectorMinTextLengthTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.min = task[1];
    }
    transpose(node, output) {
        if ( node.textContent.length >= this.min ) {
            output.push(node);
        }
    }
}

/******************************************************************************/

class PSelectorOthersTask extends PSelectorTask {
    constructor() {
        super();
        this.targets = new Set();
    }
    begin() {
        this.targets.clear();
    }
    end(output) {
        const toKeep = new Set(this.targets);
        const toDiscard = new Set();
        const body = document.body;
        const head = document.head;
        let discard = null;
        for ( let keep of this.targets ) {
            while ( keep !== null && keep !== body && keep !== head ) {
                toKeep.add(keep);
                toDiscard.delete(keep);
                discard = keep.previousElementSibling;
                while ( discard !== null ) {
                    if ( nonVisualElements[discard.localName] !== true ) {
                        if ( toKeep.has(discard) === false ) {
                            toDiscard.add(discard);
                        }
                    }
                    discard = discard.previousElementSibling;
                }
                discard = keep.nextElementSibling;
                while ( discard !== null ) {
                    if ( nonVisualElements[discard.localName] !== true ) {
                        if ( toKeep.has(discard) === false ) {
                            toDiscard.add(discard);
                        }
                    }
                    discard = discard.nextElementSibling;
                }
                keep = keep.parentElement;
            }
        }
        for ( discard of toDiscard ) {
            output.push(discard);
        }
        this.targets.clear();
    }
    transpose(candidate) {
        for ( const target of this.targets ) {
            if ( target.contains(candidate) ) { return; }
            if ( candidate.contains(target) ) {
                this.targets.delete(target);
            }
        }
        this.targets.add(candidate);
    }
}

/******************************************************************************/

class PSelectorShadowTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.selector = task[1];
    }
    transpose(node, output) {
        const root = this.openOrClosedShadowRoot(node);
        if ( root === null ) { return; }
        const nodes = root.querySelectorAll(this.selector);
        output.push(...nodes);
    }
    get openOrClosedShadowRoot() {
        if ( PSelectorShadowTask.openOrClosedShadowRoot !== undefined ) {
            return PSelectorShadowTask.openOrClosedShadowRoot;
        }
        if ( typeof chrome === 'object' && chrome !== null ) {
            if ( chrome.dom instanceof Object ) {
                if ( typeof chrome.dom.openOrClosedShadowRoot === 'function' ) {
                    PSelectorShadowTask.openOrClosedShadowRoot =
                        chrome.dom.openOrClosedShadowRoot;
                    return PSelectorShadowTask.openOrClosedShadowRoot;
                }
            }
        }
        PSelectorShadowTask.openOrClosedShadowRoot = node =>
            node.openOrClosedShadowRoot || null;
        return PSelectorShadowTask.openOrClosedShadowRoot;
    }
}

/******************************************************************************/

// https://github.com/AdguardTeam/ExtendedCss/issues/31#issuecomment-302391277
//   Prepend `:scope ` if needed.
class PSelectorSpathTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.spath = task[1];
        this.nth = /^(?:\s*[+~]|:)/.test(this.spath);
        if ( this.nth ) { return; }
        if ( /^\s*>/.test(this.spath) ) {
            this.spath = `:scope ${this.spath.trim()}`;
        }
    }
    transpose(node, output) {
        const nodes = this.nth
            ? PSelectorSpathTask.qsa(node, this.spath)
            : node.querySelectorAll(this.spath);
        for ( const node of nodes ) {
            output.push(node);
        }
    }
    // Helper method for other operators.
    static qsa(node, selector) {
        const parent = node.parentElement;
        if ( parent === null ) { return []; }
        let pos = 1;
        for (;;) {
            node = node.previousElementSibling;
            if ( node === null ) { break; }
            pos += 1;
        }
        return parent.querySelectorAll(
            `:scope > :nth-child(${pos})${selector}`
        );
    }
}

/******************************************************************************/

class PSelectorUpwardTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        const arg = task[1];
        if ( typeof arg === 'number' ) {
            this.i = arg;
        } else {
            this.s = arg;
        }
    }
    transpose(node, output) {
        if ( this.s !== '' ) {
            const parent = node.parentElement;
            if ( parent === null ) { return; }
            node = parent.closest(this.s);
            if ( node === null ) { return; }
        } else {
            let nth = this.i;
            for (;;) {
                node = node.parentElement;
                if ( node === null ) { return; }
                nth -= 1;
                if ( nth === 0 ) { break; }
            }
        }
        output.push(node);
    }
    i = 0;
    s = '';
}

/******************************************************************************/

class PSelectorWatchAttrs extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.filterer = filterer;
        this.observer = null;
        this.observed = new WeakSet();
        this.observerOptions = {
            attributes: true,
            subtree: true,
        };
        const attrs = task[1];
        if ( Array.isArray(attrs) && attrs.length !== 0 ) {
            this.observerOptions.attributeFilter = task[1];
        }
    }
    destructor() {
        super.destructor();
        if ( this.observer ) {
            this.observer.takeRecords();
            this.observer.disconnect();
            this.observer = null;
        }
    }
    transpose(node, output) {
        output.push(node);
        if ( this.filterer instanceof Object === false ) { return; }
        if ( this.observed.has(node) ) { return; }
        if ( this.observer === null ) {
            this.observer = new MutationObserver(( ) => {
                this.filterer.uBOL_DOMChanged();
            });
        }
        this.observer.observe(node, this.observerOptions);
        this.observed.add(node);
    }
}

/******************************************************************************/

class PSelectorXpathTask extends PSelectorTask {
    constructor(filterer, task) {
        super();
        this.xpe = document.createExpression(task[1], null);
        this.xpr = null;
    }
    transpose(node, output) {
        this.xpr = this.xpe.evaluate(
            node,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            this.xpr
        );
        let j = this.xpr.snapshotLength;
        while ( j-- ) {
            const node = this.xpr.snapshotItem(j);
            if ( node.nodeType === 1 ) {
                output.push(node);
            }
        }
    }
}

/******************************************************************************/

class PSelector {
    constructor(filterer, o) {
        this.selector = o.selector;
        this.tasks = [];
        const tasks = [];
        if ( Array.isArray(o.tasks) === false ) { return; }
        for ( const task of o.tasks ) {
            const ctor = PSelector.operatorToTaskMap.get(task[0]) || PSelectorVoidTask;
            tasks.push(new ctor(filterer, task));
        }
        this.tasks = tasks;
    }
    destructor() {
        for ( const task of this.tasks ) {
            task.destructor();
        }
    }
    prime(input) {
        const root = input || document;
        if ( this.selector === '' ) { return [ root ]; }
        if ( input !== document ) {
            const c0 = this.selector.charCodeAt(0);
            if ( c0 === 0x2B /* + */ || c0 === 0x7E /* ~ */ ) {
                return Array.from(PSelectorSpathTask.qsa(input, this.selector));
            } else if ( c0 === 0x3E /* > */ ) {
                return Array.from(input.querySelectorAll(`:scope ${this.selector}`));
            }
        }
        return Array.from(root.querySelectorAll(this.selector));
    }
    exec(input) {
        let nodes = this.prime(input);
        for ( const task of this.tasks ) {
            if ( nodes.length === 0 ) { break; }
            const transposed = [];
            task.begin();
            for ( const node of nodes ) {
                task.transpose(node, transposed);
            }
            task.end(transposed);
            nodes = transposed;
        }
        return nodes;
    }
    test(input) {
        const nodes = this.prime(input);
        for ( const node of nodes ) {
            let output = [ node ];
            for ( const task of this.tasks ) {
                const transposed = [];
                task.begin();
                for ( const node of output ) {
                    task.transpose(node, transposed);
                }
                task.end(transposed);
                output = transposed;
                if ( output.length === 0 ) { break; }
            }
            if ( output.length !== 0 ) { return true; }
        }
        return false;
    }
    static operatorToTaskMap = new Map([
        [ 'has', PSelectorIfTask ],
        [ 'has-text', PSelectorHasTextTask ],
        [ 'if', PSelectorIfTask ],
        [ 'if-not', PSelectorIfNotTask ],
        [ 'matches-attr', PSelectorMatchesAttrTask ],
        [ 'matches-css', PSelectorMatchesCSSTask ],
        [ 'matches-css-after', PSelectorMatchesCSSAfterTask ],
        [ 'matches-css-before', PSelectorMatchesCSSBeforeTask ],
        [ 'matches-media', PSelectorMatchesMediaTask ],
        [ 'matches-path', PSelectorMatchesPathTask ],
        [ 'matches-prop', PSelectorMatchesPropTask ],
        [ 'min-text-length', PSelectorMinTextLengthTask ],
        [ 'not', PSelectorIfNotTask ],
        [ 'others', PSelectorOthersTask ],
        [ 'shadow', PSelectorShadowTask ],
        [ 'spath', PSelectorSpathTask ],
        [ 'upward', PSelectorUpwardTask ],
        [ 'watch-attr', PSelectorWatchAttrs ],
        [ 'xpath', PSelectorXpathTask ],
    ]);
}

/******************************************************************************/

class PSelectorRoot extends PSelector {
    constructor(filterer, o) {
        super(filterer, o);
        this.budget = 200; // I arbitrary picked a 1/5 second
        this.raw = o.raw;
        this.cost = 0;
        this.lastAllowanceTime = 0;
        this.action = o.action;
    }
    prime(input) {
        try {
            return super.prime(input);
        } catch {
        }
        return [];
    }
    exec(input) {
        try {
            return super.exec(input);
        } catch {
        }
        return [];
    }
}

/******************************************************************************/

class ProceduralFilterer {
    constructor() {
        this.selectors = [];
        this.styleTokenMap = new Map();
        this.styledNodes = new Set();
        this.timer = undefined;
        this.hideStyle = 'display:none!important;';
    }

    async reset() {
        if ( this.timer ) {
            self.cancelAnimationFrame(this.timer);
            this.timer = undefined;
        }
        for ( const pselector of this.selectors.values() ) {
            pselector.destructor();
        }
        this.selectors.length = 0;
        const promises = [];
        for ( const [ style, token ] of this.styleTokenMap ) {
            for ( const elem of this.styledNodes ) {
                elem.removeAttribute(token);
            }
            const css = `[${token}]\n{${style}}\n`;
            promises.push(
                chrome.runtime.sendMessage({ what: 'removeCSS', css }).catch(( ) => { })
            );
        }
        this.styleTokenMap.clear();
        this.styledNodes.clear();
        return Promise.all(promises);
    }

    addSelectors(selectors) {
        for ( const selector of selectors ) {
            const pselector = new PSelectorRoot(this, selector);
            this.primeProceduralSelector(pselector);
            this.selectors.push(pselector);
        }
    }

    // This allows to perform potentially expensive initialization steps
    // before the filters are ready to be applied.
    primeProceduralSelector(pselector) {
        if ( pselector.action === undefined ) {
            this.styleTokenFromStyle(this.hideStyle);
        } else if ( pselector.action[0] === 'style' ) {
            this.styleTokenFromStyle(pselector.action[1]);
        }
        return pselector;
    }

    uBOL_commit() {
        if ( this.timer !== undefined ) {
            self.cancelAnimationFrame(this.timer);
            this.timer = undefined;
        }

        // https://github.com/uBlockOrigin/uBlock-issues/issues/341
        //   Be ready to unhide nodes which no longer matches any of
        //   the procedural selectors.
        const toUnstyle = this.styledNodes;
        this.styledNodes = new Set();

        let t0 = Date.now();

        for ( const pselector of this.selectors.values() ) {
            const allowance = Math.floor((t0 - pselector.lastAllowanceTime) / 2000);
            if ( allowance >= 1 ) {
                pselector.budget += allowance * 50;
                if ( pselector.budget > 200 ) { pselector.budget = 200; }
                pselector.lastAllowanceTime = t0;
            }
            if ( pselector.budget <= 0 ) { continue; }
            const nodes = pselector.exec();
            const t1 = Date.now();
            pselector.budget += t0 - t1;
            if ( pselector.budget < -500 ) {
                console.info('uBOL: disabling %s', pselector.raw);
                pselector.budget = -0x7FFFFFFF;
            }
            t0 = t1;
            if ( nodes.length === 0 ) { continue; }
            this.processNodes(nodes, pselector.action);
        }

        this.unprocessNodes(toUnstyle);
    }

    styleTokenFromStyle(style) {
        if ( style === undefined ) { return; }
        let styleToken = this.styleTokenMap.get(style);
        if ( styleToken !== undefined ) { return styleToken; }
        styleToken = randomToken();
        this.styleTokenMap.set(style, styleToken);
        self.cssAPI.insert(`[${styleToken}]\n{${style}}\n`);
        return styleToken;
    }

    processNodes(nodes, action) {
        const op = action && action[0] || '';
        const arg = op !== '' ? action[1] : '';
        switch ( op ) {
        case '':
            /* fall through */
        case 'style': {
            const styleToken = this.styleTokenFromStyle(
                arg === '' ? this.hideStyle : arg
            );
            for ( const node of nodes ) {
                node.setAttribute(styleToken, '');
                this.styledNodes.add(node);
            }
            break;
        }
        case 'remove': {
            for ( const node of nodes ) {
                node.remove();
                node.textContent = '';
            }
            break;
        }
        case 'remove-attr': {
            const reAttr = regexFromString(arg, true);
            for ( const node of nodes ) {
                for ( const name of node.getAttributeNames() ) {
                    if ( reAttr.test(name) === false ) { continue; }
                    node.removeAttribute(name);
                }
            }
            break;
        }
        case 'remove-class': {
            const reClass = regexFromString(arg, true);
            for ( const node of nodes ) {
                const cl = node.classList;
                for ( const name of cl.values() ) {
                    if ( reClass.test(name) === false ) { continue; }
                    cl.remove(name);
                }
            }
            break;
        }
        default:
            break;
        }
    }

    unprocessNodes(nodes) {
        const tokens = Array.from(this.styleTokenMap.values());
        for ( const node of nodes ) {
            if ( this.styledNodes.has(node) ) { continue; }
            for ( const token of tokens ) {
                node.removeAttribute(token);
            }
        }
    }

    uBOL_DOMChanged() {
        if ( this.timer !== undefined ) { return; }
        this.timer = self.requestAnimationFrame(( ) => {
            this.timer = undefined;
            this.uBOL_commit();
        });
    }
}

/******************************************************************************/

self.ProceduralFiltererAPI = class {
    constructor() {
        this.proceduralFilterer = null;
        this.domObserver = null;
    }

    async reset() {
        if ( this.domObserver ) {
            this.domObserver.takeRecords();
            this.domObserver.disconnect();
            this.domObserver = null;
        }
        if ( this.proceduralFilterer ) {
            await this.proceduralFilterer.reset();
            this.proceduralFilterer = null;
        }
    }

    addSelectors(selectors) {
        if ( this.proceduralFilterer === null ) {
            this.proceduralFilterer = new ProceduralFilterer();
        }
        if ( this.domObserver === null ) {
            this.domObserver = new MutationObserver(mutations => {
                this.onDOMChanged(mutations);
            });
            this.domObserver.observe(document, { childList: true, subtree: true });
        }
        this.proceduralFilterer.addSelectors(selectors);
        this.proceduralFilterer.uBOL_commit();
    }

    qsa(selector) {
        const o = JSON.parse(selector);
        const pselector = new PSelectorRoot(null, o);
        return pselector.exec();
    }

    onDOMChanged(mutations) {
        for ( const mutation of mutations ) {
            for ( const added of mutation.addedNodes ) {
                if ( added.nodeType !== 1 ) { continue; }
                return this.proceduralFilterer.uBOL_DOMChanged();
            }
            for ( const removed of mutation.removedNodes ) {
                if ( removed.nodeType !== 1 ) { continue; }
                return this.proceduralFilterer.uBOL_DOMChanged();
            }
        }
    }
};

/******************************************************************************/

})();

void 0;

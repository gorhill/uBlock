/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* global punycode, uDom */

'use strict';

/******************************************************************************/

(( ) => {

/******************************************************************************/

let popupFontSize;
vAPI.localStorage.getItemAsync('popupFontSize').then(value => {
    if ( typeof value !== 'string' || value === 'unset' ) { return; }
    document.body.style.setProperty('font-size', value);
    popupFontSize = value;
});

// https://github.com/gorhill/uBlock/issues/3032
// Popup panel can be in one of two modes:
// - not responsive: viewport is expected to adjust to popup panel size
// - responsive: popup panel must adjust to viewport size -- this happens
//   when the viewport is not resized by the browser to perfectly fits uBO's
//   popup panel.
if (
    vAPI.webextFlavor.soup.has('mobile') ||
    /[\?&]responsive=1/.test(window.location.search)
) {
    document.body.classList.add('responsive');
}

// https://github.com/chrisaljoudi/uBlock/issues/996
//   Experimental: mitigate glitchy popup UI: immediately set the firewall
//   pane visibility to its last known state. By default the pane is hidden.
let dfPaneVisibleStored;
vAPI.localStorage.getItemAsync('popupFirewallPane').then(value => {
    dfPaneVisibleStored = value === true || value === 'true';
    if ( dfPaneVisibleStored ) {
        document.getElementById('panes').classList.add('dfEnabled');
    }
});

/******************************************************************************/

const messaging = vAPI.messaging;
const reIP = /^\d+(?:\.\d+){1,3}$/;
const scopeToSrcHostnameMap = {
    '/': '*',
    '.': ''
};
const hostnameToSortableTokenMap = new Map();
const statsStr = vAPI.i18n('popupBlockedStats');
const domainsHitStr = vAPI.i18n('popupHitDomainCount');

let popupData = {};
let dfPaneBuilt = false;
let dfHotspots = null;
let allHostnameRows = [];
let cachedPopupHash = '';

// https://github.com/gorhill/uBlock/issues/2550
// Solution inspired from
// - https://bugs.chromium.org/p/chromium/issues/detail?id=683314
// - https://bugzilla.mozilla.org/show_bug.cgi?id=1332714#c17
// Confusable character set from:
// - http://unicode.org/cldr/utility/list-unicodeset.jsp?a=%5B%D0%B0%D1%81%D4%81%D0%B5%D2%BB%D1%96%D1%98%D3%8F%D0%BE%D1%80%D4%9B%D1%95%D4%9D%D1%85%D1%83%D1%8A%D0%AC%D2%BD%D0%BF%D0%B3%D1%B5%D1%A1%5D&g=gc&i=
// Linked from:
// - https://www.chromium.org/developers/design-documents/idn-in-google-chrome
const reCyrillicNonAmbiguous = /[\u0400-\u042b\u042d-\u042f\u0431\u0432\u0434\u0436-\u043d\u0442\u0444\u0446-\u0449\u044b-\u0454\u0457\u0459-\u0460\u0462-\u0474\u0476-\u04ba\u04bc\u04be-\u04ce\u04d0-\u0500\u0502-\u051a\u051c\u051e-\u052f]/;
const reCyrillicAmbiguous = /[\u042c\u0430\u0433\u0435\u043e\u043f\u0440\u0441\u0443\u0445\u044a\u0455\u0456\u0458\u0461\u0475\u04bb\u04bd\u04cf\u0501\u051b\u051d]/;

/******************************************************************************/

// The padlock/eraser must be manually positioned:
// - Its vertical position depends on the height of the popup title bar
// - Its horizontal position depends on whether there is a vertical scrollbar.

const positionRulesetTools = function() {
    const vpos = document.getElementById('appinfo')
                         .getBoundingClientRect()
                         .bottom + window.scrollY + 3;
    const hpos = document.getElementById('firewallContainer')
                         .getBoundingClientRect()
                         .left + window.scrollX + 3;
    const style = document.getElementById('rulesetTools').style;
    style.setProperty('top', (vpos >>> 0) + 'px');
    style.setProperty('left', (hpos >>> 0) + 'px');
};

/******************************************************************************/

const cachePopupData = function(data) {
    popupData = {};
    scopeToSrcHostnameMap['.'] = '';
    hostnameToSortableTokenMap.clear();

    if ( typeof data !== 'object' ) {
        return popupData;
    }
    popupData = data;
    popupData.cnameMap = new Map(popupData.cnameMap);
    scopeToSrcHostnameMap['.'] = popupData.pageHostname || '';
    const hostnameDict = popupData.hostnameDict;
    if ( typeof hostnameDict !== 'object' ) {
        return popupData;
    }
    for ( const hostname in hostnameDict ) {
        if ( hostnameDict.hasOwnProperty(hostname) === false ) { continue; }
        let domain = hostnameDict[hostname].domain;
        let prefix = hostname.slice(0, 0 - domain.length - 1);
        // Prefix with space char for 1st-party hostnames: this ensure these
        // will come first in list.
        if ( domain === popupData.pageDomain ) {
            domain = '\u0020';
        }
        hostnameToSortableTokenMap.set(
            hostname,
            domain + ' ' + prefix.split('.').reverse().join('.')
        );
    }
    return popupData;
};

/******************************************************************************/

const hashFromPopupData = function(reset) {
    // It makes no sense to offer to refresh the behind-the-scene scope
    if ( popupData.pageHostname === 'behind-the-scene' ) {
        uDom('body').toggleClass('dirty', false);
        return;
    }

    const hasher = [];
    const rules = popupData.firewallRules;
    for ( const key in rules ) {
        const rule = rules[key];
        if ( rule === null ) { continue; }
        hasher.push(
            rule.src + ' ' +
            rule.des + ' ' +
            rule.type + ' ' +
            rule.action
        );
    }
    hasher.sort();
    hasher.push(uDom('body').hasClass('off'));
    hasher.push(uDom.nodeFromId('no-large-media').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-cosmetic-filtering').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-remote-fonts').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-scripting').classList.contains('on'));

    const hash = hasher.join('');
    if ( reset ) {
        cachedPopupHash = hash;
    }
    uDom('body').toggleClass('dirty', hash !== cachedPopupHash);
};

/******************************************************************************/

const gtz = n => typeof n === 'number' && n > 0;

/******************************************************************************/

const formatNumber = function(count) {
    return typeof count === 'number' ? count.toLocaleString() : '';
};

/******************************************************************************/

const rulekeyCompare = function(a, b) {
    let ha = a;
    if ( !reIP.test(ha) ) {
        ha = hostnameToSortableTokenMap.get(ha) || ' ';
    }
    let hb = b;
    if ( !reIP.test(hb) ) {
        hb = hostnameToSortableTokenMap.get(hb) || ' ';
    }
    const ca = ha.charCodeAt(0);
    const cb = hb.charCodeAt(0);
    if ( ca !== cb ) {
        return ca - cb;
    }
    return ha.localeCompare(hb);
};

/******************************************************************************/

const updateFirewallCellCount = function(cell, allowed, blocked) {
    if ( gtz(allowed) ) {
        cell.setAttribute(
            'data-acount',
            Math.min(Math.ceil(Math.log(allowed + 1) / Math.LN10), 3)
        );
    } else {
        cell.setAttribute('data-acount', '0');
    }
    if ( gtz(blocked) ) {
        cell.setAttribute(
            'data-bcount',
            Math.min(Math.ceil(Math.log(blocked + 1) / Math.LN10), 3)
        );
    } else {
        cell.setAttribute('data-bcount', '0');
    }
};

/******************************************************************************/

const updateFirewallCellRule = function(cell, scope, des, type, ruleParts) {
    if ( cell instanceof HTMLElement === false ) { return; }

    if ( ruleParts === undefined ) {
        cell.removeAttribute('class');
        return;
    }

    const action = updateFirewallCellRule.actionNames[ruleParts[3]];
    cell.setAttribute('class', `${action}Rule`);

    // Use dark shade visual cue if the rule is specific to the cell.
    if (
        (ruleParts[1] !== '*' || ruleParts[2] === type) &&
        (ruleParts[1] === des) &&
        (ruleParts[0] === scopeToSrcHostnameMap[scope])
        
    ) {
        cell.classList.add('ownRule');
    }
};

updateFirewallCellRule.actionNames = { '1': 'block', '2': 'allow', '3': 'noop' };

/******************************************************************************/

const updateFirewallCell = function(row, scope, des, type, doCounts) {
    if ( row instanceof HTMLElement === false ) { return; }

    const cells = row.querySelectorAll(`:scope > span[data-src="${scope}"]`);
    if ( cells.length === 0 ) { return; }

    const rule = popupData.firewallRules[`${scope} ${des} ${type}`];
    const ruleParts = rule !== undefined ? rule.split(' ') : undefined;
    for ( const cell of cells ) {
        updateFirewallCellRule(cell, scope, des, type, ruleParts);
    }

    if ( scope !== '.' || des === '*' ) { return; }
    if ( doCounts !== true ) { return; }

    // Remember this may be a cell from a reused row, we need to clear text
    // content if we can't compute request counts.
    const hnDetails = popupData.hostnameDict[des];
    if ( hnDetails === undefined ) {
        cells.forEach(el => {
            updateFirewallCellCount(el);
        });
        return;
    }

    updateFirewallCellCount(
        cells[0],
        hnDetails.counts.allowed.any,
        hnDetails.counts.blocked.any
    );

    if ( hnDetails.domain !== des || hnDetails.totals === undefined ) {
        updateFirewallCellCount(
            cells[1],
            hnDetails.counts.allowed.any,
            hnDetails.counts.blocked.any
        );
        return;
    }

    updateFirewallCellCount(
        cells[1],
        hnDetails.totals.allowed.any,
        hnDetails.totals.blocked.any
    );
};

/******************************************************************************/

const updateAllFirewallCells = function(doCounts = true) {
    const rows = document.querySelectorAll('#firewallContainer > [data-des][data-type]');

    for ( const row of rows ) {
        const des = row.getAttribute('data-des');
        const type = row.getAttribute('data-type');
        updateFirewallCell(row, '/', des, type, doCounts);
        updateFirewallCell(row, '.', des, type, doCounts);
    }

    const dirty = popupData.matrixIsDirty === true;
    if ( dirty ) {
        positionRulesetTools();
    }
    uDom.nodeFromId('firewallContainer').classList.toggle('dirty', dirty);
};

/******************************************************************************/

// Compute statistics useful only to firewall entries -- we need to call
// this only when overview pane needs to be rendered.

const expandHostnameStats = ( ) => {
    let dnDetails;
    for ( const des of allHostnameRows ) {
        const hnDetails = popupData.hostnameDict[des];
        const { domain, counts } = hnDetails;
        const isDomain = des === domain;
        const { allowed: hnAllowed, blocked: hnBlocked } = counts;
        if ( isDomain ) {
            dnDetails = hnDetails;
            dnDetails.totals = JSON.parse(JSON.stringify(dnDetails.counts));
        } else {
            const { allowed: dnAllowed, blocked: dnBlocked } = dnDetails.totals;
            dnAllowed.any += hnAllowed.any;
            dnBlocked.any += hnBlocked.any;
        }
        hnDetails.hasScript = hnAllowed.script !== 0 || hnBlocked.script !== 0;
        dnDetails.hasScript = dnDetails.hasScript || hnDetails.hasScript;
        hnDetails.hasFrame = hnAllowed.frame !== 0 || hnBlocked.frame !== 0;
        dnDetails.hasFrame = dnDetails.hasFrame || hnDetails.hasFrame;
    }
};

/******************************************************************************/

const buildAllFirewallRows = function() {
    // Do this before removing the rows
    if ( dfHotspots === null ) {
        dfHotspots =
            uDom('#actionSelector').on('click', 'span', setFirewallRuleHandler);
    }
    dfHotspots.remove();

    // This must be called before we create the rows.
    expandHostnameStats();

    // Update incrementally: reuse existing rows if possible.
    const rowContainer = document.getElementById('firewallContainer');
    const toAppend = document.createDocumentFragment();
    const rowTemplate = document.querySelector('#templates > div:nth-of-type(1)');
    let row = rowContainer.querySelector('div:nth-of-type(7) + div');

    for ( const des of allHostnameRows ) {
        if ( row === null ) {
            row = rowTemplate.cloneNode(true);
            toAppend.appendChild(row);
        }

        row.setAttribute('data-des', des);

        const hnDetails = popupData.hostnameDict[des] || {};
        const isDomain = des === hnDetails.domain;
        const prettyDomainName = punycode.toUnicode(des);
        const isPunycoded = prettyDomainName !== des;

        const { allowed: hnAllowed, blocked: hnBlocked } = hnDetails.counts;

        const span = row.querySelector('span:first-of-type');
        span.querySelector('span').textContent = prettyDomainName;

        const classList = row.classList;

        let desExtra = '';
        if ( classList.toggle('isCname', popupData.cnameMap.has(des)) ) {
            desExtra = punycode.toUnicode(popupData.cnameMap.get(des));
        } else if (
            isDomain && isPunycoded &&
            reCyrillicAmbiguous.test(prettyDomainName) === true &&
            reCyrillicNonAmbiguous.test(prettyDomainName) === false
        ) {
            desExtra = des;
        }
        span.querySelector('sub').textContent = desExtra;

        classList.toggle('isRootContext', des === popupData.pageHostname);
        classList.toggle('isDomain', isDomain);
        classList.toggle('isSubDomain', !isDomain);
        classList.toggle('allowed', gtz(hnAllowed.any));
        classList.toggle('blocked', gtz(hnBlocked.any));
        classList.toggle('expandException', expandExceptions.has(hnDetails.domain));

        const { totals } = hnDetails;
        classList.toggle('totalAllowed', gtz(totals && totals.allowed.any));
        classList.toggle('totalBlocked', gtz(totals && totals.blocked.any));

        row = row.nextElementSibling;
    }

    // Remove unused trailing rows
    if ( row !== null ) {
        while ( row.nextElementSibling !== null ) {
            rowContainer.removeChild(row.nextElementSibling);
        }
        rowContainer.removeChild(row);
    }

    // Add new rows all at once
    if ( toAppend.childElementCount !== 0 ) {
        rowContainer.appendChild(toAppend);
    }

    if ( dfPaneBuilt !== true && popupData.advancedUserEnabled ) {
        uDom('#firewallContainer')
            .on('click', 'span[data-src]', unsetFirewallRuleHandler)
            .on('mouseenter', '[data-src]', mouseenterCellHandler)
            .on('mouseleave', '[data-src]', mouseleaveCellHandler);
        dfPaneBuilt = true;
    }

    updateAllFirewallCells();
};

/******************************************************************************/

const renderPrivacyExposure = function() {
    const allDomains = {};
    let allDomainCount = 0;
    let touchedDomainCount = 0;

    allHostnameRows = [];

    // Sort hostnames. First-party hostnames must always appear at the top
    // of the list.
    const desHostnameDone = {};
    const keys = Object.keys(popupData.hostnameDict)
                       .sort(rulekeyCompare);
    for ( const des of keys ) {
        // Specific-type rules -- these are built-in
        if ( des === '*' || desHostnameDone.hasOwnProperty(des) ) { continue; }
        const hnDetails = popupData.hostnameDict[des];
        const { domain, counts } = hnDetails;
        if ( allDomains.hasOwnProperty(domain) === false ) {
            allDomains[domain] = false;
            allDomainCount += 1;
        }
        if ( gtz(counts.allowed.any) ) {
            if ( allDomains[domain] === false ) {
                allDomains[domain] = true;
                touchedDomainCount += 1;
            }
        }
        allHostnameRows.push(des);
        desHostnameDone[des] = true;
    }

    const summary = domainsHitStr
                    .replace('{{count}}', touchedDomainCount.toLocaleString())
                    .replace('{{total}}', allDomainCount.toLocaleString());
    uDom.nodeFromId('popupHitDomainCount').textContent = summary;
};

/******************************************************************************/

const updateHnSwitches = function() {
    uDom.nodeFromId('no-popups').classList.toggle(
        'on',
        popupData.noPopups === true
    );
    uDom.nodeFromId('no-large-media').classList.toggle(
        'on', popupData.noLargeMedia === true
    );
    uDom.nodeFromId('no-cosmetic-filtering').classList.toggle(
        'on',
        popupData.noCosmeticFiltering === true
    );
    uDom.nodeFromId('no-remote-fonts').classList.toggle(
        'on',
        popupData.noRemoteFonts === true
    );
    uDom.nodeFromId('no-scripting').classList.toggle(
        'on',
        popupData.noScripting === true
    );
};

/******************************************************************************/

// Assume everything has to be done incrementally.

const renderPopup = function() {
    if ( popupData.tabTitle ) {
        document.title = popupData.appName + ' - ' + popupData.tabTitle;
    }

    let elem = document.body;
    elem.classList.toggle(
        'advancedUser',
        popupData.advancedUserEnabled === true
    );
    elem.classList.toggle(
        'off',
        popupData.pageURL === '' || popupData.netFilteringSwitch !== true
    );

    const canElementPicker = popupData.canElementPicker === true &&
                           popupData.netFilteringSwitch === true;
    uDom.nodeFromId('gotoPick').classList.toggle('enabled', canElementPicker);
    uDom.nodeFromId('gotoZap').classList.toggle('enabled', canElementPicker);

    let blocked, total;
    if ( popupData.pageCounts !== undefined ) {
        const counts = popupData.pageCounts;
        blocked = counts.blocked.any;
        total = blocked + counts.allowed.any;
    } else {
        blocked = 0;
        total = 0;
    }
    let text;
    if ( total === 0 ) {
        text = formatNumber(0);
    } else {
        text = statsStr.replace('{{count}}', formatNumber(blocked))
                       .replace('{{percent}}', formatNumber(Math.floor(blocked * 100 / total)));
    }
    uDom.nodeFromId('page-blocked').textContent = text;

    blocked = popupData.globalBlockedRequestCount;
    total = popupData.globalAllowedRequestCount + blocked;
    if ( total === 0 ) {
        text = formatNumber(0);
    } else {
        text = statsStr.replace('{{count}}', formatNumber(blocked))
                       .replace('{{percent}}', formatNumber(Math.floor(blocked * 100 / total)));
    }
    uDom.nodeFromId('total-blocked').textContent = text;

    // This will collate all domains, touched or not
    renderPrivacyExposure();

    // Extra tools
    updateHnSwitches();

    // Report blocked popup count on badge
    total = popupData.popupBlockedCount;
    uDom.nodeFromSelector('#no-popups > span.fa-icon-badge')
        .textContent = total ? Math.min(total, 99).toLocaleString() : '';

    // Report large media count on badge
    total = popupData.largeMediaCount;
    uDom.nodeFromSelector('#no-large-media > span.fa-icon-badge')
        .textContent = total ? Math.min(total, 99).toLocaleString() : '';

    // Report remote font count on badge
    total = popupData.remoteFontCount;
    uDom.nodeFromSelector('#no-remote-fonts > span.fa-icon-badge')
        .textContent = total ? Math.min(total, 99).toLocaleString() : '';

    // https://github.com/chrisaljoudi/uBlock/issues/470
    // This must be done here, to be sure the popup is resized properly
    const dfPaneVisible = (popupData.popupPanelSections & 0b10000) !== 0;

    // https://github.com/chrisaljoudi/uBlock/issues/1068
    // Remember the last state of the firewall pane. This allows to
    // configure the popup size early next time it is opened, which means a
    // less glitchy popup at open time.
    if ( dfPaneVisible !== dfPaneVisibleStored ) {
        dfPaneVisibleStored = dfPaneVisible;
        vAPI.localStorage.setItem('popupFirewallPane', dfPaneVisibleStored);
    }

    uDom.nodeFromId('panes').classList.toggle('dfEnabled', dfPaneVisible === true);

    document.documentElement.classList.toggle(
        'colorBlind',
        popupData.colorBlindFriendly === true
    );

    setGlobalExpand(popupData.firewallPaneMinimized === false, true);

    // Build dynamic filtering pane only if in use
    if ( dfPaneVisible ) {
        buildAllFirewallRows();
    }

    renderTooltips();
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2889
//   Use tooltip for ARIA purpose.

const renderTooltips = function(selector) {
    for ( const entry of tooltipTargetSelectors ) {
        if ( selector !== undefined && entry[0] !== selector ) { continue; }
        const text = vAPI.i18n(
            entry[1].i18n +
            (uDom.nodeFromSelector(entry[1].state) === null ? '1' : '2')
        );
        const elem = uDom.nodeFromSelector(entry[0]);
        elem.setAttribute('aria-label', text);
        elem.setAttribute('data-tip', text);
        if ( selector !== undefined ) {
            uDom.nodeFromId('tooltip').textContent =
                elem.getAttribute('data-tip');
        }
    }
};

const tooltipTargetSelectors = new Map([
    [
        '#switch',
        {
            state: 'body.off',
            i18n: 'popupPowerSwitchInfo',
        }
    ],
    [
        '#no-popups',
        {
            state: '#no-popups.on',
            i18n: 'popupTipNoPopups'
        }
    ],
    [
        '#no-large-media',
        {
            state: '#no-large-media.on',
            i18n: 'popupTipNoLargeMedia'
        }
    ],
    [
        '#no-cosmetic-filtering',
        {
            state: '#no-cosmetic-filtering.on',
            i18n: 'popupTipNoCosmeticFiltering'
        }
    ],
    [
        '#no-remote-fonts',
        {
            state: '#no-remote-fonts.on',
            i18n: 'popupTipNoRemoteFonts'
        }
    ],
    [
        '#no-scripting',
        {
            state: '#no-scripting.on',
            i18n: 'popupTipNoScripting'
        }
    ],
]);

/******************************************************************************/

// All rendering code which need to be executed only once.

let renderOnce = function() {
    renderOnce = function(){};

    if ( popupData.fontSize !== popupFontSize ) {
        popupFontSize = popupData.fontSize;
        if ( popupFontSize !== 'unset' ) {
            document.body.style.setProperty('font-size', popupFontSize);
            vAPI.localStorage.setItem('popupFontSize', popupFontSize);
        } else {
            document.body.style.removeProperty('font-size');
            vAPI.localStorage.removeItem('popupFontSize');
        }
    }

    uDom.nodeFromId('appname').textContent = popupData.appName;
    uDom.nodeFromId('version').textContent = popupData.appVersion;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/22
    if ( popupData.advancedUserEnabled !== true ) {
        uDom('#firewallContainer [data-i18n-tip][data-src]').removeAttr('data-tip');
    }

    // https://github.com/gorhill/uBlock/issues/2274
    //   Make use of the whole viewport when in responsive mode.
    if ( document.body.classList.contains('responsive') ) { return; }

    // For large displays: we do not want the left pane -- optional and
    // hidden by defaut -- to dictate the height of the popup. The right pane
    // dictates the height of the popup, and the left pane will have a
    // scrollbar if ever its height is more than what is available.
    // For small displays: we use the whole viewport.

    const rpane = uDom.nodeFromSelector('#panes > div:first-of-type');
    const lpane = uDom.nodeFromSelector('#panes > div:last-of-type');

    lpane.style.setProperty('height', rpane.offsetHeight + 'px');

    // Be prepared to fall into responsive mode if ever it is found the
    // viewport is not a perfect match for the popup panel.

    let resizeTimer;
    const resize = function() {
        resizeTimer = undefined;
        // Do not use equality, fractional pixel dimension occurs and must
        // be ignored.
        // https://www.reddit.com/r/uBlockOrigin/comments/8qodpw/how_to_hide_the_info_shown_of_what_is_currently/e0lglrr/
        //   Tolerance of 2px fixes the issue.
        if (
            Math.abs(document.body.offsetWidth - window.innerWidth) <= 2 &&
            Math.abs(document.body.offsetHeight - window.innerHeight) <= 2
        ) {
            return;
        }
        document.body.classList.add('responsive');
        lpane.style.removeProperty('height');
        window.removeEventListener('resize', resizeAsync);
    };
    const resizeAsync = function() {
        if ( resizeTimer !== undefined ) {
            clearTimeout(resizeTimer);
        }
        resizeTimer = vAPI.setTimeout(resize, 67);
    };
    window.addEventListener('resize', resizeAsync);
    resizeAsync();
};

/******************************************************************************/

const renderPopupLazy = (( ) => {
    let mustRenderCosmeticFilteringBadge = true;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/756
    //   Launch potentially expensive hidden elements-counting scriptlet on
    //   demand only.
    {
        const sw = uDom.nodeFromId('no-cosmetic-filtering');
        const badge = sw.querySelector(':scope > span.fa-icon-badge');
        badge.textContent = '\u22EF';

        const render = ( ) => {
            if ( mustRenderCosmeticFilteringBadge === false ) { return; }
            mustRenderCosmeticFilteringBadge = false;
            if ( sw.classList.contains('hnSwitchBusy') ) { return; }
            sw.classList.add('hnSwitchBusy');
            messaging.send('popupPanel', {
                what: 'getHiddenElementCount',
                tabId: popupData.tabId,
            }).then(count => {
                let text;
                if ( (count || 0) === 0 ) {
                    text = '';
                } else if ( count === -1 ) {
                    text = '?';
                } else {
                    text = Math.min(count, 99).toLocaleString();
                }
                badge.textContent = text;
                sw.classList.remove('hnSwitchBusy');
            });
        };

        sw.addEventListener('mouseenter', render, { passive: true });
    }

    return async function() {
        const count = await messaging.send('popupPanel', {
            what: 'getScriptCount',
            tabId: popupData.tabId,
        });
        uDom.nodeFromSelector('#no-scripting > span.fa-icon-badge')
            .textContent = (count || 0) !== 0
                ? Math.min(count, 99).toLocaleString()
                : '';
        mustRenderCosmeticFilteringBadge = true;
    };
})();

/******************************************************************************/

const toggleNetFilteringSwitch = function(ev) {
    if ( !popupData || !popupData.pageURL ) { return; }
    messaging.send('popupPanel', {
        what: 'toggleNetFiltering',
        url: popupData.pageURL,
        scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
        state: !uDom('body').toggleClass('off').hasClass('off'),
        tabId: popupData.tabId,
    });
    renderTooltips('#switch');
    hashFromPopupData();
};

/******************************************************************************/

const gotoZap = function() {
    messaging.send('popupPanel', {
        what: 'launchElementPicker',
        tabId: popupData.tabId,
        zap: true,
    });

    vAPI.closePopup();
};

/******************************************************************************/

const gotoPick = function() {
    messaging.send('popupPanel', {
        what: 'launchElementPicker',
        tabId: popupData.tabId,
    });

    vAPI.closePopup();
};

/******************************************************************************/

const gotoURL = function(ev) {
    if ( this.hasAttribute('href') === false ) { return; }

    ev.preventDefault();

    let url = this.getAttribute('href');
    if (
        url === 'logger-ui.html#_' &&
        typeof popupData.tabId === 'number'
    ) {
        url += '+' + popupData.tabId;
    }

    messaging.send('popupPanel', {
        what: 'gotoURL',
        details: {
            url: url,
            select: true,
            index: -1,
            shiftKey: ev.shiftKey
        },
    });

    vAPI.closePopup();
};

/******************************************************************************/

const toggleFirewallPane = function() {
    popupData.popupPanelSections = popupData.popupPanelSections ^ 0b10000;

    messaging.send('popupPanel', {
        what: 'userSettings',
        name: 'popupPanelSections',
        value: popupData.popupPanelSections | 0b01111,
    });

    // https://github.com/chrisaljoudi/uBlock/issues/996
    // Remember the last state of the firewall pane. This allows to
    // configure the popup size early next time it is opened, which means a
    // less glitchy popup at open time.
    dfPaneVisibleStored = (popupData.popupPanelSections & 0b10000) !== 0;
    vAPI.localStorage.setItem('popupFirewallPane', dfPaneVisibleStored);

    // Dynamic filtering pane may not have been built yet
    uDom.nodeFromId('panes').classList.toggle('dfEnabled', dfPaneVisibleStored);
    if ( dfPaneVisibleStored && dfPaneBuilt === false ) {
        buildAllFirewallRows();
    }
};

/******************************************************************************/

const mouseenterCellHandler = function() {
    if ( uDom(this).hasClass('ownRule') === false ) {
        dfHotspots.appendTo(this);
    }
};

const mouseleaveCellHandler = function() {
    dfHotspots.remove();
};

/******************************************************************************/

const setFirewallRule = async function(src, des, type, action, persist) {
    // This can happen on pages where uBlock does not work
    if (
        typeof popupData.pageHostname !== 'string' ||
        popupData.pageHostname === ''
    ) {
        return;
    }

    const response = await messaging.send('popupPanel', {
        what: 'toggleFirewallRule',
        tabId: popupData.tabId,
        pageHostname: popupData.pageHostname,
        srcHostname: src,
        desHostname: des,
        requestType: type,
        action: action,
        persist: persist,
    });

    // Remove action widget if an own rule has been set, this allows to click
    // again immediately to remove the rule.
    if ( action !== 0 ) {
        dfHotspots.remove();
    }

    cachePopupData(response);
    updateAllFirewallCells(false);
    hashFromPopupData();
};

/******************************************************************************/

const unsetFirewallRuleHandler = function(ev) {
    const cell = ev.target;
    const row = cell.closest('[data-des]');
    setFirewallRule(
        cell.getAttribute('data-src') === '/' ? '*' : popupData.pageHostname,
        row.getAttribute('data-des'),
        row.getAttribute('data-type'),
        0,
        ev.ctrlKey || ev.metaKey
    );
    dfHotspots.appendTo(cell);
};

/******************************************************************************/

const setFirewallRuleHandler = function(ev) {
    const hotspot = ev.target;
    const cell = hotspot.closest('[data-src]');
    if ( cell === null ) { return; }
    const row = cell.closest('[data-des]');
    let action = 0;
    if ( hotspot.id === 'dynaAllow' ) {
        action = 2;
    } else if ( hotspot.id === 'dynaNoop' ) {
        action = 3;
    } else {
        action = 1;
    }
    setFirewallRule(
        cell.getAttribute('data-src') === '/' ? '*' : popupData.pageHostname,
        row.getAttribute('data-des'),
        row.getAttribute('data-type'),
        action,
        ev.ctrlKey || ev.metaKey
    );
    dfHotspots.remove();
};

/******************************************************************************/

const reloadTab = function(ev) {
    messaging.send('popupPanel', {
        what: 'reloadTab',
        tabId: popupData.tabId,
        select: vAPI.webextFlavor.soup.has('mobile'),
        bypassCache: ev.ctrlKey || ev.metaKey || ev.shiftKey,
    });

    // Polling will take care of refreshing the popup content
    // https://github.com/chrisaljoudi/uBlock/issues/748
    //   User forces a reload, assume the popup has to be updated regardless
    //   if there were changes or not.
    popupData.contentLastModified = -1;

    // No need to wait to remove this.
    uDom('body').toggleClass('dirty', false);
};

uDom('#refresh').on('click', reloadTab);

// https://github.com/uBlockOrigin/uBlock-issues/issues/672
document.addEventListener(
    'keydown',
    ev => {
        if ( ev.code !== 'F5' ) { return; }
        reloadTab(ev);
        ev.preventDefault();
        ev.stopPropagation();
    },
    { capture: true }
);

/******************************************************************************/

const expandExceptions = new Set();

vAPI.localStorage.getItemAsync('popupExpandExceptions').then(exceptions => {
    try {
        if ( Array.isArray(exceptions) === false ) { return; }
        for ( const exception of exceptions ) {
            expandExceptions.add(exception);
        }
    }
    catch(ex) {
    }
});

const saveExpandExceptions = function() {
    vAPI.localStorage.setItem(
        'popupExpandExceptions',
        Array.from(expandExceptions)
    );
};

const setGlobalExpand = function(state, internal = false) {
    uDom('.expandException').removeClass('expandException');
    if ( state ) {
        uDom('#firewallContainer').addClass('expanded');
    } else {
        uDom('#firewallContainer').removeClass('expanded');
    }
    positionRulesetTools();
    if ( internal ) { return; }
    popupData.firewallPaneMinimized = !state;
    expandExceptions.clear();
    saveExpandExceptions();
    messaging.send('popupPanel', {
        what: 'userSettings',
        name: 'firewallPaneMinimized',
        value: popupData.firewallPaneMinimized,
    });
};

const setSpecificExpand = function(domain, state, internal = false) {
    const unodes = uDom(`[data-des="${domain}"],[data-des$=".${domain}"]`);
    if ( state ) {
        unodes.addClass('expandException');
    } else {
        unodes.removeClass('expandException');
    }
    if ( internal ) { return; }
    if ( state ) {
        expandExceptions.add(domain);
    } else {
        expandExceptions.delete(domain);
    }
    saveExpandExceptions();
};

uDom('[data-i18n="popupAnyRulePrompt"]').on('click', ev => {
    // Special display mode: in its own tab/window, with no vertical restraint.
    // Useful to take snapshots of the whole list of domains -- example:
    //   https://github.com/gorhill/uBlock/issues/736#issuecomment-178879944
    if ( ev.shiftKey && ev.ctrlKey ) {
        messaging.send('popupPanel', {
            what: 'gotoURL',
            details: {
                url: `popup.html?tabId=${popupData.tabId}&responsive=1`,
                select: true,
                index: -1,
            },
        });
        vAPI.closePopup();
        return;
    }

    setGlobalExpand(
        uDom('#firewallContainer').hasClass('expanded') === false
    );
});

uDom('#firewallContainer').on(
    'click', '.isDomain[data-type="*"] > span:first-of-type',
    ev => {
        const div = ev.target.closest('[data-des]');
        if ( div === null ) { return; }
        setSpecificExpand(
            div.getAttribute('data-des'),
            div.classList.contains('expandException') === false
        );
    }
);

/******************************************************************************/

const saveFirewallRules = function() {
    messaging.send('popupPanel', {
        what: 'saveFirewallRules',
        srcHostname: popupData.pageHostname,
        desHostnames: popupData.hostnameDict,
    });
    uDom.nodeFromId('firewallContainer').classList.remove('dirty');
};

/******************************************************************************/

const revertFirewallRules = async function() {
    uDom.nodeFromId('firewallContainer').classList.remove('dirty');
    const response = await messaging.send('popupPanel', {
        what: 'revertFirewallRules',
        srcHostname: popupData.pageHostname,
        desHostnames: popupData.hostnameDict,
        tabId: popupData.tabId,
    });
    cachePopupData(response);
    updateAllFirewallCells(false);
    updateHnSwitches();
    hashFromPopupData();
};

/******************************************************************************/

const toggleHostnameSwitch = async function(ev) {
    const target = ev.currentTarget;
    const switchName = target.getAttribute('id');
    if ( !switchName ) { return; }
    // For touch displays, process click only if the switch is not "busy".
    if (
        vAPI.webextFlavor.soup.has('mobile') &&
        target.classList.contains('hnSwitchBusy')
    ) {
        return;
    }
    target.classList.toggle('on');
    renderTooltips('#' + switchName);

    const response = await messaging.send('popupPanel', {
        what: 'toggleHostnameSwitch',
        name: switchName,
        hostname: popupData.pageHostname,
        state: target.classList.contains('on'),
        tabId: popupData.tabId,
        persist: (popupData.popupPanelSections & 0b10000) === 0 || ev.ctrlKey || ev.metaKey,
    });

    cachePopupData(response);
    hashFromPopupData();

    document.body.classList.toggle('needSave', popupData.matrixIsDirty === true);
};

/******************************************************************************/

// Poll for changes.
//
// I couldn't find a better way to be notified of changes which can affect
// popup content, as the messaging API doesn't support firing events accurately
// from the main extension process to a specific auxiliary extension process:
//
// - broadcasting() is not an option given there could be a lot of tabs opened,
//   and maybe even many frames within these tabs, i.e. unacceptable overhead
//   regardless of whether the popup is opened or not.
//
// - Modifying the messaging API is not an option, as this would require
//   revisiting all platform-specific code to support targeted broadcasting,
//   which who knows could be not so trivial for some platforms.
//
// A well done polling is a better anyways IMO, I prefer that data is pulled
// on demand rather than forcing the main process to assume a client may need
// it and thus having to push it all the time unconditionally.

const pollForContentChange = (( ) => {
    let pollTimer;

    const pollCallback = async function() {
        pollTimer = undefined;
        const response = await messaging.send('popupPanel', {
            what: 'hasPopupContentChanged',
            tabId: popupData.tabId,
            contentLastModified: popupData.contentLastModified,
        });
        queryCallback(response);
    };

    const queryCallback = function(response) {
        if ( response ) {
            getPopupData(popupData.tabId);
            return;
        }
        poll();
    };

    const poll = function() {
        if ( pollTimer !== undefined ) { return; }
        pollTimer = vAPI.setTimeout(pollCallback, 1500);
    };

    return poll;
})();

/******************************************************************************/

const getPopupData = async function(tabId) {
    const response = await messaging.send('popupPanel', {
        what: 'getPopupData',
        tabId,
    });

    cachePopupData(response);
    renderOnce();
    renderPopup();
    renderPopupLazy(); // low priority rendering
    hashFromPopupData(true);
    pollForContentChange();
};

/******************************************************************************/

const onShowTooltip = function(ev) {
    if ( popupData.tooltipsDisabled ) { return; }

    const target = ev.target;

    // Tooltip container
    const ttc = uDom(target).ancestors('.tooltipContainer').nodeAt(0) ||
                document.body;
    const ttcRect = ttc.getBoundingClientRect();

    // Tooltip itself
    const tip = uDom.nodeFromId('tooltip');
    tip.textContent = target.getAttribute('data-tip');
    tip.style.removeProperty('top');
    tip.style.removeProperty('bottom');
    ttc.appendChild(tip);

    // Target rect
    const targetRect = target.getBoundingClientRect();

    // Default is "over"
    let pos;
    if ( target.getAttribute('data-tip-position') !== 'under' ) {
        pos = ttcRect.height - targetRect.top + ttcRect.top;
        tip.style.setProperty('bottom', pos + 'px');
    } else {
        pos = targetRect.bottom - ttcRect.top;
        tip.style.setProperty('top', pos + 'px');
    }

    tip.classList.add('show');
};

const onHideTooltip = function() {
    uDom.nodeFromId('tooltip').classList.remove('show');
};

/******************************************************************************/

// Popup DOM is assumed to be loaded at this point -- because this script
// is loaded after everything else..

(( ) => {
    // If there's no tab id specified in the query string,
    // it will default to current tab.
    let tabId = null;

    // Extract the tab id of the page this popup is for
    const matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        tabId = parseInt(matches[1], 10) || 0;
    }
    getPopupData(tabId);
})();

uDom('#switch').on('click', toggleNetFilteringSwitch);
uDom('#gotoZap').on('click', gotoZap);
uDom('#gotoPick').on('click', gotoPick);
uDom('h2').on('click', toggleFirewallPane);
uDom('.hnSwitch').on('click', ev => { toggleHostnameSwitch(ev); });
uDom('#saveRules').on('click', saveFirewallRules);
uDom('#revertRules').on('click', ( ) => { revertFirewallRules(); });

uDom('body').on('mouseenter', '[data-tip]', onShowTooltip)
            .on('mouseleave', '[data-tip]', onHideTooltip);

uDom('a[href]').on('click', gotoURL);

/******************************************************************************/

})();

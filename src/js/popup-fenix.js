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

/* global uDom */

'use strict';

import punycode from '../lib/punycode.js';

/******************************************************************************/

{
// >>>>> start of local scope

/******************************************************************************/


let popupFontSize = 'unset';
vAPI.localStorage.getItemAsync('popupFontSize').then(value => {
    if ( typeof value !== 'string' || value === 'unset' ) { return; }
    document.body.style.setProperty('--font-size', value);
    popupFontSize = value;
});

// https://github.com/chrisaljoudi/uBlock/issues/996
//   Experimental: mitigate glitchy popup UI: immediately set the firewall
//   pane visibility to its last known state. By default the pane is hidden.
vAPI.localStorage.getItemAsync('popupPanelSections').then(bits => {
    if ( typeof bits !== 'number' ) { return; }
    sectionBitsToAttribute(bits);
});

/******************************************************************************/

const messaging = vAPI.messaging;
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
const allHostnameRows = [];
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

const hashFromPopupData = function(reset = false) {
    // It makes no sense to offer to refresh the behind-the-scene scope
    if ( popupData.pageHostname === 'behind-the-scene' ) {
        document.body.classList.remove('needReload');
        return;
    }

    const hasher = [];
    const rules = popupData.firewallRules;
    for ( const key in rules ) {
        const rule = rules[key];
        if ( rule === undefined ) { continue; }
        hasher.push(rule);
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
    document.body.classList.toggle('needReload', hash !== cachedPopupHash);
};

/******************************************************************************/

// greater-than-zero test

const gtz = n => typeof n === 'number' && n > 0;

/******************************************************************************/

const formatNumber = function(count) {
    if ( typeof count !== 'number' ) { return ''; }
    if ( count < 1e6 ) { return count.toLocaleString(); }

    if (
        intlNumberFormat === undefined &&
        Intl.NumberFormat instanceof Function
    ) {
        const intl = new Intl.NumberFormat(undefined, {
            notation: 'compact',
            maximumSignificantDigits: 4
        });
        if (
            intl.resolvedOptions instanceof Function &&
            intl.resolvedOptions().hasOwnProperty('notation')
        ) {
            intlNumberFormat = intl;
        }
    }

    if ( intlNumberFormat ) {
        return intlNumberFormat.format(count);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1027#issuecomment-629696676
    //   For platforms which do not support proper number formatting, use
    //   a poor's man compact form, which unfortunately is not i18n-friendly.
    count /= 1000000;
    if ( count >= 100 ) {
      count = Math.floor(count * 10) / 10;
    } else if ( count > 10 ) {
      count = Math.floor(count * 100) / 100;
    } else {
      count = Math.floor(count * 1000) / 1000;
    }
    return (count).toLocaleString(undefined) + '\u2009M';
};

let intlNumberFormat;

/******************************************************************************/

const safePunycodeToUnicode = function(hn) {
    const pretty = punycode.toUnicode(hn);
    return pretty === hn ||
           reCyrillicAmbiguous.test(pretty) === false ||
           reCyrillicNonAmbiguous.test(pretty)
        ? pretty
        : hn;
};

/******************************************************************************/

const updateFirewallCellCount = function(cells, allowed, blocked) {
    for ( const cell of cells ) {
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
    }
};

/******************************************************************************/

const updateFirewallCellRule = function(cells, scope, des, type, rule) {
    const ruleParts = rule !== undefined ? rule.split(' ') : undefined;

    for ( const cell of cells ) {
        if ( ruleParts === undefined ) {
            cell.removeAttribute('class');
            continue;
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
    }
};

updateFirewallCellRule.actionNames = { '1': 'block', '2': 'allow', '3': 'noop' };

/******************************************************************************/

const updateAllFirewallCells = function(doRules = true, doCounts = true) {
    const { pageDomain } = popupData;
    const rowContainer = document.getElementById('firewall');
    const rows = rowContainer.querySelectorAll('#firewall > [data-des][data-type]');

    let a1pScript = 0, b1pScript = 0;
    let a3pScript = 0, b3pScript = 0;
    let a3pFrame = 0, b3pFrame = 0;

    for ( const row of rows ) {
        const des = row.getAttribute('data-des');
        const type = row.getAttribute('data-type');
        if ( doRules ) {
            updateFirewallCellRule(
                row.querySelectorAll(`:scope > span[data-src="/"]`),
                '/',
                des,
                type,
                popupData.firewallRules[`/ ${des} ${type}`]
            );
        }
        const cells = row.querySelectorAll(`:scope > span[data-src="."]`);
        if ( doRules ) {
            updateFirewallCellRule(
                cells,
                '.',
                des,
                type,
                popupData.firewallRules[`. ${des} ${type}`]
            );
        }
        if ( des === '*' || type !== '*' ) { continue; }
        if ( doCounts === false ) { continue; }
        const hnDetails = popupData.hostnameDict[des];
        if ( hnDetails === undefined ) {
            updateFirewallCellCount(cells);
            continue;
        }
        const { allowed, blocked } = hnDetails.counts;
        updateFirewallCellCount([ cells[0] ], allowed.any, blocked.any);
        const { totals } = hnDetails;
        if ( totals !== undefined ) {
            updateFirewallCellCount([ cells[1] ], totals.allowed.any, totals.blocked.any);
        }
        if ( hnDetails.domain === pageDomain ) {
            a1pScript += allowed.script; b1pScript += blocked.script;
        } else {
            a3pScript += allowed.script; b3pScript += blocked.script;
            a3pFrame += allowed.frame; b3pFrame += blocked.frame;
        }
    }

    if ( doCounts ) {
        const fromType = type =>
            document.querySelectorAll(
                `#firewall > [data-des="*"][data-type="${type}"] > [data-src="."]`
            );
        updateFirewallCellCount(fromType('1p-script'), a1pScript, b1pScript);
        updateFirewallCellCount(fromType('3p-script'), a3pScript, b3pScript);
        rowContainer.classList.toggle('has3pScript', a3pScript !== 0 || b3pScript !== 0);
        updateFirewallCellCount(fromType('3p-frame'), a3pFrame, b3pFrame);
        rowContainer.classList.toggle('has3pFrame', a3pFrame !== 0 || b3pFrame !== 0);
    }

    document.body.classList.toggle('needSave', popupData.matrixIsDirty === true);
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
        dfHotspots = uDom.nodeFromId('actionSelector');
        dfHotspots.addEventListener('click', setFirewallRuleHandler);
    }
    dfHotspots.remove();

    // This must be called before we create the rows.
    expandHostnameStats();

    // Update incrementally: reuse existing rows if possible.
    const rowContainer = document.getElementById('firewall');
    const toAppend = document.createDocumentFragment();
    const rowTemplate = document.querySelector(
        '#templates > div[data-des=""][data-type="*"]'
    );
    const { cnameMap, hostnameDict, pageDomain, pageHostname } = popupData;

    let row = rowContainer.querySelector(
        'div[data-des="*"][data-type="3p-frame"] + div'
    );

    for ( const des of allHostnameRows ) {
        if ( row === null ) {
            row = rowTemplate.cloneNode(true);
            toAppend.appendChild(row);
        }
        row.setAttribute('data-des', des);

        const hnDetails = hostnameDict[des] || {};
        const isDomain = des === hnDetails.domain;
        const prettyDomainName = des.includes('xn--')
            ? punycode.toUnicode(des)
            : des;
        const isPunycoded = prettyDomainName !== des;

        if ( isDomain && row.childElementCount < 4 ) {
            row.append(row.children[2].cloneNode(true));
        } else if ( isDomain === false && row.childElementCount === 4 ) {
            row.children[3].remove();
        }

        const span = row.querySelector('span:first-of-type');
        span.querySelector(':scope > span > span').textContent = prettyDomainName;

        const classList = row.classList;

        let desExtra = '';
        if ( classList.toggle('isCname', cnameMap.has(des)) ) {
            desExtra = punycode.toUnicode(cnameMap.get(des));
        } else if (
            isDomain && isPunycoded &&
            reCyrillicAmbiguous.test(prettyDomainName) &&
            reCyrillicNonAmbiguous.test(prettyDomainName) === false
        ) {
            desExtra = des;
        }
        span.querySelector('sub').textContent = desExtra;

        classList.toggle('isRootContext', des === pageHostname);
        classList.toggle('is3p', hnDetails.domain !== pageDomain);
        classList.toggle('isDomain', isDomain);
        classList.toggle('hasSubdomains', isDomain && hnDetails.hasSubdomains);
        classList.toggle('isSubdomain', !isDomain);
        const { counts } = hnDetails;
        classList.toggle('allowed', gtz(counts.allowed.any));
        classList.toggle('blocked', gtz(counts.blocked.any));
        const { totals } = hnDetails;
        classList.toggle('totalAllowed', gtz(totals && totals.allowed.any));
        classList.toggle('totalBlocked', gtz(totals && totals.blocked.any));
        classList.toggle('hasScript', hnDetails.hasScript === true);
        classList.toggle('hasFrame', hnDetails.hasFrame === true);
        classList.toggle('expandException', expandExceptions.has(hnDetails.domain));

        row = row.nextElementSibling;
    }

    // Remove unused trailing rows
    if ( row !== null ) {
        while ( row.nextElementSibling !== null ) {
            row.nextElementSibling.remove();
        }
        row.remove();
    }

    // Add new rows all at once
    if ( toAppend.childElementCount !== 0 ) {
        rowContainer.append(toAppend);
    }

    if ( dfPaneBuilt !== true && popupData.advancedUserEnabled ) {
        uDom('#firewall')
            .on('click', 'span[data-src]', unsetFirewallRuleHandler)
            .on('mouseenter', '[data-src]', mouseenterCellHandler)
            .on('mouseleave', '[data-src]', mouseleaveCellHandler);
        dfPaneBuilt = true;
    }

    updateAllFirewallCells();
};

/******************************************************************************/

const hostnameCompare = function(a, b) {
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
    return ca !== cb ? ca - cb : ha.localeCompare(hb);
};

const reIP = /(\d|\])$/;

/******************************************************************************/

const renderPrivacyExposure = function() {
    const allDomains = {};
    let allDomainCount = 0;
    let touchedDomainCount = 0;

    allHostnameRows.length = 0;

    // Sort hostnames. First-party hostnames must always appear at the top
    // of the list.
    const { hostnameDict } = popupData;
    const desHostnameDone = new Set();
    const keys = Object.keys(hostnameDict).sort(hostnameCompare);
    for ( const des of keys ) {
        // Specific-type rules -- these are built-in
        if ( des === '*' || desHostnameDone.has(des) ) { continue; }
        const hnDetails = hostnameDict[des];
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
        const dnDetails = hostnameDict[domain];
        if ( dnDetails !== undefined ) {
            if ( des !== domain ) {
                dnDetails.hasSubdomains = true;
            } else if ( dnDetails.hasSubdomains === undefined ) {
                dnDetails.hasSubdomains = false;
            }
        }
        allHostnameRows.push(des);
        desHostnameDone.add(des);
    }

    const summary = domainsHitStr
        .replace('{{count}}', touchedDomainCount.toLocaleString())
        .replace('{{total}}', allDomainCount.toLocaleString());
    uDom.nodeFromSelector(
        '[data-i18n^="popupDomainsConnected"] + span'
    ).textContent = summary;
};

/******************************************************************************/

const updateHnSwitches = function() {
    uDom.nodeFromId('no-popups').classList.toggle(
        'on', popupData.noPopups === true
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

    const isFiltering = popupData.netFilteringSwitch;

    const body = document.body;
    body.classList.toggle('advancedUser', popupData.advancedUserEnabled === true);
    body.classList.toggle('off', popupData.pageURL === '' || isFiltering !== true);
    body.classList.toggle('needSave', popupData.matrixIsDirty === true);

    // The hostname information below the power switch
    {
        const [ elemHn, elemDn ] = uDom.nodeFromId('hostname').children;
        const { pageDomain, pageHostname } = popupData;
        if ( pageDomain !== '' ) {
            elemDn.textContent = safePunycodeToUnicode(pageDomain);
            elemHn.textContent = pageHostname !== pageDomain
                ? safePunycodeToUnicode(pageHostname.slice(0, -pageDomain.length - 1)) + '.'
                : '';
        } else {
            elemHn.textContent = elemDn.textContent = '';
        }
    }

    const canElementPicker = popupData.canElementPicker === true && isFiltering;
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
    uDom.nodeFromSelector('[data-i18n^="popupBlockedOnThisPage"] + span').textContent = text;

    blocked = popupData.globalBlockedRequestCount;
    total = popupData.globalAllowedRequestCount + blocked;
    if ( total === 0 ) {
        text = formatNumber(0);
    } else {
        text = statsStr.replace('{{count}}', formatNumber(blocked))
                       .replace('{{percent}}', formatNumber(Math.floor(blocked * 100 / total)));
    }
    uDom.nodeFromSelector('[data-i18n^="popupBlockedSinceInstall"] + span').textContent = text;

    // This will collate all domains, touched or not
    renderPrivacyExposure();

    // Extra tools
    updateHnSwitches();

    // Report popup count on badge
    total = popupData.popupBlockedCount;
    uDom.nodeFromSelector('#no-popups .fa-icon-badge')
        .textContent = total ? Math.min(total, 99).toLocaleString() : '';

    // Report large media count on badge
    total = popupData.largeMediaCount;
    uDom.nodeFromSelector('#no-large-media .fa-icon-badge')
        .textContent = total ? Math.min(total, 99).toLocaleString() : '';

    // Report remote font count on badge
    total = popupData.remoteFontCount;
    uDom.nodeFromSelector('#no-remote-fonts .fa-icon-badge')
        .textContent = total ? Math.min(total, 99).toLocaleString() : '';

    document.documentElement.classList.toggle(
        'colorBlind',
        popupData.colorBlindFriendly === true
    );

    setGlobalExpand(popupData.firewallPaneMinimized === false, true);

    // Build dynamic filtering pane only if in use
    if ( (computedSections() & sectionFirewallBit) !== 0 ) {
        buildAllFirewallRows();
    }

    renderTooltips();
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2889
//   Use tooltip for ARIA purpose.

const renderTooltips = function(selector) {
    for ( const [ key, details ] of tooltipTargetSelectors ) {
        if ( selector !== undefined && key !== selector ) { continue; }
        const elem = uDom.nodeFromSelector(key);
        if ( elem.hasAttribute('title') === false ) { continue; }
        const text = vAPI.i18n(
            details.i18n +
            (uDom.nodeFromSelector(details.state) === null ? '1' : '2')
        );
        elem.setAttribute('aria-label', text);
        elem.setAttribute('title', text);
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

    const body = document.body;

    if ( popupData.fontSize !== popupFontSize ) {
        popupFontSize = popupData.fontSize;
        if ( popupFontSize !== 'unset' ) {
            body.style.setProperty('--font-size', popupFontSize);
            vAPI.localStorage.setItem('popupFontSize', popupFontSize);
        } else {
            body.style.removeProperty('--font-size');
            vAPI.localStorage.removeItem('popupFontSize');
        }
    }

    uDom.nodeFromId('version').textContent = popupData.appVersion;

    sectionBitsToAttribute(computedSections());

    if ( popupData.uiPopupConfig !== undefined ) {
        document.body.setAttribute('data-ui', popupData.uiPopupConfig);
    }

    body.classList.toggle('no-tooltips', popupData.tooltipsDisabled === true);
    if ( popupData.tooltipsDisabled === true ) {
        uDom('[title]').removeAttr('title');
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/22
    if ( popupData.advancedUserEnabled !== true ) {
        uDom('#firewall [title][data-src]').removeAttr('title');
    }

    // This must be done the firewall is populated
    if ( popupData.popupPanelHeightMode === 1 ) {
        body.classList.add('vMin');
    }

    // Prevent non-advanced user opting into advanced user mode from harming
    // themselves by disabling by default features generally suitable to
    // filter list maintainers and actual advanced users.
    if ( popupData.godMode ) {
        body.classList.add('godMode');
    }
};

/******************************************************************************/

const renderPopupLazy = (( ) => {
    let mustRenderCosmeticFilteringBadge = true;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/756
    //   Launch potentially expensive hidden elements-counting scriptlet on
    //   demand only.
    {
        const sw = uDom.nodeFromId('no-cosmetic-filtering');
        const badge = sw.querySelector(':scope .fa-icon-badge');
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
        uDom.nodeFromSelector('#no-scripting .fa-icon-badge')
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

// The popup panel is made of sections. Visiblity of sections can
// be toggle on/off.

const maxNumberOfSections = 6;
const sectionFirewallBit = 0b10000;

const computedSections = ( ) =>
    popupData.popupPanelSections &
   ~popupData.popupPanelDisabledSections |
    popupData.popupPanelLockedSections;

const sectionBitsFromAttribute = function() {
    const attr = document.body.dataset.more;
    if ( attr === '' ) { return 0; }
    let bits = 0;
    for ( const c of attr.split(' ') ) {
        bits |= 1 << (c.charCodeAt(0) - 97);
    }
    return bits;
};

const sectionBitsToAttribute = function(bits) {
    const attr = [];
    for ( let i = 0; i < maxNumberOfSections; i++ ) {
        const bit = 1 << i;
        if ( (bits & bit) === 0 ) { continue; }
        attr.push(String.fromCharCode(97 + i));
    }
    document.body.dataset.more = attr.join(' ');
};

const toggleSections = function(more) {
    const offbits = ~popupData.popupPanelDisabledSections;
    const onbits = popupData.popupPanelLockedSections;
    let currentBits = sectionBitsFromAttribute();
    let newBits = currentBits;
    for ( let i = 0; i < maxNumberOfSections; i++ ) {
        const bit = 1 << (more ? i : maxNumberOfSections - i - 1);
        if ( more ) {
            newBits |= bit;
        } else {
            newBits &= ~bit;
        }
        newBits = newBits & offbits | onbits;
        if ( newBits !== currentBits ) { break; }
    }
    if ( newBits === currentBits ) { return; }

    sectionBitsToAttribute(newBits);

    popupData.popupPanelSections = newBits;
    messaging.send('popupPanel', {
        what: 'userSettings',
        name: 'popupPanelSections',
        value: newBits,
    });

    // https://github.com/chrisaljoudi/uBlock/issues/996
    //   Remember the last state of the firewall pane. This allows to
    //   configure the popup size early next time it is opened, which means a
    //   less glitchy popup at open time.
    vAPI.localStorage.setItem('popupPanelSections', newBits);

    // Dynamic filtering pane may not have been built yet
    if ( (newBits & sectionFirewallBit) !== 0 && dfPaneBuilt === false ) {
        buildAllFirewallRows();
    }
};

uDom('#moreButton').on('click', ( ) => { toggleSections(true); });
uDom('#lessButton').on('click', ( ) => { toggleSections(false); });

/******************************************************************************/

const mouseenterCellHandler = function(ev) {
    const target = ev.target;
    if ( target.classList.contains('ownRule') ) { return; }
    target.appendChild(dfHotspots);
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
    updateAllFirewallCells(true, false);
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
    cell.appendChild(dfHotspots);
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

    // Reset popup state hash to current state.
    hashFromPopupData(true);
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
        uDom('#firewall').addClass('expanded');
    } else {
        uDom('#firewall').removeClass('expanded');
    }
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
                url: `popup-fenix.html?tabId=${popupData.tabId}&intab=1`,
                select: true,
                index: -1,
            },
        });
        vAPI.closePopup();
        return;
    }

    setGlobalExpand(
        uDom('#firewall').hasClass('expanded') === false
    );
});

uDom('#firewall').on(
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
    document.body.classList.remove('needSave');
};

/******************************************************************************/

const revertFirewallRules = async function() {
    document.body.classList.remove('needSave');
    const response = await messaging.send('popupPanel', {
        what: 'revertFirewallRules',
        srcHostname: popupData.pageHostname,
        desHostnames: popupData.hostnameDict,
        tabId: popupData.tabId,
    });
    cachePopupData(response);
    updateAllFirewallCells(true, false);
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
    renderTooltips(`#${switchName}`);

    const response = await messaging.send('popupPanel', {
        what: 'toggleHostnameSwitch',
        name: switchName,
        hostname: popupData.pageHostname,
        state: target.classList.contains('on'),
        tabId: popupData.tabId,
        persist: ev.ctrlKey || ev.metaKey,
    });

    cachePopupData(response);
    hashFromPopupData();

    document.body.classList.toggle('needSave', popupData.matrixIsDirty === true);
};

/*******************************************************************************

    Double tap ctrl key: toggle god mode

*/

{
    let eventCount = 0;
    let eventTime = 0;

    document.addEventListener('keydown', ev => {
        if ( ev.key !== 'Control' ) {
            eventCount = 0;
            return;
        }
        const now = Date.now();
        if ( (now - eventTime) >= 500 ) {
            eventCount = 0;
        }
        eventCount += 1;
        eventTime = now;
        if ( eventCount < 2 ) { return; }
        eventCount = 0;
        document.body.classList.toggle('godMode');
    });
}


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

const getPopupData = async function(tabId, first = false) {
    const response = await messaging.send('popupPanel', {
        what: 'getPopupData',
        tabId,
    });

    cachePopupData(response);
    renderOnce();
    renderPopup();
    renderPopupLazy(); // low priority rendering
    hashFromPopupData(first);
    pollForContentChange();
};

/******************************************************************************/

// Popup DOM is assumed to be loaded at this point -- because this script
// is loaded after everything else.

{
    // Extract the tab id of the page for this popup. If there's no tab id
    // specified in the query string, it will default to current tab.
    const selfURL = new URL(self.location.href);
    const tabId = parseInt(selfURL.searchParams.get('tabId'), 10) || null;

    const nextFrames = async n => {
        for ( let i = 0; i < n; i++ ) {
            await new Promise(resolve => {
                self.requestAnimationFrame(( ) => { resolve(); });
            });
        }
    };

    // The purpose of the following code is to reset to a vertical layout
    // should the viewport not be enough wide to accomodate the horizontal
    // layout.
    // To avoid querying a spurious viewport width -- it happens sometimes,
    // somehow -- we delay layout-changing operations to the next paint
    // frames.
    // Force a layout recalculation by querying the body width. To be
    // honest, I have no clue if this makes a difference in the end.
    //   https://gist.github.com/paulirish/5d52fb081b3570c81e3a
    // Use a tolerance proportional to the sum of the width of the panes
    // when testing against viewport width.
    const checkViewport = async function() {
        const root = document.querySelector(':root');
        if (
            root.classList.contains('mobile') ||
            selfURL.searchParams.get('portrait')
        ) {
            root.classList.add('portrait');
        } else if ( root.classList.contains('desktop') ) {
            await nextFrames(4);
            const main = document.getElementById('main');
            const firewall = document.getElementById('firewall');
            const minWidth = (main.offsetWidth + firewall.offsetWidth) / 1.1;
            if (
                selfURL.searchParams.get('portrait') ||
                window.innerWidth < minWidth
            ) {
                root.classList.add('portrait');
            }
        }
        if ( root.classList.contains('portrait') ) {
            const panes = document.getElementById('panes');
            const sticky = document.getElementById('sticky');
            const stickyParent = sticky.parentElement;
            if ( stickyParent !== panes ) {
                panes.prepend(sticky);
            }
        }
        if ( selfURL.searchParams.get('intab') !== null ) {
            root.classList.add('intab');
        }
        await nextFrames(1);
        document.body.classList.remove('loading');
    };

    getPopupData(tabId, true).then(( ) => {
        if ( document.readyState !== 'complete' ) {
            self.addEventListener('load', ( ) => { checkViewport(); }, { once: true });
        } else {
            checkViewport();
        }
    });
}

/******************************************************************************/

uDom('#switch').on('click', toggleNetFilteringSwitch);
uDom('#gotoZap').on('click', gotoZap);
uDom('#gotoPick').on('click', gotoPick);
uDom('.hnSwitch').on('click', ev => { toggleHostnameSwitch(ev); });
uDom('#saveRules').on('click', saveFirewallRules);
uDom('#revertRules').on('click', ( ) => { revertFirewallRules(); });
uDom('a[href]').on('click', gotoURL);

/******************************************************************************/

// Toggle emphasis of rows with[out] 3rd-party scripts/frames
document.querySelector('#firewall > [data-type="3p-script"] .filter')
    .addEventListener('click', ( ) => {
        document.getElementById('firewall').classList.toggle('show3pScript');
    });

// Toggle visibility of rows with[out] 3rd-party frames
document.querySelector('#firewall > [data-type="3p-frame"] .filter')
    .addEventListener('click', ( ) => {
        document.getElementById('firewall').classList.toggle('show3pFrame');
    });

/******************************************************************************/

// <<<<< end of local scope
}

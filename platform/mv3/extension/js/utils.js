/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

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

import { localRead, localRemove, localWrite } from './ext.js';

/******************************************************************************/

export function parsedURLromOrigin(origin) {
    try {
        return new URL(origin);
    } catch {
    }
}

/******************************************************************************/

export const toBroaderHostname = hn => {
    if ( hn === '*' ) { return ''; }
    const pos = hn.indexOf('.');
    return pos !== -1 ? hn.slice(pos+1) : '*';
};

/******************************************************************************/

// Is hna descendant hostname of hnb?

export const isDescendantHostname = (hna, hnb) => {
    if ( hnb === 'all-urls' ) { return true; }
    if ( hna.endsWith(hnb) === false ) { return false; }
    if ( hna === hnb ) { return false; }
    return hna.charCodeAt(hna.length - hnb.length - 1) === 0x2E /* '.' */;
};

/**
 * Returns whether a hostname is part of a collection, or is descendant of an
 * item in the collection.
 * @param hna - the hostname representing the needle.
 * @param iterb - an iterable representing the haystack of hostnames.
 */

export const isDescendantHostnameOfIter = (hna, iterb) => {
    const setb = iterb instanceof Set ? iterb : new Set(iterb);
    if ( setb.has('all-urls') || setb.has('*') ) { return true; }
    let hn = hna;
    while ( hn ) {
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
        if ( setb.has(hn) ) { return true; }
    }
    return false;
};

/**
 * Returns all hostnames in the first collection which are equal or descendant
 * of hostnames in the second collection.
 * @param itera - an iterable which hostnames must be filtered out.
 * @param iterb - an iterable which hostnames must be matched.
 */

export const intersectHostnameIters = (itera, iterb) => {
    const setb = iterb instanceof Set ? iterb : new Set(iterb);
    if ( setb.has('all-urls') || setb.has('*') ) { return Array.from(itera); }
    const out = [];
    for ( const hna of itera ) {
        if ( setb.has(hna) || isDescendantHostnameOfIter(hna, setb) ) {
            out.push(hna);
        }
    }
    return out;
};

export const subtractHostnameIters = (itera, iterb) => {
    const setb = iterb instanceof Set ? iterb : new Set(iterb);
    if ( setb.has('all-urls') || setb.has('*') ) { return []; }
    const out = [];
    for ( const hna of itera ) {
        if ( setb.has(hna) ) { continue; }
        if ( isDescendantHostnameOfIter(hna, setb) ) { continue; }
        out.push(hna);
    }
    return out;
};

/******************************************************************************/

export const matchFromHostname = hn =>
    hn === '*' || hn === 'all-urls' ? '<all_urls>' : `*://*.${hn}/*`;

export const matchesFromHostnames = hostnames => {
    const out = [];
    for ( const hn of hostnames ) {
        out.push(matchFromHostname(hn));
    }
    return out;
};

export const hostnameFromMatch = origin => {
    if ( origin === '<all_urls>' || origin === '*://*/*' ) { return 'all-urls'; }
    const match = /^[^:]+:\/\/(?:\*\.)?([^/]+)\/\*/.exec(origin);
    if ( match === null ) { return ''; }
    return match[1];
};

export const hostnamesFromMatches = origins => {
    const out = [];
    for ( const origin of origins ) {
        const hn = hostnameFromMatch(origin);
        if ( hn === '' ) { continue; }
        out.push(hn);
    }
    return out;
};

/******************************************************************************/

export const broadcastMessage = message => {
    const bc = new self.BroadcastChannel('uBOL');
    bc.postMessage(message);
};

/******************************************************************************/

// The goal is just to be able to find out whether a specific version is older
// than another one.

export function intFromVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if ( match === null ) { return 0; }
    const year = parseInt(match[1], 10);
    const monthday = parseInt(match[2], 10);
    const min = parseInt(match[3], 10);
    return (year - 2022) * (1232 * 2400) + monthday * 2400 + min;
}

/******************************************************************************/

export const isScriptlet = a => a.startsWith('+js');

/******************************************************************************/

function setupJobsAlarm(jobs) {
    if ( Boolean(jobs?.length) === false ) {
        return browser.alarms.clear('deferredJobs');
    }
    return browser.alarms.create('deferredJobs', {
        when: Math.max(jobs[0].time, Date.now() + 101),
    });
}

export async function registerJob(name, time) {
    const jobs = await localRead('deferredJobs') || [];
    const job = jobs.find(a => a.name === name);
    if ( job ) {
        job.time = time;
    } else {
        jobs.push({ name, time });
    }
    jobs.sort((a, b) => a.time - b.time);
    setupJobsAlarm(jobs);
    return localWrite('deferredJobs', jobs);
}

export async function removeJob(name) {
    const before = await localRead('deferredJobs');
    const after = before.filter(a => a.name !== name);
    if ( after.length === before.length ) { return; }
    setupJobsAlarm(after);
    if ( after.length ) {
        return localWrite('deferredJobs', after);
    }
    return localRemove('deferredJobs');
}

export async function processDueJobs(dispatcher) {
    const jobs = await localRead('deferredJobs');
    if ( Boolean(jobs?.length) === false ) { return; }
    const now = Date.now();
    let i = 0;
    while ( i < jobs.length ) {
        if ( jobs[i].time > now ) { break; }
        i += 1;
    }
    const toProcess = jobs.slice(0, i);
    const toDefer = jobs.slice(i);
    if ( toDefer.length ) {
        setupJobsAlarm(toDefer);
        await localWrite('deferredJobs', toDefer);
    } else {
        await localRemove('deferredJobs');
    }
    for ( const job of toProcess ) {
        dispatcher({ what: job.name });
    }
}

export async function resetJobsAlarm() {
    const jobs = await localRead('deferredJobs');
    setupJobsAlarm(jobs);
}

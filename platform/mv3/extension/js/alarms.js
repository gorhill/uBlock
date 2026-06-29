/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2026-present Raymond Hill

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

import {
    browser,
    localRead, localRemove, localWrite,
} from './ext.js';

import { ubolLog } from './debug.js';

/******************************************************************************/

function setupJobsAlarm(jobs) {
    if ( Boolean(jobs?.length) === false ) {
        return browser.alarms.clear('deferredJobs');
    }
    // No less than 5 minutes in the future
    const when = Math.max(jobs[0].time, Date.now() + 5 * 60 * 1000);
    ubolLog(`Created alarm for ${(new Date(when)).toString()}`);
    return browser.alarms.create('deferredJobs', { when });
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
    await Promise.all(toProcess.map(a => dispatcher({ what: a.name })));
}

export async function resetJobsAlarm() {
    const jobs = await localRead('deferredJobs');
    setupJobsAlarm(jobs);
}

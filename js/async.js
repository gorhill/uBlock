/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global µBlock */

/******************************************************************************/

// Async job queue module

µBlock.asyncJobs = (function() {

var processJobs = function() {
    asyncJobManager.process();
};

var AsyncJobEntry = function(name) {
    this.name = name;
    this.data = null;
    this.callback = null;
    this.when = 0;
    this.period = 0;
};

AsyncJobEntry.prototype.destroy = function() {
    this.name = '';
    this.data = null;
    this.callback = null;
};

var AsyncJobManager = function() {
    this.timeResolution = 200;
    this.jobs = {};
    this.jobCount = 0;
    this.jobJunkyard = [];
    this.timerId = null;
    this.timerWhen = Number.MAX_VALUE;
};

AsyncJobManager.prototype.restartTimer = function() {
    var when = Number.MAX_VALUE;
    var jobs = this.jobs, job;
    for ( var jobName in jobs ) {
        job = jobs[jobName];
        if ( job instanceof AsyncJobEntry ) {
            if ( job.when < when ) {
                when = job.when;
            }
        }
    }
    // Quantize time value
    when = Math.floor((when + this.timeResolution - 1) / this.timeResolution) * this.timeResolution;

    if ( when < this.timerWhen ) {
        clearTimeout(this.timerId);
        this.timerWhen = when;
        this.timerId = setTimeout(processJobs, Math.max(when - Date.now(), 10));
    }
};

AsyncJobManager.prototype.add = function(name, data, callback, delay, recurrent) {
    var job = this.jobs[name];
    if ( !job ) {
        job = this.jobJunkyard.pop();
        if ( !job ) {
            job = new AsyncJobEntry(name);
        } else {
            job.name = name;
        }
        this.jobs[name] = job;
        this.jobCount++;
    }
    job.data = data;
    job.callback = callback;
    job.when = Date.now() + delay;
    job.period = recurrent ? delay : 0;
    this.restartTimer();
};

AsyncJobManager.prototype.process = function() {
    this.timerId = null;
    this.timerWhen = Number.MAX_VALUE;
    var now = Date.now();
    var job;
    for ( var jobName in this.jobs ) {
        if ( this.jobs.hasOwnProperty(jobName) === false ) {
            continue;
        }
        job = this.jobs[jobName];
        if ( job.when > now ) {
            continue;
        }
        job.callback(job.data);
        if ( job.period ) {
            job.when = now + job.period;
        } else {
            delete this.jobs[jobName];
            job.destroy();
            this.jobCount--;
            this.jobJunkyard.push(job);
        }
    }
    this.restartTimer();
};

// Only one instance
var asyncJobManager = new AsyncJobManager();

// Publish
return asyncJobManager;

})();

/******************************************************************************/

// Update visual of extension icon.
// A time out is used to coalesce adjacent requests to update badge.

µBlock.updateBadgeAsync = function(tabId) {
    if ( tabId < 0 ) {
        return;
    }
    var µb = this;
    var updateBadge = function() {
        var pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore ) {
            pageStore.updateBadge();
            return;
        }
        µb.XAL.setIcon(
            tabId,
            { '19': 'img/browsericons/icon19-off.png', '38': 'img/browsericons/icon38-off.png' },
            ''
        );
    };
    this.asyncJobs.add('updateBadge-' + tabId, tabId, updateBadge, 250);
};

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2017 Raymond Hill

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

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

if (
    typeof vAPI !== 'object' ||
    vAPI.domFilterer instanceof Object === false ||
    vAPI.domWatcher instanceof Object === false
) {
    return;
}

var reHasCSSCombinators = /[ >+~]/,
    reHasPseudoClass = /:+(?:after|before)$/,
    sanitizedSelectors = new Map(),
    matchProp = vAPI.matchesProp,
    simple = { dict: new Set(), str: undefined },
    complex = { dict: new Set(), str:  undefined },
    procedural = { dict: new Map() },
    jobQueue = [];

var DeclarativeSimpleJob = function(node) {
    this.node = node;
};
DeclarativeSimpleJob.create = function(node) {
    return new DeclarativeSimpleJob(node);
};
DeclarativeSimpleJob.prototype.lookup = function(out) {
    if ( simple.dict.size === 0 ) { return; }
    if ( simple.str === undefined ) {
        simple.str = Array.from(simple.dict).join(',\n');
    }
    if (
        (this.node === document || this.node[matchProp](simple.str) === false) &&
        (this.node.querySelector(simple.str) === null)
    ) {
        return;
    }
    for ( var selector of simple.dict ) {
        if (
            this.node !== document && this.node[matchProp](selector) ||
            this.node.querySelector(selector) !== null
        ) {
            out.push(sanitizedSelectors.get(selector) || selector);
            simple.dict.delete(selector);
            simple.str = undefined;
            if ( simple.dict.size === 0 ) { return; }
        }
    }
};

var DeclarativeComplexJob = function() {
};
DeclarativeComplexJob.instance = null;
DeclarativeComplexJob.create = function() {
    if ( DeclarativeComplexJob.instance === null ) {
        DeclarativeComplexJob.instance = new DeclarativeComplexJob();
    }
    return DeclarativeComplexJob.instance;
};
DeclarativeComplexJob.prototype.lookup = function(out) {
    if ( complex.dict.size === 0 ) { return; }
    if ( complex.str === undefined ) {
        complex.str = Array.from(complex.dict).join(',\n');
    }
    if ( document.querySelector(complex.str) === null ) { return; }
    for ( var selector of complex.dict ) {
        if ( document.querySelector(selector) !== null ) {
            out.push(sanitizedSelectors.get(selector) || selector);
            complex.dict.delete(selector);
            complex.str = undefined;
            if ( complex.dict.size === 0 ) { return; }
        }
    }
};

var ProceduralJob = function() {
};
ProceduralJob.instance = null;
ProceduralJob.create = function() {
    if ( ProceduralJob.instance === null ) {
        ProceduralJob.instance = new ProceduralJob();
    }
    return ProceduralJob.instance;
};
ProceduralJob.prototype.lookup = function(out) {
    for ( var entry of procedural.dict ) {
        if ( entry[1].test() ) {
            procedural.dict.delete(entry[0]);
            out.push(entry[1].raw);
            if ( procedural.dict.size === 0 ) { return; }
        }
    }
};

var jobQueueTimer = new vAPI.SafeAnimationFrame(function processJobQueue() {
    //console.time('dom logger/scanning for matches');
    jobQueueTimer.clear();
    var toLog = [],
        t0 = Date.now(),
        job;
    while ( (job = jobQueue.shift()) ) {
        job.lookup(toLog);
        if ( (Date.now() - t0) > 10 ) { break; }
    }
    if ( toLog.length !== 0 ) {
        vAPI.messaging.send(
            'scriptlets',
            {
                what: 'logCosmeticFilteringData',
                frameURL: window.location.href,
                frameHostname: window.location.hostname,
                matchedSelectors: toLog
            }
        );
    }
    if ( simple.dict.size === 0 && complex.dict.size === 0 ) {
        jobQueue = [];
    }
    if ( jobQueue.length !== 0 ) {
        jobQueueTimer.start(100);
    }
    //console.timeEnd('dom logger/scanning for matches');
});

var handlers = {
    onFiltersetChanged: function(changes) {
        //console.time('dom logger/filterset changed');
        var selector, sanitized, entry,
            simpleSizeBefore = simple.dict.size,
            complexSizeBefore = complex.dict.size,
            logNow = [];
        for ( entry of (changes.declarative || []) ) {
            for ( selector of entry[0].split(',\n') ) {
                if ( entry[1] === 'display:none!important;' ) {
                    if ( reHasPseudoClass.test(selector) ) {
                        sanitized = selector.replace(reHasPseudoClass, '');
                        sanitizedSelectors.set(sanitized, selector);
                        selector = sanitized;
                    }
                    if ( reHasCSSCombinators.test(selector) ) {
                        complex.dict.add(selector);
                        complex.str = undefined;
                    } else {
                        simple.dict.add(selector);
                        simple.str = undefined;
                    }
                } else {
                    logNow.push(selector + ':style(' + entry[1] + ')');
                }
            }
        }
        if ( simple.dict.size !== simpleSizeBefore ) {
            jobQueue.push(DeclarativeSimpleJob.create(document));
        }
        if ( complex.dict.size !== complexSizeBefore ) {
            complex.str = Array.from(complex.dict).join(',\n');
            jobQueue.push(DeclarativeComplexJob.create());
        }
        if ( logNow.length !== 0 ) {
            vAPI.messaging.send(
                'scriptlets',
                {
                    what: 'logCosmeticFilteringData',
                    frameURL: window.location.href,
                    frameHostname: window.location.hostname,
                    matchedSelectors: logNow
                }
            );
        }
        if ( Array.isArray(changes.procedural) ) {
            for ( selector of changes.procedural ) {
                procedural.dict.set(selector.raw, selector);
            }
            if ( changes.procedural.size !== 0 ) {
                jobQueue.push(ProceduralJob.create());
            }
        }
        if ( jobQueue.length !== 0 ) {
            jobQueueTimer.start(1);
        }
        //console.timeEnd('dom logger/filterset changed');
    },

    onDOMCreated: function() {
        handlers.onFiltersetChanged(vAPI.domFilterer.getAllSelectors());
        vAPI.domFilterer.addListener(handlers);
    },

    onDOMChanged: function(addedNodes) {
        if ( simple.dict.size === 0 && complex.dict.size === 0 ) { return; }
        // This is to guard against runaway job queue. I suspect this could
        // occur on slower devices.
        if ( jobQueue.length <= 300 ) {
            if ( simple.dict.size !== 0 ) {
                for ( var node of addedNodes ) {
                    jobQueue.push(DeclarativeSimpleJob.create(node));
                }
            }
            if ( complex.dict.size !== 0 ) {
                jobQueue.push(DeclarativeComplexJob.create());
            }
            if ( procedural.dict.size !== 0 ) {
                jobQueue.push(ProceduralJob.create());
            }
        }
        if ( jobQueue.length !== 0 ) {
            jobQueueTimer.start(100);
        }
    }
};

/******************************************************************************/

var onMessage = function(msg) {
    if ( msg.what === 'loggerDisabled' ) {
        jobQueueTimer.clear();
        vAPI.domFilterer.removeListener(handlers);
        vAPI.domWatcher.removeListener(handlers);
        vAPI.messaging.removeChannelListener('domLogger', onMessage);
    }
};
vAPI.messaging.addChannelListener('domLogger', onMessage);

vAPI.domWatcher.addListener(handlers);

/******************************************************************************/

})();

/*******************************************************************************

    Imported from:
      https://github.com/NanoAdblocker/NanoFilters/blob/1f3be7211bb0809c5106996f52564bf10c4525f7/NanoFiltersSource/NanoResources.txt#L126

    Speed up or down setInterval, 3 optional arguments.
    funcMatcher - The payload matcher, a string literal or a JavaScript RegExp,
    defaults to match all.
    delayMatcher - The delay matcher, an integer, defaults to 1000.
    boostRatio - The delay multiplier when there is a match, 0.5 speeds up by
    2 times and 2 slows down by 2 times, defaults to 0.05 or speed up 20 times.
    Speed up and down both cap at 50 times.

*/

(function() {
    'use strict';
    let needle = '{{1}}';
    let delay = parseInt('{{2}}', 10);
    let boost = parseFloat('{{3}}');
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.charAt(0) === '/' && needle.slice(-1) === '/' ) {
        needle = needle.slice(1, -1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    if ( isNaN(delay) || !isFinite(delay) ) {
        delay = 1000;
    }
    if ( isNaN(boost) || !isFinite(boost) ) {
        boost = 0.05;
    }
    if ( boost < 0.02 ) {
        boost = 0.02;
    }
    if ( boost > 50 ) {
        boost = 50;
    }
    window.setInterval = new Proxy(window.setInterval, {
        apply: function(target, thisArg, args) {
            const a = args[0];
            const b = args[1];
            if ( b === delay && needle.test(a.toString()) ) {
                args[1] = b * boost;
            }
            return target.apply(thisArg, args);
        }
    });
})();

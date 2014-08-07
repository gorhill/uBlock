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

/* jshint bitwise: false */
/* global µBlock */

/******************************************************************************/

µBlock.abpHideFilters = (function(){


/******************************************************************************/

var µb = µBlock;

/******************************************************************************/
/*
var histogram = function(label, buckets) {
    var h = [],
        bucket;
    for ( var k in buckets ) {
        if ( buckets.hasOwnProperty(k) === false ) {
            continue;
        }
        bucket = buckets[k];
        h.push({
            k: k,
            n: bucket instanceof FilterBucket ? bucket.filters.length : 1
        });
    }

    console.log('Histogram %s', label);

    var total = h.length;
    h.sort(function(a, b) { return b.n - a.n; });

    // Find indices of entries of interest
    var target = 3;
    for ( var i = 0; i < total; i++ ) {
        if ( h[i].n === target ) {
            console.log('\tEntries with only %d filter(s) start at index %s (key = "%s")', target, i, h[i].k);
            target -= 1;
        }
    }

    h = h.slice(0, 50);

    h.forEach(function(v) {
        console.log('\tkey="%s" count=%d', v.k, v.n);
    });
    console.log('\tTotal buckets count: %d', total);
};
*/
/******************************************************************************/

// Pure id- and class-based filters
// Examples:
//   #A9AdsMiddleBoxTop
//   .AD-POST

var FilterPlain = function(s) {
    this.s = s;
};

FilterPlain.prototype.retrieve = function(s, out) {
    if ( s === this.s ) {
        out.push(this.s);
    }
};

/******************************************************************************/

// Id- and class-based filters with extra selector stuff following.
// Examples:
//   #center_col > div[style="font-size:14px;margin-right:0;min-height:5px"] ...
//   #adframe:not(frameset)
//   .l-container > #fishtank

var FilterPlainMore = function(s) {
    this.s = s;
};

FilterPlainMore.prototype.retrieve = function(s, out) {
    if ( s === this.s.slice(0, s.length) ) {
        out.push(this.s);
    }
};

/******************************************************************************/

// Any selector specific to a hostname
// Examples:
//   search.snapdo.com###ABottomD
//   facebook.com##.-cx-PRIVATE-fbAdUnit__root
//   sltrib.com###BLContainer + div[style="height:90px;"]
//   myps3.com.au##.Boxer[style="height: 250px;"]
//   lindaikeji.blogspot.com##a > img[height="600"]
//   japantimes.co.jp##table[align="right"][width="250"]
//   mobilephonetalk.com##[align="center"] > b > a[href^="http://tinyurl.com/"]

var FilterHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterHostname.prototype.retrieve = function(hostname, out) {
    if ( hostname.slice(-this.hostname.length) === this.hostname ) {
        out.push(this.s);
    }
};

/******************************************************************************/

// Any selector specific to an entity
// Examples:
//   google.*###cnt #center_col > #res > #topstuff > .ts

var FilterEntity = function(s, entity) {
    this.s = s;
    this.entity = entity;
};

FilterEntity.prototype.retrieve = function(entity, out) {
    if ( entity.slice(-this.entity.length) === this.entity ) {
        out.push(this.s);
    }
};

/******************************************************************************/
/******************************************************************************/

// TODO: evaluate the gain (if any) from avoiding the use of an array for when
// there are only two filters (or three, etc.). I suppose there is a specific
// number of filters below which using an array is more of an overhead than
// using a couple of property members.
// i.e. FilterBucket2, FilterBucket3, FilterBucketN.

var FilterBucket = function(a, b) {
    this.filters = [a, b];
};

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
};

FilterBucket.prototype.retrieve = function(s, out) {
    var i = this.filters.length;
    while ( i-- ) {
        this.filters[i].retrieve(s, out);
    }
};

/******************************************************************************/
/******************************************************************************/

var FilterParser = function() {
    this.s = '';
    this.prefix = '';
    this.suffix = '';
    this.anchor = 0;
    this.filterType = '#';
    this.hostnames = [];
    this.invalid = false;
    this.unsupported = false;
    this.reParser = /^\s*([^#]*)(##|#@#)(.+)\s*$/;
    this.rePlain = /^([#.][\w-]+)/;
    this.rePlainMore = /^[#.][\w-]+[^\w-]/;
    this.reElement = /^[a-z]/i;
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.s = '';
    this.prefix = '';
    this.suffix = '';
    this.anchor = '';
    this.filterType = '#';
    this.hostnames = [];
    this.invalid = false;
    return this;
};

/******************************************************************************/

FilterParser.prototype.parse = function(s) {
    // important!
    this.reset();

    var matches = this.reParser.exec(s);
    if ( matches === null || matches.length !== 4 ) {
        this.invalid = true;
        return this;
    }

    // Remember original string
    this.s = s;
    this.prefix = matches[1];
    this.anchor = matches[2];
    this.suffix = matches[3];

    // 2014-05-23:
    // https://github.com/gorhill/httpswitchboard/issues/260
    // Any sequence of `#` longer than one means the line is not a valid
    // cosmetic filter.
    if ( this.suffix.indexOf('##') >= 0 ) {
        this.invalid = true;
        return this;
    }

    this.filterType = this.anchor.charAt(1);
    if ( this.prefix !== '' ) {
        this.hostnames = this.prefix.split(/\s*,\s*/);
    }
    return this;
};

/******************************************************************************/

FilterParser.prototype.isPlainMore = function() {
    return this.rePlainMore.test(this.suffix);
};

/******************************************************************************/

FilterParser.prototype.isElement = function() {
    return this.reElement.test(this.suffix);
};

/******************************************************************************/

FilterParser.prototype.extractPlain = function() {
    var matches = this.rePlain.exec(this.suffix);
    if ( matches && matches.length === 2 ) {
        return matches[1];
    }
    return '';
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.filterParser = new FilterParser();
    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
    this.filterParser.reset();
    this.frozen = false;
    this.acceptedCount = 0;
    this.processedCount = 0;
    this.domainHashMask = (1 << 10) - 1;
    this.genericHashMask = (1 << 15) - 1;
    this.genericFilters = {};
    this.hostnameHide = {};
    this.hostnameDonthide = {};
    this.hostnameFilters = {};
    this.entityHide = {};
    this.entityDonthide = {};
    this.entityFilters = {};
    this.hideUnfiltered = [];
    this.hideLowGenerics = {};
    this.hideHighGenerics = [];
    this.donthideUnfiltered = [];
    this.donthideLowGenerics = {};
    this.donthideHighGenerics = [];
    this.rejected = [];
    this.duplicates = {};
    this.duplicateCount = 0;
};

/******************************************************************************/

FilterContainer.prototype.add = function(s) {
    s = s.trim();
    var parsed = this.filterParser.parse(s);
    if ( parsed.invalid ) {
        return false;
    }

    this.processedCount += 1;

    //if ( s === 'mail.google.com##.nH.adC > .nH > .nH > .u5 > .azN' ) {
    //    debugger;
    //}

    // hostname-based filters: with a hostname, narrowing is good enough, no
    // need to further narrow.
    if ( parsed.hostnames.length ) {
        return this.addSpecificFilter(parsed);
    }

    if ( this.duplicates[s] ) {
        this.duplicateCount++;
        return false;
    }
    this.duplicates[s] = true;

    // no specific hostname, narrow using class or id.
    var selectorType = parsed.suffix.charAt(0);
    if ( selectorType === '#' || selectorType === '.' ) {
        return this.addPlainFilter(parsed);
    }

    // no specific hostname, no class, no id.
    if ( parsed.filterType === '#' ) {
        this.hideUnfiltered.push(parsed.suffix);
    } else {
        this.donthideUnfiltered.push(parsed.suffix);
    }
    this.acceptedCount += 1;

    return true;
};

/******************************************************************************/

FilterContainer.prototype.freezeHostnameSpecifics = function(what, type) {
    var µburi = µb.URI;
    var entries = this[what];
    var filters = this.hostnameFilters;
    var f, hash, bucket;
    for ( var hostname in entries ) {
        if ( entries.hasOwnProperty(hostname) === false ) {
            continue;
        }
        f = new FilterHostname(Object.keys(entries[hostname]).join(','), hostname);
        hash = makeHash(type, µburi.domainFromHostname(hostname), this.domainHashMask);
        bucket = filters[hash];
        if ( bucket === undefined ) {
            filters[hash] = f;
        } else if ( bucket instanceof FilterBucket ) {
            bucket.add(f);
        } else {
            filters[hash] = new FilterBucket(bucket, f);
        }
    }
    this[what] = {};
};

/******************************************************************************/

FilterContainer.prototype.freezeEntitySpecifics = function(what, type) {
    var entries = this[what];
    var filters = this.entityFilters;
    var f, hash, bucket;
    for ( var entity in entries ) {
        if ( entries.hasOwnProperty(entity) === false ) {
            continue;
        }
        f = new FilterEntity(Object.keys(entries[entity]).join(','), entity);
        hash = makeHash(type, entity, this.domainHashMask);
        bucket = filters[hash];
        if ( bucket === undefined ) {
            filters[hash] = f;
        } else if ( bucket instanceof FilterBucket ) {
            bucket.add(f);
        } else {
            filters[hash] = new FilterBucket(bucket, f);
        }
    }
    this[what] = {};
};

/******************************************************************************/

FilterContainer.prototype.freezeGenerics = function(what) {
    var selectors = this[what + 'Unfiltered'];
    //console.log('%d highly generic selectors:\n', selectors.length, selectors.sort().join('\n'));

    // ["title"] and ["alt"] will be sorted out manually, these are the most
    // common generic selectors, aka "low generics". The rest will be put in
    // the high genericity bin.
    var lowGenerics = {};
    var lowGenericCount = 0;
    var re = /^(([a-z]*)\[(alt|title)="([^"]+)"\])$/;
    var i = selectors.length;
    var selector, matches;
    while ( i-- ) {
        selector = selectors[i];
        matches = re.exec(selector);
        if ( !matches ) {
            continue;
        }
        lowGenerics[matches[1]] = true;
        lowGenericCount++;
        selectors.splice(i, 1);
    }

    // Chunksize is a compromise between number of selectors per chunk (the
    // number of selectors querySelector() will have to deal with), and the
    // number of chunks (the number of times querySelector() will have to
    // be called.)
    // Benchmarking shows this is a hot spot performance-wise for "heavy"
    // sites (like say, Sports Illustrated, good test case). Not clear what
    // better can be done at this point, I doubt javascript-side code can beat
    // querySelector().
    var chunkSize = Math.max(selectors.length >>> 3, 8);
    var chunkified = [], chunk;
    for (;;) {
        chunk = selectors.splice(0, chunkSize);
        if ( chunk.length === 0 ) {
            break;
        }
        chunkified.push(chunk.join(','));
    }

    this[what + 'LowGenerics'] = lowGenerics;
    this[what + 'LowGenericCount'] = lowGenericCount;
    this[what + 'HighGenerics'] = chunkified;
    this[what + 'Unfiltered'] = [];
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    this.freezeHostnameSpecifics('hostnameHide', '#');
    this.freezeHostnameSpecifics('hostnameDonthide', '@');
    this.freezeEntitySpecifics('entityHide', '#');
    this.freezeEntitySpecifics('entityDonthide', '@');
    this.freezeGenerics('hide');
    this.freezeGenerics('donthide');

    this.filterParser.reset();

    // console.debug('Number of duplicate cosmetic filters skipped:', this.duplicateCount);
    this.duplicates = {};
    this.frozen = true;

    //histogram('genericFilters', this.genericFilters);
    //histogram('hostnameFilters', this.hostnameFilters);
};

/******************************************************************************/

// Two Unicode characters:
// T0HHHHHHH HHHHHHHHH
// |       |         | 
// |       |         | 
// |       |         | 
// |       |         +-- bit 8-0 of FNV
// |       |
// |       +-- bit 15-9 of FNV
// |
// +-- filter type (0=hide 1=unhide)
//

var makeHash = function(type, token, mask) {
    // Ref: Given a URL, returns a unique 4-character long hash string
    // Based on: FNV32a
    // http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
    // The rest is custom, suited for µBlock.
    var i1 = token.length;
    var i2 = i1 >> 1;
    var i4 = i1 >> 2;
    var i8 = i1 >> 3;
    var hval = (0x811c9dc5 ^ token.charCodeAt(0)) >>> 0;
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i4);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i4+i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2+i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2+i4);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i1-1);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval &= mask;
        if ( type === '@' ) {
            hval |= 0x20000;
        }
    return String.fromCharCode(hval >>> 9, hval & 0x1FF);
};

/******************************************************************************/

FilterContainer.prototype.addPlainFilter = function(parsed) {
    // Verify whether the plain selector is followed by extra selector stuff
    if ( parsed.isPlainMore() ) {
        return this.addPlainMoreFilter(parsed);
    }
    var f = new FilterPlain(parsed.suffix);
    var hash = makeHash(parsed.filterType, parsed.suffix, this.genericHashMask);
    this.addFilterEntry(this.genericFilters, hash, f);
    this.acceptedCount += 1;
};

/******************************************************************************/

FilterContainer.prototype.addPlainMoreFilter = function(parsed) {
    var selectorSuffix = parsed.extractPlain();
    if ( selectorSuffix === '' ) {
        return;
    }
    var f = new FilterPlainMore(parsed.suffix);
    var hash = makeHash(parsed.filterType, selectorSuffix, this.genericHashMask);
    this.addFilterEntry(this.genericFilters, hash, f);
    this.acceptedCount += 1;
};

/******************************************************************************/

FilterContainer.prototype.addHostnameFilter = function(hostname, parsed) {
    var entries = parsed.filterType === '#' ?
        this.hostnameHide :
        this.hostnameDonthide;
    var entry = entries[hostname];
    if ( entry === undefined ) {
        entry = entries[hostname] = {};
    }
    entry[parsed.suffix] = true;
};

/******************************************************************************/

FilterContainer.prototype.addEntityFilter = function(hostname, parsed) {
    var entries = parsed.filterType === '#' ?
        this.entityHide :
        this.entityDonthide;
    var entity = hostname.slice(0, -2);
    var entry = entries[entity];
    if ( entry === undefined ) {
        entry = entries[entity] = {};
    }
    entry[parsed.suffix] = true;
};

/******************************************************************************/

FilterContainer.prototype.addSpecificFilter = function(parsed) {
    var hostnames = parsed.hostnames;
    var i = hostnames.length, hostname;
    while ( i-- ) {
        hostname = hostnames[i];
        if ( !hostname ) {
            continue;
        }
        // rhill 2014-07-13: new filter class: entity.
        if ( hostname.slice(-2) === '.*' ) {
            this.addEntityFilter(hostname, parsed);
        } else {
            this.addHostnameFilter(hostname, parsed);
        }
    }
    this.acceptedCount += 1;
};

/******************************************************************************/

FilterContainer.prototype.addFilterEntry = function(filterDict, hash, f) {
    var bucket = filterDict[hash];
    if ( bucket === undefined ) {
        filterDict[hash] = f;
    } else if ( bucket instanceof FilterBucket ) {
        bucket.add(f);
    } else {
        filterDict[hash] = new FilterBucket(bucket, f);
    }
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
    if ( µb.userSettings.parseAllABPHideFilters !== true ) {
        return;
    }
    if ( !request.selectors ) {
        return;
    }

    //quickProfiler.start('FilterContainer.retrieve()');

    var r = {
        hide: [],
        donthide: [],
        hideLowGenerics: this.hideLowGenerics,
        hideLowGenericCount: this.hideLowGenericCount,
        hideHighGenerics: this.hideHighGenerics,
        donthideLowGenerics: this.donthideLowGenerics,
        donthideLowGenericCount: this.donthideLowGenericCount,
        donthideHighGenerics: this.donthideHighGenerics
    };

    var hash, bucket;
    var hashMask = this.genericHashMask;
    var hideSelectors = r.hide;
    var selectors = request.selectors;
    var i = selectors.length;
    var selector;
    while ( i-- ) {
        selector = selectors[i];
        if ( !selector ) {
            continue;
        }
        hash = makeHash('#', selector, hashMask);
        if ( bucket = this.genericFilters[hash] ) {
            bucket.retrieve(selector, hideSelectors);
        }
    }

    //quickProfiler.stop();

    //console.log(
    //    'µBlock> abp-hide-filters.js: %d selectors in => %d selectors out',
    //    request.selectors.length,
    //    r.hide.length + r.donthide.length
    //);

    return r;
};

/******************************************************************************/

FilterContainer.prototype.retrieveDomainSelectors = function(request) {
    if ( µb.userSettings.parseAllABPHideFilters !== true ) {
        return;
    }
    if ( !request.locationURL ) {
        return;
    }

    //quickProfiler.start('FilterContainer.retrieve()');

    var hostname = µb.URI.hostnameFromURI(request.locationURL);
    var domain = µb.URI.domainFromHostname(hostname);
    var pos = domain.indexOf('.');
    var r = {
        domain: domain,
        entity: pos === -1 ? domain : domain.slice(0, pos - domain.length),
        hide: [],
        donthide: []
    };

    var hash, bucket;
    hash = makeHash('#', r.domain, this.domainHashMask);
    if ( bucket = this.hostnameFilters[hash] ) {
        bucket.retrieve(hostname, r.hide);
    }
    hash = makeHash('#', r.entity, this.domainHashMask);
    if ( bucket = this.entityFilters[hash] ) {
        bucket.retrieve(pos === -1 ? domain : hostname.slice(0, pos - domain.length), r.hide);
    }
    hash = makeHash('@', r.domain, this.domainHashMask);
    if ( bucket = this.hostnameFilters[hash] ) {
        bucket.retrieve(hostname, r.donthide);
    }

    //quickProfiler.stop();

    //console.log(
    //    'µBlock> abp-hide-filters.js: "%s" => %d selectors out',
    //    request.locationURL,
    //    r.hide.length + r.donthide.length
    //);

    return r;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

/******************************************************************************/

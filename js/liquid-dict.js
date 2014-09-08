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

µBlock.LiquidDict = (function() {

/******************************************************************************/

var LiquidDict = function() {
    this.dict = {};
    this.count = 0;
    this.bucketCount = 0;
    this.frozenBucketCount = 0;

    // Somewhat arbitrary: I need to come up with hard data to know at which
    // point binary search is better than indexOf.
    this.cutoff = 500;
};

/******************************************************************************/

var meltBucket = function(ldict, len, bucket) {
    ldict.frozenBucketCount -= 1;
    var map = {};
    if ( bucket.charAt(0) === ' ' ) {
        bucket.trim().split(' ').map(function(k) {
            map[k] = true;
        });
    } else {
        var offset = 0;
        while ( offset < bucket.length ) {
            map[bucket.substring(offset, len)] = true;
            offset += len;
        }
    }
    return map;
};

/******************************************************************************/

var melt = function(ldict) {
    var buckets = ldict.dict;
    var bucket;
    for ( var key in buckets ) {
        bucket = buckets[key];
        if ( typeof bucket === 'string' ) {
            buckets[key] = meltBucket(ldict, key.charCodeAt(0) & 0xFF, bucket);
        }
    }
};

/******************************************************************************/

var freezeBucket = function(ldict, bucket) {
    ldict.frozenBucketCount += 1;
    var words = Object.keys(bucket);
    var wordLen = words[0].length;
    if ( wordLen * words.length < ldict.cutoff ) {
        return ' ' + words.join(' ') + ' ';
    }
    return words.sort().join('');
};

/******************************************************************************/

// How the key is derived dictates the number and size of buckets.
//
// http://jsperf.com/makekey-concat-vs-join/3
//
// Question: Why is using a prototyped function better than a standalone
// helper function?

LiquidDict.prototype.makeKey = function(word) {
    var len = word.length;
    if ( len > 255 ) {
        len = 255;
    }
    var i8 = len >>> 3;
    var i4 = len >>> 2;
    var i2 = len >>> 1;

    // Be sure the msb is not set, this will guarantee a valid unicode 
    // character (because 0xD800-0xDFFF).
    return String.fromCharCode(
        (word.charCodeAt(      i8) & 0x01) << 14 |
        (word.charCodeAt(   i4   ) & 0x01) << 13 |
        (word.charCodeAt(   i4+i8) & 0x01) << 12 |
        (word.charCodeAt(i2      ) & 0x01) << 11 |
        (word.charCodeAt(i2   +i8) & 0x01) << 10 |
        (word.charCodeAt(i2+i4   ) & 0x01) <<  9 |
        (word.charCodeAt(i2+i4+i8) & 0x01) <<  8 ,
        len
    );
};

/******************************************************************************/

LiquidDict.prototype.test = function(word) {
    var key = this.makeKey(word);
    var bucket = this.dict[key];
    if ( bucket === undefined ) {
        return false;
    }
    if ( typeof bucket === 'object' ) {
        return bucket[word] !== undefined;
    }
    if ( bucket.charAt(0) === ' ' ) {
        return bucket.indexOf(' ' + word + ' ') >= 0;
    }
    // binary search
    var len = word.length;
    var left = 0;
    // http://jsperf.com/or-vs-floor/3
    var right = ~~(bucket.length / len + 0.5);
    var i, needle;
    while ( left < right ) {
        i = left + right >> 1;
        needle = bucket.substr( len * i, len );
        if ( word < needle ) {
            right = i;
        } else if ( word > needle ) {
            left = i + 1;
        } else {
            return true;
        }
    }
    return false;
};

/******************************************************************************/

LiquidDict.prototype.add = function(word) {
    var key = this.makeKey(word);
    if ( key === undefined ) {
        return false;
    }
    var bucket = this.dict[key];
    if ( bucket === undefined ) {
        this.dict[key] = bucket = {};
        this.bucketCount += 1;
        bucket[word] = true;
        this.count += 1;
        return true;
    } else if ( typeof bucket === 'string' ) {
        this.dict[key] = bucket = meltBucket(this, word.len, bucket);
    }
    if ( bucket[word] === undefined ) {
        bucket[word] = true;
        this.count += 1;
        return true;
    }
    return false;
};

/******************************************************************************/

LiquidDict.prototype.freeze = function() {
    var buckets = this.dict;
    var bucket;
    for ( var key in buckets ) {
        bucket = buckets[key];
        if ( typeof bucket === 'object' ) {
            buckets[key] = freezeBucket(this, bucket);
        }
    }
};

/******************************************************************************/

LiquidDict.prototype.reset = function() {
    this.dict = {};
    this.count = 0;
    this.bucketCount = 0;
    this.frozenBucketCount = 0;
};

/******************************************************************************/

LiquidDict.prototype.toSelfie = function() {
    return {
        count: this.count,
        bucketCount: this.bucketCount,
        frozenBucketCount: this.frozenBucketCount,
        dict: this.dict
    };
};

/******************************************************************************/

LiquidDict.prototype.fromSelfie = function(selfie) {
    this.count = selfie.count;
    this.bucketCount = selfie.bucketCount;
    this.frozenBucketCount = selfie.frozenBucketCount;
    this.dict = selfie.dict;
};

/******************************************************************************/

return LiquidDict;

/******************************************************************************/

})();

/******************************************************************************/

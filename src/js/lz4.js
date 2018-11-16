/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018-present Raymond Hill

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

/* global lz4BlockCodec */

'use strict';

/*******************************************************************************

    Experimental support for storage compression.

    For background information on the topic, see:
    https://github.com/uBlockOrigin/uBlock-issues/issues/141#issuecomment-407737186

**/

µBlock.lz4Codec = (function() {         // >>>> Start of private namespace

/******************************************************************************/

let lz4CodecInstance;
let pendingInitialization;
let textEncoder, textDecoder;
let ttlCount = 0;
let ttlTimer;
let ttlDelay = 60000;

let init = function() {
    ttlDelay = µBlock.hiddenSettings.autoUpdateAssetFetchPeriod * 1000 + 15000;
    if ( lz4CodecInstance === null ) {
        return Promise.resolve(null);
    }
    if ( lz4CodecInstance !== undefined ) {
        return Promise.resolve(lz4CodecInstance);
    }
    if ( pendingInitialization === undefined ) {
        let flavor;
        if ( µBlock.hiddenSettings.disableWebAssembly === true ) {
            flavor = 'js';
        }
        pendingInitialization = lz4BlockCodec.createInstance(flavor)
            .then(instance => {
                lz4CodecInstance = instance;
                pendingInitialization = undefined;
            });
    }
    return pendingInitialization;
};

// We can't shrink memory usage of lz4 codec instances, and in the
// current case memory usage can grow to a significant amount given
// that a single contiguous memory buffer is required to accommodate
// both input and output data. Thus a time-to-live implementation
// which will cause the wasm instance to be forgotten after enough
// time elapse without the instance being used.

let destroy = function() {
    //if ( lz4CodecInstance !== undefined ) {
    //    console.info(
    //        'uBO: freeing lz4-block-codec instance (%s KB)',
    //        lz4CodecInstance.bytesInUse() >>> 10
    //    );
    //}
    lz4CodecInstance = undefined;
    textEncoder = textDecoder = undefined;
    ttlCount = 0;
    ttlTimer = undefined;
};

let ttlManage = function(count) {
    if ( ttlTimer !== undefined ) {
        clearTimeout(ttlTimer);
        ttlTimer = undefined;
    }
    ttlCount += count;
    if ( ttlCount > 0 ) { return; }
    if ( lz4CodecInstance === null ) { return; }
    ttlTimer = vAPI.setTimeout(destroy, ttlDelay);
};

let uint8ArrayFromBlob = function(key, data) {
    if ( data instanceof Blob === false ) {
        return Promise.resolve({ key, data });
    }
    return new Promise(resolve => {
        let blobReader = new FileReader();
        blobReader.onloadend = ev => {
            resolve({ key, data: new Uint8Array(ev.target.result) });
        };
        blobReader.readAsArrayBuffer(data);
    });
};

let encodeValue = function(key, value) {
    if ( !lz4CodecInstance ) { return; }
    //let t0 = window.performance.now();
    if ( textEncoder === undefined ) {
        textEncoder = new TextEncoder();
    }
    let inputArray = textEncoder.encode(value);
    let inputSize = inputArray.byteLength;
    let outputArray = lz4CodecInstance.encodeBlock(inputArray, 8);
    if ( outputArray instanceof Uint8Array === false ) { return; }
    outputArray[0] = 0x18;
    outputArray[1] = 0x4D;
    outputArray[2] = 0x22;
    outputArray[3] = 0x04;
    outputArray[4] = (inputSize >>>  0) & 0xFF;
    outputArray[5] = (inputSize >>>  8) & 0xFF;
    outputArray[6] = (inputSize >>> 16) & 0xFF;
    outputArray[7] = (inputSize >>> 24) & 0xFF;
    //console.info(
    //    'uBO: [%s] compressed %d KB => %d KB (%s%%) in %s ms',
    //    key,
    //    inputArray.byteLength >> 10,
    //    outputArray.byteLength >> 10,
    //    (outputArray.byteLength / inputArray.byteLength * 100).toFixed(0),
    //    (window.performance.now() - t0).toFixed(1)
    //);
    return outputArray;
};

let decodeValue = function(key, inputArray) {
    if ( !lz4CodecInstance ) { return; }
    //let t0 = window.performance.now();
    if (
        inputArray[0] !== 0x18 || inputArray[1] !== 0x4D ||
        inputArray[2] !== 0x22 || inputArray[3] !== 0x04
    ) {
        return;
    }
    let outputSize = 
        (inputArray[4] <<  0) | (inputArray[5] <<  8) |
        (inputArray[6] << 16) | (inputArray[7] << 24);
    let outputArray = lz4CodecInstance.decodeBlock(inputArray, 8, outputSize);
    if ( outputArray instanceof Uint8Array === false ) { return; }
    if ( textDecoder === undefined ) {
        textDecoder = new TextDecoder();
    }
    let value = textDecoder.decode(outputArray);
    //console.info(
    //    'uBO: [%s] decompressed %d KB => %d KB (%s%%) in %s ms',
    //    key,
    //    inputArray.byteLength >>> 10,
    //    outputSize >>> 10,
    //    (inputArray.byteLength / outputSize * 100).toFixed(0),
    //    (window.performance.now() - t0).toFixed(1)
    //);
    return value;
};

return {
    encode: function(key, dataIn) {
        if ( typeof dataIn !== 'string' || dataIn.length < 4096 ) {
            return Promise.resolve({ key, data: dataIn });
        }
        ttlManage(1);
        return init().then(( ) => {
            ttlManage(-1);
            let dataOut = encodeValue(key, dataIn) || dataIn;
            if ( dataOut instanceof Uint8Array ) {
                dataOut = new Blob([ dataOut ]);
            }
            return { key, data: dataOut || dataIn };
        });
    },
    decode: function(key, dataIn) {
        if ( dataIn instanceof Blob === false ) {
            return Promise.resolve({ key, data: dataIn });
        }
        ttlManage(1);
        return Promise.all([
            init(),
            uint8ArrayFromBlob(key, dataIn)
        ]).then(results => {
            ttlManage(-1);
            let result = results[1];
            return {
                key: result.key,
                data: decodeValue(result.key, result.data) || result.data
            };
        });
    }
};

/******************************************************************************/

})();                                   // <<<< End of private namespace

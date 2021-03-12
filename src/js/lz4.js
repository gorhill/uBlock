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

{
// >>>> Start of private namespace

/******************************************************************************/

let lz4CodecInstance;
let pendingInitialization;
let textEncoder, textDecoder;
let ttlCount = 0;
let ttlTimer;
let ttlDelay = 60000;

const init = function() {
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

const destroy = function() {
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

const ttlManage = function(count) {
    if ( ttlTimer !== undefined ) {
        clearTimeout(ttlTimer);
        ttlTimer = undefined;
    }
    ttlCount += count;
    if ( ttlCount > 0 ) { return; }
    if ( lz4CodecInstance === null ) { return; }
    ttlTimer = vAPI.setTimeout(destroy, ttlDelay);
};

const encodeValue = function(dataIn) {
    if ( !lz4CodecInstance ) { return; }
    //let t0 = window.performance.now();
    if ( textEncoder === undefined ) {
        textEncoder = new TextEncoder();
    }
    const inputArray = textEncoder.encode(dataIn);
    const inputSize = inputArray.byteLength;
    const outputArray = lz4CodecInstance.encodeBlock(inputArray, 8);
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
    //    inputArray.byteLength >> 10,
    //    outputArray.byteLength >> 10,
    //    (outputArray.byteLength / inputArray.byteLength * 100).toFixed(0),
    //    (window.performance.now() - t0).toFixed(1)
    //);
    return outputArray;
};

const decodeValue = function(inputArray) {
    if ( !lz4CodecInstance ) { return; }
    //let t0 = window.performance.now();
    if (
        inputArray[0] !== 0x18 || inputArray[1] !== 0x4D ||
        inputArray[2] !== 0x22 || inputArray[3] !== 0x04
    ) {
        console.error('decodeValue: invalid input array');
        return;
    }
    const outputSize = 
        (inputArray[4] <<  0) | (inputArray[5] <<  8) |
        (inputArray[6] << 16) | (inputArray[7] << 24);
    const outputArray = lz4CodecInstance.decodeBlock(inputArray, 8, outputSize);
    if ( outputArray instanceof Uint8Array === false ) { return; }
    if ( textDecoder === undefined ) {
        textDecoder = new TextDecoder();
    }
    const s = textDecoder.decode(outputArray);
    //console.info(
    //    'uBO: [%s] decompressed %d KB => %d KB (%s%%) in %s ms',
    //    inputArray.byteLength >>> 10,
    //    outputSize >>> 10,
    //    (inputArray.byteLength / outputSize * 100).toFixed(0),
    //    (window.performance.now() - t0).toFixed(1)
    //);
    return s;
};

µBlock.lz4Codec = {
    // Arguments:
    //   dataIn: must be a string
    // Returns:
    //   A Uint8Array, or the input string as is if compression is not
    //   possible.
    encode: async function(dataIn, serialize = undefined) {
        if ( typeof dataIn !== 'string' || dataIn.length < 4096 ) {
            return dataIn;
        }
        ttlManage(1);
        await init();
        let dataOut = encodeValue(dataIn);
        ttlManage(-1);
        if ( serialize instanceof Function ) {
            dataOut = await serialize(dataOut);
        }
        return dataOut || dataIn;
    },
    // Arguments:
    //   dataIn: must be a Uint8Array
    // Returns:
    //   A string, or the input argument as is if decompression is not
    //   possible.
    decode: async function(dataIn, deserialize = undefined) {
        if ( deserialize instanceof Function ) {
            dataIn = await deserialize(dataIn);
        }
        if ( dataIn instanceof Uint8Array === false ) {
            return dataIn;
        }
        ttlManage(1);
        await init();
        const dataOut = decodeValue(dataIn);
        ttlManage(-1);
        return dataOut || dataIn;
    },
    relinquish: function() {
        ttlDelay = 1;
        ttlManage(0);
    },
};

/******************************************************************************/

// <<<< End of private namespace
}

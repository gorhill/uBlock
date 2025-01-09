/*******************************************************************************
 * 
 * A simple demo to quickly get started.
 * 
 * Command line:
 * 
 *   mkdir myproject
 *   cd myproject
 *   npm install @gorhill/ubo-core
 *   cp node_modules/@gorhill/ubo-core/demo.js .
 * 
 * There will be a `demo.js` file in your `myproject` folder, which you can
 * modify and execute:
 * 
 *   node demo.js
 * 
 * Since the demo here uses ES module syntax, you may want to add the following
 * to the generated package.json file to avoid the warning:
 * 
 *  "type": "module",
 * 
 * The demo will fetch filter lists from EasyList server, then serialize the
 * content of the static network filtering engine into a local `./cache/`
 * folder.
 * 
 * The serialized data will be reused if available in order to avoid fetching
 * from remote server each time it is executed.
 * 
 * This demo is kept as simple as possible, so there is not a lot of error
 * handling.
 * 
 * */

import { StaticNetFilteringEngine } from '@gorhill/ubo-core';
import fs from 'fs/promises';

/******************************************************************************/

async function fetchList(name, url) {
    return fetch(url).then(r => {
        return r.text();
    }).then(raw => {
        console.log(`${name} fetched`);
        return { name, raw };
    }).catch(reason => {
        console.error(reason);
    });
}

async function main() {
    const pathToSelfie = 'cache/selfie.txt';

    const snfe = await StaticNetFilteringEngine.create();

    // Up to date serialization data (aka selfie) available?
    let selfie;
    const ageInDays = await fs.stat(pathToSelfie).then(stat => {
        const fileDate = new Date(stat.mtime);
        return (Date.now() - fileDate.getTime()) / (7 * 24 * 60 * 60);
    }).catch(( ) => Number.MAX_SAFE_INTEGER);

    // Use a selfie if available and not older than 7 days
    if ( ageInDays <= 7 ) {
        selfie = await fs.readFile(pathToSelfie, { encoding: 'utf8' })
            .then(data => typeof data === 'string' && data !== '' && data)
            .catch(( ) => { });
        if ( typeof selfie === 'string' ) {
            await snfe.deserialize(selfie);
        }
    }

    // Fetch filter lists if no up to date selfie available
    if ( !selfie ) {
        console.log(`Fetching lists...`);
        await snfe.useLists([
            fetchList('ubo-ads', 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt'),
            fetchList('ubo-badware', 'https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt'),
            fetchList('ubo-privacy', 'https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt'),
            fetchList('ubo-unbreak', 'https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt'),
            fetchList('ubo-quick', 'https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt'),
            fetchList('easylist', 'https://easylist.to/easylist/easylist.txt'),
            fetchList('easyprivacy', 'https://easylist.to/easylist/easyprivacy.txt'),
            fetchList('plowe', 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext'),
        ]);
        const selfie = await snfe.serialize();
        await fs.mkdir('cache', { recursive: true });
        await fs.writeFile(pathToSelfie, selfie);
    }

    // List of tests to perform
    const tests = [
        {
            originURL: 'https://www.bloomberg.com/',
            url: 'https://www.google-analytics.com/gs.js',
            type: 'script',
        }, {
            originURL: 'https://www.bloomberg.com/',
            url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
            type: 'script',
        }, {
            originURL: 'https://www.bloomberg.com/',
            url: 'https://bloomberg.com/main.css',
            type: 'stylesheet',
        }
    ];

    // Test each entry for a match against the content of the engine
    for ( const test of tests ) {
        console.log('\nRequest details:', test);
        const r = snfe.matchRequest(test);
        if ( r === 1 ) { // Blocked
            console.log('Blocked:', snfe.toLogData());
        } else if ( r === 2 ) { // Unblocked
            console.log('Unblocked:', snfe.toLogData());
        } else { // Not blocked
            console.log('Not blocked');
        }
    }
}

main();

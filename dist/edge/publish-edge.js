/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

import * as fs from 'node:fs/promises';
import * as ghapi from '../github-api.js';
import path from 'node:path';
import process from 'node:process';

/******************************************************************************/

const githubAuth = `Bearer ${process.env.GITHUB_TOKEN}`;
const commandLineArgs = ghapi.commandLineArgs;
const githubOwner = commandLineArgs.ghowner;
const githubRepo = commandLineArgs.ghrepo;
const githubTag = commandLineArgs.ghtag;
const edgeId = commandLineArgs.edgeid;

/******************************************************************************/

async function sleep(seconds) {
    return new Promise(resolve => {
        setTimeout(resolve, seconds * 1000);
    });
}

/******************************************************************************/

async function publishToEdgeStore(filePath) {
    const edgeApiKey = process.env.EDGE_APIKEY;
    const edgeClientId = process.env.EDGE_CLIENTID;
    const uploadURL = `https://api.addons.microsoftedge.microsoft.com/v1/products/${edgeId}/submissions/draft/package`;

    // Read package
    const data = await fs.readFile(filePath);

    // Upload
    console.log(`Uploading package to ${uploadURL}`);
    const uploadRequest = new Request(uploadURL, {
        body: data,
        headers: {
            'Authorization': `ApiKey ${edgeApiKey}`,
            'X-ClientID': edgeClientId,
            'Content-Type': 'application/zip'
        },
        method: 'POST',
    });
    const uploadResponse = await fetch(uploadRequest);
    if ( uploadResponse.status !== 202 ) {
        console.log(`Upload failed -- server error ${uploadResponse.status}`);
        process.exit(1);
    }
    const operationId = uploadResponse.headers.get('Location');
    if ( operationId === undefined ) {
        console.log(`Upload failed -- missing Location header`);
        process.exit(1);
    }
    console.log(`Upload succeeded`);

    // Check upload status
    console.log('Checking upload status...');
    const interval = 60; //  check every 60 seconds
    let countdown = 60 * 60 / interval; // for at most 60 minutes
    for (;;) {
        await sleep(interval);
        countdown -= 1
        if ( countdown <= 0 ) {
            console.log('Error: Microsoft store timed out')
            process.exit(1);
        }
        const uploadStatusRequest = new Request(`${uploadURL}/operations/${operationId}`, {
            headers: {
                'Authorization': `ApiKey ${edgeApiKey}`,
                'X-ClientID': edgeClientId,
            },
        });
        const uploadStatusResponse = await fetch(uploadStatusRequest);
        if ( uploadStatusResponse.status !== 200 ) {
            console.log(`Upload status check failed -- server error ${uploadStatusResponse.status}`);
            process.exit(1);
        }
        const uploadStatusDict = await uploadStatusResponse.json();
        const { status } = uploadStatusDict;
        if ( status === undefined || status === 'Failed' ) {
            console.log(`Upload status check failed -- server error ${status}`);
            process.exit(1);
        }
        if ( status === 'InProgress' ) { continue }
        console.log('Package ready to be published.')
        break;
    }

    // Publish
    // https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/update/api/addons-api-reference?tabs=v1-1#publish-the-product-draft-submission
    console.log('Publish package...')
    const publishURL = `https://api.addons.microsoftedge.microsoft.com/v1/products/${edgeId}/submissions`;
    const publishNotes = {
        'Notes': 'See official release notes at <https://github.com/gorhill/uBlock/releases>'
    }
    const publishRequest = new Request(publishURL, {
        body: JSON.stringify(publishNotes),
        headers: {
            'Authorization': `ApiKey ${edgeApiKey}`,
            'X-ClientID': edgeClientId,
        },
        method: 'POST',
    });
    const publishResponse = await fetch(publishRequest);
    if ( publishResponse.status !== 202 ) {
        console.log(`Publish failed -- server error ${publishResponse.status}`);
        process.exit(1);
    }
    if ( publishResponse.headers.get('Location') === undefined ) {
        console.log(`Publish failed -- missing Location header`);
        process.exit(1);
    }
    console.log('Publish succeeded.')
}

/******************************************************************************/

async function main() {
    if ( githubOwner === '' ) { return 'Need GitHub owner'; }
    if ( githubRepo === '' ) { return 'Need GitHub repo'; }

    ghapi.setGithubContext(githubOwner, githubRepo, githubTag, githubAuth);

    const assetInfo = await ghapi.getAssetInfo('edge');

    console.log(`GitHub owner: "${githubOwner}"`);
    console.log(`GitHub repo: "${githubRepo}"`);
    console.log(`Release tag: "${githubTag}"`);
    console.log(`Release asset: "${assetInfo.name}"`);

    // Fetch asset from GitHub repo
    const filePath = await ghapi.downloadAssetFromRelease(assetInfo);
    console.log('Asset saved at', filePath);

    // Upload to Edge Store
    await publishToEdgeStore(filePath);

    // Clean up
    if ( commandLineArgs.keep !== true ) {
        const tmpdir = path.dirname(filePath);
        console.log(`Removing ${tmpdir}`);
        ghapi.shellExec(`rm -rf "${tmpdir}"`);
    }

    console.log('Done');
}

main().then(result => {
    if ( result !== undefined ) {
        console.log(result);
        process.exit(1);
    }
    process.exit(0);
});

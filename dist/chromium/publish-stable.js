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

const secrets = await ghapi.getSecrets();
const githubAuth = `Bearer ${secrets.github_token}`;
const commandLineArgs = ghapi.commandLineArgs;
const githubOwner = commandLineArgs.ghowner;
const githubRepo = commandLineArgs.ghrepo;
const githubTag = commandLineArgs.ghtag;
const cwsId = commandLineArgs.cwsid;

/******************************************************************************/

async function publishToCWS(filePath) {
    // Prepare access token
    console.log('Generating access token...');
    const authURL = 'https://accounts.google.com/o/oauth2/token';
    const authRequest = new Request(authURL, {
        body: JSON.stringify({
            client_id: secrets.cs_id,
            client_secret: secrets.cs_secret,
            grant_type: 'refresh_token',
            refresh_token: secrets.cs_refresh,
        }),
        method: 'POST',
    });
    const authResponse = await fetch(authRequest);
    if ( authResponse.ok === false ) {
        console.error(`Error: Auth failed -- server error ${authResponse.statusText}`);
        process.exit(1);
    }
    const responseDict = await authResponse.json()
    if ( responseDict.access_token === undefined ) {
        console.error('Error: Auth failed -- no access token');
        console.error('Error: Auth failed --', JSON.stringify(responseDict, null, 2));
        process.exit(1);
    }
    const cwsAuth = `Bearer ${responseDict.access_token}`;
    if ( responseDict.refresh_token ) {
        secrets.cs_refresh = responseDict.refresh_token
    }

    // Read package
    const data = await fs.readFile(filePath);

    // Upload
    console.log('Uploading package...')
    const uploadURL = `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${cwsId}`;
    const uploadRequest = new Request(uploadURL, {
        body: data,
        headers: {
            'Authorization': cwsAuth,
            'x-goog-api-version': '2',
        },
        method: 'PUT',
    });
    const uploadResponse = await fetch(uploadRequest);
    if ( uploadResponse.ok === false ) {
        console.error(`Upload failed -- server error ${uploadResponse.statusText}`);
        process.exit(1)
    }
    const uploadDict = await uploadResponse.json();
    if ( uploadDict.uploadState !== 'SUCCESS' ) {
        console.error(`Upload failed -- server error ${uploadDict['uploadState']}`);
        process.exit(1);
    }
    console.log('Upload succeeded.')

    // Publish
    console.log('Publishing package...')
    const publishURL = `https://www.googleapis.com/chromewebstore/v1.1/items/${cwsId}/publish`;
    const publishRequest = new Request(publishURL, {
        headers: {
            'Authorization': cwsAuth,
            'x-goog-api-version': '2',
            'Content-Length': '0',
        },
        method: 'POST',
    });
    const publishResponse = await fetch(publishRequest);
    if ( publishResponse.ok === false ) {
        console.error(`Error: Chrome store publishing failed -- server error ${publishResponse.statusText}`);
        process.exit(1);
    }
    const publishDict = await publishResponse.json();
    if (
        Array.isArray(publishDict.status) === false ||
        publishDict.status.includes('OK') === false
    ) {
        console.error(`Publishing failed -- server error ${publishDict.status}`);
        process.exit(1);
    }
    console.log('Publishing succeeded.')
}

/******************************************************************************/

async function main() {
    if ( secrets === undefined ) { return 'Need secrets'; }
    if ( githubOwner === '' ) { return 'Need GitHub owner'; }
    if ( githubRepo === '' ) { return 'Need GitHub repo'; }

    ghapi.setGithubContext(githubOwner, githubRepo, githubTag, githubAuth);

    const assetInfo = await ghapi.getAssetInfo('chromium');

    console.log(`GitHub owner: "${githubOwner}"`);
    console.log(`GitHub repo: "${githubRepo}"`);
    console.log(`Release tag: "${githubTag}"`);
    console.log(`Release asset: "${assetInfo.name}"`);

    // Fetch asset from GitHub repo
    const filePath = await ghapi.downloadAssetFromRelease(assetInfo);
    console.log('Asset saved at', filePath);

    // Upload to Chrome Web Store
    await publishToCWS(filePath);

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

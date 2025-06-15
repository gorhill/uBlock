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
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/******************************************************************************/

function voidFunc() {
}

/******************************************************************************/

let githubOwner = '';
let githubRepo = '';
let githubTag = '';
let githubAuth = '';

export function setGithubContext(owner, repo, tag, auth) {
    githubOwner = owner;
    githubRepo = repo;
    githubTag = tag;
    githubAuth = auth;
}

/******************************************************************************/

let pathToSecrets = '';

export async function getSecrets() {
    const homeDir = os.homedir();
    let currentDir = process.cwd();
    let fileName = '';
    for (;;) {
        fileName = `${currentDir}/ubo_secrets`;
        const stat = await fs.stat(fileName).catch(voidFunc);
        if ( stat !== undefined ) { break; }
        currentDir = path.resolve(currentDir, '..');
        if ( currentDir.startsWith(homeDir) === false ) {
            pathToSecrets = homeDir;
            return;
        }
    }
    console.log(`Found secrets in ${fileName}`);
    const text = await fs.readFile(fileName, { encoding: 'utf8' }).catch(voidFunc);
    if ( text === undefined ) { return {}; }
    const secrets = JSON.parse(text);
    pathToSecrets = fileName;
    return secrets;
}

export async function saveSecrets(secrets) {
    if ( pathToSecrets === '' ) { return; }
    return fs.writeFile(pathToSecrets, JSON.stringify(secrets, null, 2));
}

/******************************************************************************/

export async function getRepoRoot() {
    const homeDir = os.homedir();
    let currentDir = process.cwd();
    for (;;) {
        const fileName = `${currentDir}/.git`;
        const stat = await fs.stat(fileName).catch(voidFunc);
        if ( stat !== undefined ) { return currentDir; }
        currentDir = path.resolve(currentDir, '..');
        if ( currentDir.startsWith(homeDir) === false ) { return; }
    }
}

/******************************************************************************/

export async function getReleaseInfo() {
    console.log(`Fetching release info for ${githubOwner}/${githubRepo}/${githubTag} from GitHub`);
    const releaseInfoUrl =  `https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/tags/${githubTag}`;
    const request = new Request(releaseInfoUrl, {
        headers: {
            Authorization: githubAuth,
        },
    });
    const response = await fetch(request).catch(voidFunc);
    if ( response === undefined ) { return; }
    if ( response.ok !== true ) { return; }
    const releaseInfo = await response.json().catch(voidFunc);
    if ( releaseInfo === undefined ) { return; }
    return releaseInfo;
}

/******************************************************************************/

export async function getAssetInfo(assetName) {
    const releaseInfo = await getReleaseInfo();
    if ( releaseInfo === undefined ) { return; }
    if ( releaseInfo.assets === undefined ) { return; }
    for ( const asset of releaseInfo.assets ) {
        if ( asset.name.includes(assetName) ) { return asset; }
    }
}

/******************************************************************************/

export async function downloadAssetFromRelease(assetInfo) {
    const assetURL = assetInfo.url;
    console.log(`Fetching ${assetURL}`);
    const request = new Request(assetURL, {
        headers: {
            Authorization: githubAuth,
            Accept: 'application/octet-stream',
        },
    });
    const response = await fetch(request).catch(voidFunc);
    if ( response.ok !== true ) { return; }
    const data = await response.bytes().catch(voidFunc);
    if ( data === undefined ) { return; }
    const tempDir = await fs.mkdtemp('/tmp/github-asset-');
    const fileName = `${tempDir}/${assetInfo.name}`;
    await fs.writeFile(fileName, data);
    return fileName;
}

/******************************************************************************/

export async function uploadAssetToRelease(assetPath, mimeType) {
    console.log(`Uploading "${assetPath}" to GitHub...`);
    const data = await fs.readFile(assetPath).catch(( ) => { });
    if ( data === undefined ) { return; }
    const releaseInfo = await getReleaseInfo();
    if ( releaseInfo.upload_url === undefined ) { return; }
    const assetName = path.basename(assetPath);
    const uploadURL = releaseInfo.upload_url.replace('{?name,label}', `?name=${assetName}`);
    console.log('Upload URL:', uploadURL);
    const request = new Request(uploadURL, {
        body: new Int8Array(data.buffer, data.byteOffset, data.length),
        headers: {
            Authorization: githubAuth,
            'Content-Type': mimeType,
        },
        method: 'POST',
    });
    const response = await fetch(request).catch(( ) => { });
    if ( response === undefined ) { return; }
    const json = await response.json();
    console.log(json);
    return json;
}

/******************************************************************************/

export async function deleteAssetFromRelease(assetURL) {
    print(`Remove ${assetURL} from GitHub release ${githubTag}...`);
    const request = new Request(assetURL, {
        headers: {
            Authorization: githubAuth,
        },
        method: 'DELETE',
    });
    const response = await fetch(request);
    return response.ok;
}

/******************************************************************************/

export async function getManifest(path) {
    const text = await fs.readFile(path, { encoding: 'utf8' });
    return JSON.parse(text);
}

/******************************************************************************/

export async function shellExec(text) {
    let command = '';
    for ( const line of text.split(/[\n\r]+/) ) {
        command += line.trimEnd();
        if ( command.endsWith('\\') ) {
            command = command.slice(0, -1);
            continue;
        }
        command = command.trim();
        if ( command === '' ) { continue; }
        execSync(command);
        command = '';
    }
}

/******************************************************************************/

export const commandLineArgs = (( ) => {
    const args = Object.create(null);
    let name, value;
    for ( const arg of process.argv.slice(2) ) {
        const pos = arg.indexOf('=');
        if ( pos === -1 ) {
            name = arg;
            value = true;
        } else {
            name = arg.slice(0, pos);
            value = arg.slice(pos+1);
        }
        args[name] = value;
    }
    return args;
})();

#!/usr/bin/env python3

import datetime
import json
import jwt
import os
import re
import requests
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

from string import Template

# - Download target (raw) uBlock0.firefox.xpi from GitHub
#   - This is referred to as "raw" package
#   - This will fail if not a dev build
# - Modify raw package to make it self-hosted
#   - This is referred to as "unsigned" package
# - Ask AMO to sign uBlock0.firefox.xpi
#   - Generate JWT to be used for communication with server
#   - Upload unsigned package to AMO
#   - Wait for a valid download URL for signed package
#   - Download signed package as uBlock0.firefox.signed.xpi
#     - This is referred to as "signed" package
# - Upload uBlock0.firefox.signed.xpi to GitHub
# - Remove uBlock0.firefox.xpi from GitHub
# - Modify updates.json to point to new version
#   - Commit changes to repo

# Find path to project root
projdir = os.path.split(os.path.abspath(__file__))[0]
while not os.path.isdir(os.path.join(projdir, '.git')):
    projdir = os.path.normpath(os.path.join(projdir, '..'))
# Check that found project root is valid
version_filepath = os.path.join(projdir, 'dist', 'version')
if not os.path.isfile(version_filepath):
    print('Version file not found.')
    exit(1)

# We need a version string to work with
if len(sys.argv) >= 2 and sys.argv[1]:
    tag_version = sys.argv[1]
else:
    tag_version = input('Github release version: ')
tag_version.strip()
match = re.search('^uBOLite_(\d+\.\d+\.\d+.\d+)$', tag_version)
if not match:
    print('Error: Invalid version string.')
    exit(1)
ext_version = match.group(1);

extension_id = 'uBOLite@raymondhill.net'
tmpdir = tempfile.TemporaryDirectory()
raw_xpi_filename = tag_version + '.firefox.mv3.xpi'
raw_xpi_filepath = os.path.join(tmpdir.name, raw_xpi_filename)
unsigned_xpi_filepath = os.path.join(tmpdir.name, 'uBOLite.firefox.unsigned.xpi')
signed_xpi_filename = tag_version + '.firefox.signed.mv3.xpi'
signed_xpi_filepath = os.path.join(tmpdir.name, signed_xpi_filename)
github_owner = 'gorhill'
github_repo = 'uBlock'

# Load/save auth secrets
# The tmp directory is excluded from git
ubo_secrets = dict()
ubo_secrets_filename = os.path.join(projdir, 'tmp', 'ubo_secrets')
if os.path.isfile(ubo_secrets_filename):
    with open(ubo_secrets_filename) as f:
        ubo_secrets = json.load(f)

def input_secret(prompt, token):
    if token in ubo_secrets:
        prompt += ' ✔'
    prompt += ': '
    value = input(prompt).strip()
    if len(value) == 0:
        if token not in ubo_secrets:
            print('Token error:', token)
            exit(1)
        value = ubo_secrets[token]
    elif token not in ubo_secrets or value != ubo_secrets[token]:
        ubo_secrets[token] = value
        exists = os.path.isfile(ubo_secrets_filename)
        with open(ubo_secrets_filename, 'w') as f:
            json.dump(ubo_secrets, f, indent=2)
        if not exists:
            os.chmod(ubo_secrets_filename, 0o600)
    return value

# GitHub API token
github_token = input_secret('Github token', 'github_token')
github_auth = 'token ' + github_token

#
# Get metadata from GitHub about the release
#

# https://developer.github.com/v3/repos/releases/#get-a-single-release
print('Downloading release info from GitHub...')
release_info_url = 'https://api.github.com/repos/{0}/{1}/releases/tags/{2}'.format(github_owner, github_repo, tag_version)
headers = { 'Authorization': github_auth, }
response = requests.get(release_info_url, headers=headers)
if response.status_code != 200:
    print('Error: Release not found: {0}'.format(response.status_code))
    exit(1)
release_info = response.json()

#
# Extract URL to raw package from metadata
#

# Find url for uBlock0.firefox.xpi
raw_xpi_url = ''
for asset in release_info['assets']:
    if asset['name'] == signed_xpi_filename:
        print('Error: Found existing signed self-hosted package.')
        exit(1)
    if asset['name'] == raw_xpi_filename:
        raw_xpi_url = asset['url']
if len(raw_xpi_url) == 0:
    print('Error: Release asset URL not found')
    exit(1)

#
# Download raw package from GitHub
#

# https://developer.github.com/v3/repos/releases/#get-a-single-release-asset
print('Downloading raw xpi package from GitHub...')
headers = {
    'Authorization': github_auth,
    'Accept': 'application/octet-stream',
}
response = requests.get(raw_xpi_url, headers=headers)
# Redirections are transparently handled:
# http://docs.python-requests.org/en/master/user/quickstart/#redirection-and-history
if response.status_code != 200:
    print('Error: Downloading raw package failed -- server error {0}'.format(response.status_code))
    exit(1)
with open(raw_xpi_filepath, 'wb') as f:
    f.write(response.content)
print('Downloaded raw package saved as {0}'.format(raw_xpi_filepath))

#
# Convert the package to a self-hosted one: add `update_url` to the manifest
#
min_browser_version = '114.0';

print('Converting raw xpi package into self-hosted xpi package...')
with zipfile.ZipFile(raw_xpi_filepath, 'r') as zipin:
    with zipfile.ZipFile(unsigned_xpi_filepath, 'w') as zipout:
        for item in zipin.infolist():
            data = zipin.read(item.filename)
            if item.filename == 'manifest.json':
                manifest = json.loads(bytes.decode(data))
                min_browser_version = manifest['browser_specific_settings']['gecko']['strict_min_version']
                manifest['browser_specific_settings']['gecko']['update_url'] = 'https://raw.githubusercontent.com/{0}/{1}/master/dist/mv3/firefox/updates.json'.format(github_owner, github_repo)
                data = json.dumps(manifest, indent=2, separators=(',', ': '), sort_keys=True).encode()
            zipout.writestr(item, data)

#
# Ask AMO to sign the self-hosted package
# - https://developer.mozilla.org/en-US/Add-ons/Distribution#Distributing_your_add-on
# - https://pyjwt.readthedocs.io/en/latest/usage.html
# - https://addons-server.readthedocs.io/en/latest/topics/api/auth.html
# - https://addons-server.readthedocs.io/en/latest/topics/api/signing.html
#

amo_api_key = ''
amo_secret = ''

def get_jwt_auth():
    global amo_api_key
    if amo_api_key == '':
        amo_api_key = input_secret('AMO API key', 'amo_api_key')
    global amo_secret
    if amo_secret == '':
        amo_secret = input_secret('AMO API secret', 'amo_secret')
    amo_nonce = os.urandom(8).hex()
    jwt_payload = {
        'iss': amo_api_key,
        'jti': amo_nonce,
        'iat': datetime.datetime.utcnow(),
        'exp': datetime.datetime.utcnow() + datetime.timedelta(seconds=15),
    }
    return 'JWT ' + jwt.encode(jwt_payload, amo_secret)

print('Ask AMO to sign self-hosted xpi package...')
with open(unsigned_xpi_filepath, 'rb') as f:
    # https://blog.mozilla.org/addons/2019/11/11/security-improvements-in-amo-upload-tools/
    #   "We recommend allowing up to 15 minutes."
    interval = 60                   # check every 60 seconds
    countdown = 60 * 60 / interval  # for at most 60 minutes
    headers = { 'Authorization': get_jwt_auth(), }
    data = { 'channel': 'unlisted' }
    files = { 'upload': f, }
    signing_url = 'https://addons.mozilla.org/api/v4/addons/{0}/versions/{1}/'.format(extension_id, ext_version)
    print('Submitting package to be signed...')
    response = requests.put(signing_url, headers=headers, data=data, files=files)
    if response.status_code != 202:
        print('Error: Creating new version failed -- server error {0}'.format(response.status_code))
        print(response.text)
        exit(1)
    print('Request for signing self-hosted xpi package succeeded.')
    signing_request_response = response.json();
    f.close()
    print('Waiting for AMO to process the request to sign the self-hosted xpi package...')
    # Wait for signed package to be ready
    signing_check_url = signing_request_response['url']
    while True:
        time.sleep(interval)
        sys.stdout.write('.')
        sys.stdout.flush()
        countdown -= 1
        if countdown <= 0:
            print('Error: AMO signing timed out')
            exit(1)
        headers = { 'Authorization': get_jwt_auth(), }
        response = requests.get(signing_check_url, headers=headers)
        if response.status_code != 200:
            print('Error: AMO signing failed -- server error {0}'.format(response.status_code))
            print(response.text)
            exit(1)
        signing_check_response = response.json()
        if not signing_check_response['processed']:
            continue
        if not signing_check_response['valid']:
            print('Error: AMO validation failed')
            print(response.text)
            exit(1)
        if not signing_check_response['files'] or len(signing_check_response['files']) == 0:
            continue
        if not signing_check_response['files'][0]['signed']:
            continue
        if not signing_check_response['files'][0]['download_url']:
            print('Error: AMO signing failed')
            print(response.text)
            exit(1)
        print('\r')
        print('Self-hosted xpi package successfully signed.')
        download_url = signing_check_response['files'][0]['download_url']
        print('Downloading signed self-hosted xpi package from {0}...'.format(download_url))
        response = requests.get(download_url, headers=headers)
        if response.status_code != 200:
            print('Error: Download signed package failed -- server error {0}'.format(response.status_code))
            print(response.text)
            exit(1)
        with open(signed_xpi_filepath, 'wb') as f:
            f.write(response.content)
            f.close()
        print('Signed self-hosted xpi package downloaded.')
        break

#
# Upload signed package to GitHub
#

# https://developer.github.com/v3/repos/releases/#upload-a-release-asset
print('Uploading signed self-hosted xpi package to GitHub...')
with open(signed_xpi_filepath, 'rb') as f:
    url = release_info['upload_url'].replace('{?name,label}', '?name=' + signed_xpi_filename)
    headers = {
        'Authorization': github_auth,
        'Content-Type': 'application/zip',
    }
    response = requests.post(url, headers=headers, data=f.read())
    if response.status_code != 201:
        print('Error: Upload signed package failed -- server error: {0}'.format(response.status_code))
        exit(1)

#
# Remove raw package from GitHub
#

# https://developer.github.com/v3/repos/releases/#delete-a-release-asset
print('Remove raw xpi package from GitHub...')
headers = { 'Authorization': github_auth, }
response = requests.delete(raw_xpi_url, headers=headers)
if response.status_code != 204:
    print('Error: Deletion of raw package failed -- server error: {0}'.format(response.status_code))

#
# Update updates.json to point to new package -- but only if just-signed
# package is higher version than current one.
#

# Be sure we are in sync with potentially modified files on remote
r = subprocess.run(['git', 'pull', 'origin', 'master'], stdout=subprocess.PIPE)
rout = bytes.decode(r.stdout).strip()

def int_from_version(version):
    parts = version.split('.')
    if len(parts) == 3:
        parts.append('0')
    return int(parts[0])*10e9 + int(parts[1])*10e6 + int(parts[2])*10e3 + int(parts[3])

print('Update GitHub to point to newly signed self-hosted xpi package...')
updates_json_filepath = os.path.join(projdir, 'dist', 'mv3', 'firefox', 'updates.json')
with open(updates_json_filepath) as f:
    updates_json = json.load(f)
    f.close()
    previous_version = updates_json['addons'][extension_id]['updates'][0]['version']
    if int_from_version(ext_version) > int_from_version(previous_version):
        with open(os.path.join(projdir, 'dist', 'mv3', 'firefox', 'updates.template.json')) as f:
            template_json = Template(f.read())
            f.close()
            updates_json = template_json.substitute(ext_version=ext_version, tag_version=tag_version, min_browser_version=min_browser_version)
            with open(updates_json_filepath, 'w') as f:
                f.write(updates_json)
                f.close()
        # - Stage the changed file
        r = subprocess.run(['git', 'status', '-s', updates_json_filepath], stdout=subprocess.PIPE)
        rout = bytes.decode(r.stdout).strip()
        if len(rout) >= 2 and rout[1] == 'M':
            subprocess.run(['git', 'add', updates_json_filepath])
        # - Commit the staged file
        r = subprocess.run(['git', 'status', '-s', updates_json_filepath], stdout=subprocess.PIPE)
        rout = bytes.decode(r.stdout).strip()
        if len(rout) >= 2 and rout[0] == 'M':
            subprocess.run(['git', 'commit', '-m', 'Make Firefox dev build auto-update', updates_json_filepath])
            subprocess.run(['git', 'push', 'origin', 'HEAD'])

print('All done.')

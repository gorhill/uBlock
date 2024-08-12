#!/usr/bin/env python3

import datetime
import json
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

# - Download target (raw) uBlock0.chromium.zip from GitHub
#   - This is referred to as "raw" package
#   - This will fail if not a dev build
# - Upload uBlock0.chromium.zip to Chrome store
# - Publish uBlock0.chromium.zip to Chrome store

# Find path to project root
projdir = os.path.split(os.path.abspath(__file__))[0]
while not os.path.isdir(os.path.join(projdir, '.git')):
    projdir = os.path.normpath(os.path.join(projdir, '..'))

# We need a version string to work with
if len(sys.argv) >= 2 and sys.argv[1]:
    version = sys.argv[1]
else:
    version = input('Github release version: ')
version.strip()
if not re.search('^\d+\.\d+\.\d+$', version):
    print('Error: Invalid version string.')
    exit(1)

cs_extension_id = 'cjpalhdlnbpafiamejdnhcphjbkeiagm'
tmpdir = tempfile.TemporaryDirectory()
raw_zip_filename = 'uBlock0_' + version + '.chromium.zip'
raw_zip_filepath = os.path.join(tmpdir.name, raw_zip_filename)
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
release_info_url = 'https://api.github.com/repos/{0}/{1}/releases/tags/{2}'.format(github_owner, github_repo, version)
headers = { 'Authorization': github_auth, }
response = requests.get(release_info_url, headers=headers)
if response.status_code != 200:
    print('Error: Release not found: {0}'.format(response.status_code))
    exit(1)
release_info = response.json()

#
# Extract URL to raw package from metadata
#

# Find url for uBlock0.chromium.zip
raw_zip_url = ''
for asset in release_info['assets']:
    if asset['name'] == raw_zip_filename:
        raw_zip_url = asset['url']
if len(raw_zip_url) == 0:
    print('Error: Release asset URL not found')
    exit(1)

#
# Download raw package from GitHub
#

# https://developer.github.com/v3/repos/releases/#get-a-single-release-asset
print('Downloading raw zip package from GitHub...')
headers = {
    'Authorization': github_auth,
    'Accept': 'application/octet-stream',
}
response = requests.get(raw_zip_url, headers=headers)
# Redirections are transparently handled:
# http://docs.python-requests.org/en/master/user/quickstart/#redirection-and-history
if response.status_code != 200:
    print('Error: Downloading raw package failed -- server error {0}'.format(response.status_code))
    exit(1)
with open(raw_zip_filepath, 'wb') as f:
    f.write(response.content)
print('Downloaded raw package saved as {0}'.format(raw_zip_filepath))

#
# Upload to Chrome store
#

# Auth tokens
cs_id = input_secret('Chrome store id', 'cs_id')
cs_secret = input_secret('Chrome store secret', 'cs_secret')
cs_refresh = input_secret('Chrome store refresh token', 'cs_refresh')

print('Uploading to Chrome store...')
with open(raw_zip_filepath, 'rb') as f:
    print('Generating access token...')
    auth_url = 'https://accounts.google.com/o/oauth2/token'
    auth_payload = {
        'client_id': cs_id,
        'client_secret': cs_secret,
        'grant_type': 'refresh_token',
        'refresh_token': cs_refresh,
    }
    auth_response = requests.post(auth_url, data=auth_payload)
    if auth_response.status_code != 200:
        print('Error: Auth failed -- server error {0}'.format(auth_response.status_code))
        print(auth_response.text)
        exit(1)
    response_dict = auth_response.json()
    if 'access_token' not in response_dict:
        print('Error: Auth failed -- no access token')
        exit(1)
    # Prepare access token
    cs_auth = 'Bearer ' + response_dict['access_token']
    headers = {
        'Authorization': cs_auth,
        'x-goog-api-version': '2',
    }
    # Upload
    print('Uploading package...')
    upload_url = 'https://www.googleapis.com/upload/chromewebstore/v1.1/items/{0}'.format(cs_extension_id)
    upload_response = requests.put(upload_url, headers=headers, data=f)
    f.close()
    if upload_response.status_code != 200:
        print('Upload failed -- server error {0}'.format(upload_response.status_code))
        print(upload_response.text)
        exit(1)
    response_dict = upload_response.json();
    if 'uploadState' not in response_dict or response_dict['uploadState'] != 'SUCCESS':
        print('Upload failed -- server error {0}'.format(response_dict['uploadState']))
        exit(1)
    print('Upload succeeded.')
    # Publish
    print('Publishing package...')
    publish_url = 'https://www.googleapis.com/chromewebstore/v1.1/items/{0}/publish'.format(cs_extension_id)
    headers = {
        'Authorization': cs_auth,
        'x-goog-api-version': '2',
        'Content-Length': '0',
    }
    publish_response = requests.post(publish_url, headers=headers)
    if publish_response.status_code != 200:
        print('Error: Chrome store publishing failed -- server error {0}'.format(publish_response.status_code))
        exit(1)
    response_dict = publish_response.json();
    if 'status' not in response_dict or response_dict['status'][0] != 'OK':
        print('Publishing failed -- server error {0}'.format(response_dict['status']))
        exit(1)
    print('Publishing succeeded.')

print('All done.')

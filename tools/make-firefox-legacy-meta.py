#!/usr/bin/env python3

import os
import json
import re
import sys
from io import open
from shutil import rmtree
from collections import OrderedDict

if len(sys.argv) == 1 or not sys.argv[1]:
    raise SystemExit('Build dir missing.')


def mkdirs(path):
    try:
        os.makedirs(path)
    finally:
        return os.path.exists(path)

pj = os.path.join

# Find path to project root
proj_dir = os.path.split(os.path.abspath(__file__))[0]
while not os.path.isdir(os.path.join(proj_dir, '.git')):
    proj_dir = os.path.normpath(os.path.join(proj_dir, '..'))

# Check that found project root is valid
version_filepath = os.path.join(proj_dir, 'dist', 'version')
if not os.path.isfile(version_filepath):
    print('Version file not found.')
    exit(1)

build_dir = os.path.abspath(sys.argv[1])
source_locale_dir = pj(build_dir, '_locales')
target_locale_dir = pj(build_dir, 'locale')
language_codes = []
descriptions = OrderedDict({})
title_case_strings = ['pickerContextMenuEntry', 'contextMenuTemporarilyAllowLargeMediaElements']

for alpha2 in sorted(os.listdir(source_locale_dir)):
    locale_path = pj(source_locale_dir, alpha2, 'messages.json')
    with open(locale_path, encoding='utf-8') as f:
        strings = json.load(f, object_pairs_hook=OrderedDict)
    alpha2 = alpha2.replace('_', '-')
    descriptions[alpha2] = strings['extShortDesc']['message']
    del strings['extShortDesc']
    language_codes.append(alpha2)
    mkdirs(pj(target_locale_dir, alpha2))
    locale_path = pj(target_locale_dir, alpha2, 'messages.properties')
    with open(locale_path, 'wt', encoding='utf-8', newline='\n') as f:
        for string_name in strings:
            string = strings[string_name]['message']
            if alpha2 == 'en' and string_name in title_case_strings:
                string = string.title()
            f.write(string_name)
            f.write(u'=')
            f.write(string.replace('\n', r'\n'))
            f.write(u'\n')

# generate chrome.manifest file
chrome_manifest = pj(build_dir, 'chrome.manifest')

with open(chrome_manifest, 'at', encoding='utf-8', newline='\n') as f:
    f.write(u'\nlocale ublock0 en ./locale/en/\n')
    for alpha2 in language_codes:
        if alpha2 == 'en':
            continue
        f.write(u'locale ublock0 ' + alpha2 + ' ./locale/' + alpha2 + '/\n')

rmtree(source_locale_dir)

# update install.rdf

chromium_manifest = pj(proj_dir, 'platform', 'chromium', 'manifest.json')
with open(chromium_manifest, encoding='utf-8') as m:
    manifest = json.load(m)

# Fetch extension version
# https://developer.mozilla.org/en-US/Add-ons/AMO/Policy/Maintenance#How_do_I_submit_a_Beta_add-on.3F
# "To create a beta channel [...] '(a|alpha|b|beta|pre|rc)\d*$' "

version = ''
with open(version_filepath) as f:
    version = f.read().strip()
match = re.search('^(\d+\.\d+\.\d+)(\.\d+)$', version)
if match:
    buildtype = int(match.group(2)[1:])
    if buildtype < 100:
        builttype = 'b' + str(buildtype)
    else:
        builttype = 'rc' + str(buildtype - 100)
    version = match.group(1) + builttype
manifest['version'] = version

manifest['homepage'] = 'https://github.com/gorhill/uBlock'
manifest['description'] = descriptions['en']
del descriptions['en']

manifest['localized'] = []
t = '    '
t3 = 3 * t
for alpha2 in descriptions:
    if alpha2 == 'en':
        continue
    manifest['localized'].append(
        '\n' + t*2 + '<em:localized><Description>\n' +
        t3 + '<em:locale>' + alpha2 + '</em:locale>\n' +
        t3 + '<em:name>' + manifest['name'] + '</em:name>\n' +
        t3 + '<em:description>' + descriptions[alpha2] + '</em:description>\n' +
        t3 + '<em:creator>' + manifest['author'] + '</em:creator>\n' +
        # t3 + '<translator>' + ??? + '</translator>\n' +
        t3 + '<em:homepageURL>' + manifest['homepage'] + '</em:homepageURL>\n' +
        t*2 + '</Description></em:localized>'
    )
manifest['localized'] = '\n'.join(manifest['localized'])

install_rdf = pj(build_dir, 'install.rdf')
with open(install_rdf, 'r+t', encoding='utf-8', newline='\n') as f:
    install_rdf = f.read()
    f.seek(0)
    f.write(install_rdf.format(**manifest))

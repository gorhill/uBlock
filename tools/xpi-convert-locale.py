#!/usr/bin/env python3

import os
import json
import sys
from shutil import rmtree
from collections import OrderedDict

if not sys.argv[1]:
	raise SystemExit('Build dir missing.')


def mkdirs(path):
    try:
        os.makedirs(path)
    finally:
        return os.path.exists(path)


build_dir = os.path.abspath(sys.argv[1])
source_locale_dir = os.path.join(build_dir, '_locales')
target_locale_dir = os.path.join(build_dir, 'locale')

for alpha2 in os.listdir(source_locale_dir):
    locale_path = os.path.join(source_locale_dir, alpha2, 'messages.json')
    with open(locale_path, encoding='utf-8') as f:
        string_data = json.load(f, object_pairs_hook=OrderedDict)

    alpha2 = alpha2.replace('_', '-')

    mkdirs(os.path.join(target_locale_dir, alpha2))

    locale_path = os.path.join(target_locale_dir, alpha2, 'messages.properties')
    with open(locale_path, 'wt', encoding='utf-8', newline='\n') as f:
        for string_name in string_data:
            f.write(string_name)
            f.write('=')
            f.write(string_data[string_name]['message'].replace('\n', r'\n'))
            f.write('\n')

rmtree(source_locale_dir)

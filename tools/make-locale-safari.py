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
locale_dir = os.path.join(build_dir, '_locales')

for alpha2 in os.listdir(locale_dir):
    locale_path = os.path.join(locale_dir, alpha2, 'messages.json')
    with open(locale_path, encoding='utf-8') as f:
        string_data = json.load(f, object_pairs_hook=OrderedDict)

    for string_name in string_data:
        string_data[string_name] = string_data[string_name]['message']

    rmtree(os.path.join(locale_dir, alpha2))

    alpha2 = alpha2.replace('_', '-')
    locale_path = os.path.join(locale_dir, alpha2 + '.json')

    mkdirs(os.path.join(locale_dir))

    with open(locale_path, 'wt', encoding='utf-8', newline='\n') as f:
        json.dump(string_data, f, ensure_ascii=False)

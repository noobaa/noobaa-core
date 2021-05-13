# Copyright (C) 2016 NooBaa
{
    'includes': ['../common.gypi'],
    'targets': [{
        'target_name': 'os_test',
        'type': 'executable',
        'sources': [
            'os_test.cpp',
            '../util/os.h',
            '../util/os_linux.cpp',
            '../util/os_darwin.cpp',
        ],
    }],
}

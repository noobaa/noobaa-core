# Copyright (C) 2016 NooBaa
{

    'includes': ['common_third_party.gypi'],
    'target_defaults': {
        'conditions': [
            [ 'node_arch=="x64"', {
                'conditions' : [
                    [ 'OS=="linux"', { 'cflags': ['-DUSE_SSSE3', '-mssse3'] }],
                    [ 'OS=="mac"', { 'xcode_settings': { 'OTHER_CFLAGS': ['-msse4.1'] } }],
                ],
            }],
            [ 'node_arch=="arm64"', {
                'conditions' : [
                    [ 'OS=="linux"', { 'cflags': ['-DUSE_NEON'] }],
                ],
            }],
        ],
    },
    'targets': [{
        'target_name': 'cm256',
        'type': 'static_library',
        'sources': [
            'cm256/cm256.cpp',
            'cm256/cm256.h',
            'cm256/gf256.cpp',
            'cm256/gf256.h',
        ],
    }]
}

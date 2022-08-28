# Copyright (C) 2016 NooBaa
{

    'includes': ['common_third_party.gypi'],
    'target_defaults': {
        'conditions': [
            [ 'node_arch=="x64"', {
                'conditions' : [
                    [ 'OS=="linux"', { 'cflags': ['-msse4.1'] }],
                    [ 'OS=="mac"', { 'xcode_settings': { 'OTHER_CFLAGS': ['-msse4.1'] } }],
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

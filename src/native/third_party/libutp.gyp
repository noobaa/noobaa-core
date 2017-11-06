# Copyright (C) 2016 NooBaa
{
    'includes': ['common_third_party.gypi'],
    'configurations': {
        'Debug': {
            'defines': ['_DEBUG', 'UTP_DEBUG_LOGGING'],
        },
        'Release': {
            'defines!': ['_DEBUG', 'UTP_DEBUG_LOGGING'],
        }
    },
    'targets': [{
        'target_name': 'libutp',
        'type': 'static_library',
        'conditions' : [
            [ 'OS=="mac" ', {
                'defines': ['POSIX']
            }],
            [ 'OS=="linux" ', {
                'defines': ['POSIX']
            }]
        ],
        'sources': [
            'libutp/utp.h',
            'libutp/utp_api.cpp',
            'libutp/utp_callbacks.cpp',
            'libutp/utp_callbacks.h',
            'libutp/utp_hash.cpp',
            'libutp/utp_hash.h',
            'libutp/utp_internal.cpp',
            'libutp/utp_internal.h',
            'libutp/utp_packedsockaddr.cpp',
            'libutp/utp_packedsockaddr.h',
            'libutp/utp_templates.h',
            'libutp/utp_types.h',
            'libutp/utp_utils.cpp',
            'libutp/utp_utils.h',
        ],
    }, {
        'target_name': 'ucat',
        'type': 'executable',
        'conditions' : [
            [ 'OS=="mac"', {
                'defines': ['POSIX']
            }],
            [ 'OS=="linux" ', {
                'defines': ['POSIX']
            }]
        ],
        'dependencies': ['libutp'],
        'sources': [
            'libutp/ucat.c'
        ]
    }]
}

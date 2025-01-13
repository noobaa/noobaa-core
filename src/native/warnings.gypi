# Copyright (C) 2016 NooBaa
{
    'variables': {
        'cflags_warnings': [
            '-W',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wpedantic',
            '-Wno-unused-parameter',
            # Can be removed when https://github.com/nodejs/nan/issues/953 is resolved.
            '-Wno-error=deprecated-declarations',
        ],
    },

    'conditions' : [
        [ 'OS=="mac"', {
            'variables': {
                'cflags_warnings': [
                    # fails for gpfs_fcntl.h from (fs_napi.cpp)
                    '-Wno-zero-length-array',
                    # fails for cuobjserver.h (from cuobj_server_napi.cpp)
                    '-Wno-defaulted-function-deleted',
                ],
            },
        }],
    ],


    'target_defaults': {

        'cflags': ['<@(cflags_warnings)'],

        'conditions' : [
            [ 'OS=="mac"', {
                'xcode_settings': {
                    'WARNING_CFLAGS': ['<@(cflags_warnings)'],
                },
            }],
        ],
    },
}

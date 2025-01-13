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

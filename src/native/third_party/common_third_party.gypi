# Copyright (C) 2016 NooBaa
{
    'includes': ['../common.gypi'],
    'variables': {
        'disabled_warnings': ['-W', '-Wall'],
    },
    'target_defaults': {
        'cflags!': ['<@(disabled_warnings)'],
        'conditions' : [
            [ 'OS=="mac"', {
                'xcode_settings': {
                    'WARNING_CFLAGS!': ['<@(disabled_warnings)'],
                },
            }],
        ],
    }
}

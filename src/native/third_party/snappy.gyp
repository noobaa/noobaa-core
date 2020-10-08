# Copyright (C) 2016 NooBaa
{
    'includes': ['common_third_party.gypi'],
    'target_defaults': {
        'conditions': [
            ['node_arch=="s390x" or node_arch=="s390"', {
                'cflags': ['-DSNAPPY_IS_BIG_ENDIAN']
            }],
        ],
    },
    'targets': [{
        'target_name': 'snappy',
        'type': 'static_library',
        'sources': [
            'snappy/snappy-c.cc',
            'snappy/snappy-c.h',
            'snappy/snappy-internal.h',
            'snappy/snappy-sinksource.cc',
            'snappy/snappy-sinksource.h',
            'snappy/snappy-stubs-internal.cc',
            'snappy/snappy-stubs-internal.h',
            'snappy/snappy-stubs-public.h',
            'snappy/snappy.cc',
            'snappy/snappy.h',
        ],
    }]
}

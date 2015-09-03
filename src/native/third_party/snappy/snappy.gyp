{
    'includes': ['../../common.gypi'],
    'targets': [{
        'target_name': 'snappy',
        'type': 'static_library',
        'sources': [
            'snappy-c.cc',
            'snappy-c.h',
            'snappy-internal.h',
            'snappy-sinksource.cc',
            'snappy-sinksource.h',
            'snappy-stubs-internal.cc',
            'snappy-stubs-internal.h',
            'snappy-stubs-public.h',
            'snappy.cc',
            'snappy.h',
        ],
    }]
}

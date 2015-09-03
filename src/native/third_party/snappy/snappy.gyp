{
    'includes': ['../../common.gypi'],
    'targets': [{
        'target_name': 'snappy',
        'type': 'static_library',
        'sources': [
            'snappy.cc',
            'snappy-c.cc',
            'snappy-sinksource.cc',
            'snappy-stubs-internal.cc',
        ],
    }]
}

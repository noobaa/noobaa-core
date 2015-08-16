{
    'includes': ['common.gypi'],
    'targets': [{
        'target_name': 'snappy',
        'type': 'static_library',
        'sources': [
            'src/native/snappy/snappy.cc',
            'src/native/snappy/snappy-c.cc',
            'src/native/snappy/snappy-sinksource.cc',
            'src/native/snappy/snappy-stubs-internal.cc',
        ],
    }, {
        'target_name': 'native_util',
        'dependencies': ['snappy'],
        'sources': [
            'src/native/util/module.cpp',
            'src/native/util/dedup_chunker.cpp',
            'src/native/util/object_coding.cpp',
            'src/native/util/tpool.cpp',
            'src/native/util/gf2.cpp',
            'src/native/util/buzhash.cpp',
            'src/native/util/crypto.cpp',
            'src/native/util/compression.cpp',
            'src/native/util/buf.cpp',
            'src/native/util/base64/cencode.cpp',
            'src/native/util/base64/cdecode.cpp',
        ],
    }, {
        'target_name': 'native_rpc',
        #'dependencies': ['native_util'],
        'sources': [
            'src/native/rpc/module.cpp',
            'src/native/rpc/nudp.cpp'
        ]
    }],
}

{
    'includes': ['common.gypi'],
    'targets': [{
        'target_name': 'native_core',
        'dependencies': [
            'third_party/base64/base64.gyp:*',
            'third_party/snappy/snappy.gyp:*',
            'third_party/libutp/libutp.gyp:*',
            # 'third_party/udt4/udt4.gyp:*',
            # 'third_party/usrsctp/usrsctp.gyp:*',
        ],
        'sources': [
            'module.cpp',
            'util/buf.cpp',
            'util/tpool.cpp',
            'util/crypto.cpp',
            'util/compression.cpp',
            'util/gf2.cpp',
            'util/buzhash.cpp',
            'coding/dedup_chunker.cpp',
            'coding/object_coding.cpp',
            'n2n/nudp.cpp',
        ],
    }]
}

{
    'includes': ['common.gypi'],
    'targets': [{
        'target_name': 'native_core',
        'dependencies': [
            'third_party/base64/base64.gyp:base64',
            'third_party/snappy/snappy.gyp:snappy',
            'third_party/libutp/libutp.gyp:libutp',
            'third_party/crc32/crc32.gyp:crc32',
            # 'third_party/libutp/libutp.gyp:ucat',
            # 'third_party/crc32/crc32.gyp:runcrc',
            # 'third_party/webrtc/webrtc.gyp:webrtc_crc32',
            # 'third_party/webrtc/webrtc.gyp:webrtc_stun',
            # 'third_party/udt4/udt4.gyp:udt4',
            # 'third_party/usrsctp/usrsctp.gyp:usrsctp',
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
            'n2n/nat.cpp',
        ],
    }]
}

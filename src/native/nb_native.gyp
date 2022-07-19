# Copyright (C) 2016 NooBaa
{
    'includes': ['common.gypi'],

    'variables': { # NOTE: variables in the same scope cannot expand each other!
        'cflags_warnings': [
            '-W',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wpedantic',
        ],
        'nan_include_dirs':  ['''<!(node -e "require('nan')")'''],
        'napi_include_dirs': ['''<!@(node -p "require('node-addon-api').include")'''],
        'napi_dependencies': ['''<!(node -p "require('node-addon-api').gyp")'''],
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

    'targets': [{
        'target_name': 'nb_native',
        'include_dirs': [
            '<@(napi_include_dirs)',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
            'third_party/cm256.gyp:cm256',
            'third_party/snappy.gyp:snappy',
            'third_party/isa-l.gyp:isa-l-ec',
            'third_party/isa-l.gyp:isa-l-md5',
            'third_party/isa-l.gyp:isa-l-sha1',
        ],
        'sources': [
            # module
            'nb_native.cpp',
            # chunking
            'chunk/coder_napi.cpp',
            'chunk/coder.h',
            'chunk/coder.cpp',
            'chunk/splitter_napi.cpp',
            'chunk/splitter.h',
            'chunk/splitter.cpp',
            # tools
            'tools/b64_napi.cpp',
            'tools/ssl_napi.cpp',
            'tools/syslog_napi.cpp',
            'tools/malloc_napi.cpp',
            # util
            'util/b64.h',
            'util/b64.cpp',
            'util/backtrace.h',
            'util/struct_buf.h',
            'util/struct_buf.cpp',
            'util/common.h',
            'util/napi.h',
            'util/napi.cpp',
            'util/rabin.h',
            'util/rabin.cpp',
            'util/snappy.h',
            'util/snappy.cpp',
            'util/zlib.h',
            'util/zlib.cpp',
            # fs
            'fs/fs_napi.cpp',
        ],
    }, {
        'target_name': 'nb_native_nan',
        'include_dirs': [
            '<@(nan_include_dirs)',
        ],
        'dependencies': [
            'third_party/libutp.gyp:libutp',
            'third_party/snappy.gyp:snappy',
        ],
        'sources': [
            # module
            'nb_native_nan.cpp',
            # n2n
            'n2n/ntcp.h',
            'n2n/ntcp.cpp',
            'n2n/nudp.h',
            'n2n/nudp.cpp',
            'util/gf2.h',
            'util/rabin_fingerprint.h',
            'util/backtrace.h',
            'util/b64.cpp',
            'util/buf.cpp',
            'util/buf.h',
            'util/common.h',
            'util/compression.cpp',
            'util/compression.h',
            'util/gf2.h',
            'util/nan.h',
            'util/mutex.h',
            'util/rabin_fingerprint.h',
            'util/tpool.cpp',
            'util/tpool.h',
        ],
    }, {
        'target_name': 'kube_pv_chown',
        'type': 'executable',
        'sources': [
            'tools/kube_pv_chown.cpp'
        ]
    }],
}
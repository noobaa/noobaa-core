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
        'nan_include_dirs': ['<!(node -e \'require("nan")\')'],
        'napi_include_dirs': ['<!@(node -p \'require("node-addon-api").include\')'],
        'napi_dependencies': ['<!@(node -p \'require("node-addon-api").gyp\')'],
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
        ],
    }, {
        'target_name': 'nb_native_nan',
        'include_dirs': [
            '<@(nan_include_dirs)',
        ],
        'dependencies': [
            'third_party/libutp.gyp:libutp',
        ],
        'sources': [
            # module
            'nb_native_nan.cpp',
            # n2n
            'n2n/buf.h',
            'n2n/buf.cpp',
            'n2n/nan.h',
            'n2n/ntcp.h',
            'n2n/ntcp.cpp',
            'n2n/nudp.h',
            'n2n/nudp.cpp',
        ],
    }],

}

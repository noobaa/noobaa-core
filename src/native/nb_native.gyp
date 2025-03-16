# Copyright (C) 2016 NooBaa
{
    'includes': ['common.gypi', 'warnings.gypi'],

    'target_defaults': {
        'conditions' : [
            [ 'OS=="mac"', {
                'xcode_settings': {
                     'OTHER_CFLAGS': ['-DUSE_SSSE3', '-msse4.1'],
                },
            }],
            [ 'node_arch=="x64"', {
                'cflags': ['-DUSE_SSSE3', '-mssse3']
            }],
            [ 'node_arch=="arm64"', {
                'cflags': ['-DUSE_NEON']
            }]
        ],
    },

    'targets': [{
        'target_name': 'nb_native',
        'variables': {
            'BUILD_S3SELECT%': 0,
            'BUILD_S3SELECT_PARQUET%': 0,
            'BUILD_RDMA_NAPI%': 0,
            'BUILD_CUDA_NAPI%': 0,
        },
        'conditions': [
            [ 'BUILD_S3SELECT!=0', {
                'dependencies': ['s3select/s3select.gyp:s3select'],
                'defines': ['BUILD_S3SELECT=1']
            }],
            [ 'BUILD_RDMA_NAPI!=0', {
                'dependencies': ['rdma/rdma_napi.gyp:rdma_napi'],
                'defines': ['BUILD_RDMA_NAPI=1'],
            }],
            [ 'BUILD_CUDA_NAPI!=0', {
                'dependencies': ['cuda/cuda_napi.gyp:cuda_napi'],
                'defines': ['BUILD_CUDA_NAPI=1'],
            }],
        ],
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
            'third_party/isa-l.gyp:isa-l-crc'
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
            'tools/crypto_napi.cpp',
            # util
            'util/b64.h',
            'util/b64.cpp',
            'util/backtrace.h',
            'util/struct_buf.h',
            'util/struct_buf.cpp',
            'util/common.h',
            'util/common.cpp',
            'util/napi.h',
            'util/napi.cpp',
            'util/os.h',
            'util/os_linux.cpp',
            'util/os_darwin.cpp',
            'util/rabin.h',
            'util/rabin.cpp',
            'util/snappy.h',
            'util/snappy.cpp',
            'util/worker.h',
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
            'util/common.cpp',
            'util/compression.cpp',
            'util/compression.h',
            'util/gf2.h',
            'util/nan.h',
            'util/mutex.h',
            'util/rabin_fingerprint.h',
            'util/tpool.cpp',
            'util/tpool.h',
        ],
    }],
}

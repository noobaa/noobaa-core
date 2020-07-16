# Copyright (C) 2016 NooBaa
{
    'variables': {
        # see https://nodejs.org/docs/latest-v12.x/api/process.html#process_process_arch
        # Possible values are: 
        # 'arm', 'arm64', 'ia32', 'mips','mipsel', 'ppc', 'ppc64', 's390', 's390x', 'x32', and 'x64'.
        'node_arch': '''<!(node -p process.arch)''',
    },
    'target_defaults': {

        'conditions' : [

            [ 'OS=="linux"', {
                'cflags!': [
                    '-fno-exceptions',
                ],
                'cflags_cc!': [
                    '-fno-exceptions',
                ],
                'cflags': [
                    '-std=c99',
                ],
                'cflags_cc': [
                    '-std=c++11'
                ],
                'ldflags': [
                    '-lrt', # librt
                ],
            }],

            [ 'OS=="win"', {
                'libraries': [
                    'ws2_32', # winsock2
                ],
                'msvs_settings': {
                    'VCCLCompilerTool': {
                        'ExceptionHandling': 1,
                        'AdditionalOptions': [
                            # https://docs.microsoft.com/en-us/cpp/build/reference/eh-exception-handling-model
                            # /EHsc - catches C++ exceptions only and tells the compiler
                            # to assume that functions declared as extern "C" never throw a C++ exception.
                            '/EHsc', 
                        ],
                    }
                },
            }],

            [ 'OS=="mac"', {
                'xcode_settings': {
                    # Reference - http://help.apple.com/xcode/mac/8.0/#/itcaec37c2a6
                    'MACOSX_DEPLOYMENT_TARGET': '10.9',
                    'CLANG_CXX_LIBRARY': 'libc++',
                    'CLANG_CXX_LANGUAGE_STANDARD': 'c++11', # -std=c++11
                    'GCC_C_LANGUAGE_STANDARD': 'c99', # -std=c99
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
                },
            }],

        ],

        'default_configuration': 'Release',

        'configurations': {

            'Debug': {
                'defines!': ['NDEBUG'],
                'defines': ['DEBUG', '_DEBUG'],
                'cflags!': ['-Os', '-O1', '-O2', '-O3'],
                'cflags_cc!': ['-Os', '-O1', '-O2', '-O3'],
                'cflags': ['-O0', '-g'],
                'xcode_settings': {
                    'GCC_GENERATE_DEBUGGING_SYMBOLS': 'YES',
                    'GCC_OPTIMIZATION_LEVEL': '0',
                    'OTHER_CFLAGS!': ['-Os', '-O1', '-O2', '-O3'],
                    'OTHER_CPLUSPLUSFLAGS!': ['-Os', '-O1', '-O2', '-O3'],
                    'OTHER_CFLAGS': ['-O0', '-g'],
                },
            },

            'Release': {
                'defines': ['NDEBUG'],
                'defines!': ['DEBUG', '_DEBUG'],
                'cflags!': ['-Os', '-O0', '-O1', '-O2'],
                'cflags_cc!': ['-Os', '-O0', '-O1', '-O2'],
                'cflags': ['-O3'],
                'xcode_settings': {
                    'GCC_GENERATE_DEBUGGING_SYMBOLS': 'NO',
                    'GCC_INLINES_ARE_PRIVATE_EXTERN': 'YES',
                    'GCC_OPTIMIZATION_LEVEL': '3',
                    'DEAD_CODE_STRIPPING': 'YES',
                    'OTHER_CFLAGS!': ['-Os', '-O0', '-O1', '-O2'],
                    'OTHER_CPLUSPLUSFLAGS!': ['-Os', '-O0', '-O1', '-O2'],
                    'OTHER_CFLAGS': ['-O3'],
                },
            },
        }
    }
}

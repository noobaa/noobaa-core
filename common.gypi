{
    'variables': {

        'nan_path': '<!(node -e \"require(\'nan\')\")',

        # node v0.6.x doesn't give us its build variables,
        # but on Unix it was only possible to use the system OpenSSL library,
        # so default the variable to "true", v0.8.x node and up will overwrite it.
        'node_shared_openssl%': 'true',

        # variables inside variables hack to allow using conditional and then reload the variables
        # see https://code.google.com/p/gyp/issues/detail?id=165
        'variables': {
            'conditions' : [
                [ 'OS=="win"', {
                    'conditions': [
                        ['target_arch=="x64"', {
                            'openssl_root%': 'C:/OpenSSL-Win64'
                        }, {
                            'openssl_root%': 'C:/OpenSSL-Win32'
                        }],
                    ],
                }, { # not windows
                    'openssl_root%': '<(node_root_dir)/deps/openssl',
                }]
            ]
        },

        'conditions' : [
            [ 'OS=="win"', {
                'openssl_config_path': ' ', # node-gyp fails if the string is empty...
                'openssl_include_path': '<(openssl_root)/include',
                'openssl_lib': '-l<(openssl_root)/lib/libeay32.lib',
            }, { # not windows
                'openssl_include_path': '<(openssl_root)/openssl/include',
                'openssl_lib': ' ',
                'conditions': [
                    ['target_arch=="ia32"', {
                        'openssl_config_path': [ '<(openssl_root)/config/piii' ]
                    }],
                    ['target_arch=="x64"', {
                        'openssl_config_path': [ '<(openssl_root)/config/k8' ]
                    }],
                    ['target_arch=="arm"', {
                        'openssl_config_path': [ '<(openssl_root)/config/arm' ]
                    }],
                    ['target_arch=="ppc64"', {
                        'openssl_config_path': [ '<(openssl_root)/config/powerpc64' ]
                    }],
                ],
            }]
        ],
    },

    'target_defaults': {

        'include_dirs' : [
            '<(nan_path)',
            '<(openssl_include_path)',
            '<(openssl_config_path)',
        ],

        # enable exceptions using negative (cflags!) to remove cflags set by node.js common.gypi
        'cflags!': ['-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics'],
        'cflags_cc!': ['-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics'],
        'cflags': ['-std=c++11'],

        'libraries': [
            '<(openssl_lib)',
        ],

        'xcode_settings': {
            'OTHER_CFLAGS': [
                '-std=c++11',
            ],
            'OTHER_CPLUSPLUSFLAGS': [
                '-std=c++11',
                '-stdlib=libc++', # clang
                # '-stdlib=libstdc++', # gcc
            ],
            'OTHER_LDFLAGS': [
                '-std=c++11',
                '-stdlib=libc++', # clang
                # '-stdlib=libstdc++', # gcc
            ],
        },

        'msvs_settings': {
            'VCCLCompilerTool': {
                # Enable unwind semantics for Exception Handling.
                # This one actually does the trick.
                # This is also where you can put /GR or /MDd, or other defines.
                'AdditionalOptions': [ '/EHsc' ],
                'ExceptionHandling': 1, # /EHsc (doesn't work?)
                'RuntimeLibrary': 3, # shared debug
                'RuntimeTypeInfo': 'true', # /GR
                # 'RuntimeLibrary': '2' # /MD
            }
        },

        'default_configuration': 'Debug',

        'configurations': {

            'Debug': {
                'cflags!': ['-Os', '-O1', '-O2', '-O3'],
                'cflags_cc!': ['-Os', '-O1', '-O2', '-O3'],
                'cflags': ['-O0', '-g'],
                'xcode_settings': {
                    'MACOSX_DEPLOYMENT_TARGET': '10.7',
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
                    'GCC_ENABLE_CPP_RTTI': 'YES',
                    'GCC_THREADSAFE_STATICS': 'YES',
                    'GCC_GENERATE_DEBUGGING_SYMBOLS': 'YES',
                    'GCC_OPTIMIZATION_LEVEL': '0',
                    'OTHER_CFLAGS!': ['-Os', '-O1', '-O2', '-O3'],
                    'OTHER_CPLUSPLUSFLAGS!': ['-Os', '-O1', '-O2', '-O3'],
                    'OTHER_CFLAGS': ['-O0', '-g'],
                },
            },

            'Release': {
                'defines': [
                    # 'NDEBUG' TODO uncomment
                ],
                'cflags!': ['-Os', '-O0', '-O1', '-O2'],
                'cflags_cc!': ['-Os', '-O0', '-O1', '-O2'],
                'cflags': ['-O3'],
                'xcode_settings': {
                    'MACOSX_DEPLOYMENT_TARGET': '10.7',
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
                    'GCC_ENABLE_CPP_RTTI': 'YES',
                    'GCC_THREADSAFE_STATICS': 'YES',
                    'GCC_GENERATE_DEBUGGING_SYMBOLS': 'NO',
                    'GCC_INLINES_ARE_PRIVATE_EXTERN': 'YES',
                    'GCC_OPTIMIZATION_LEVEL': '3',
                    'DEAD_CODE_STRIPPING': 'YES',
                    'OTHER_CFLAGS!': ['-Os', '-O0', '-O1', '-O2'],
                    'OTHER_CPLUSPLUSFLAGS!': ['-Os', '-O0', '-O1', '-O2'],
                    'OTHER_CFLAGS': ['-O3'],
                },
            }
        }
    }
}

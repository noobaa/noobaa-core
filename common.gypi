{
    'variables': {
        'nan_path': '<!(node -e \"require(\'nan\')\")',

        # node v0.6.x doesn't give us its build variables,
        # but on Unix it was only possible to use the system OpenSSL library,
        # so default the variable to "true", v0.8.x node and up will overwrite it.
        #
        # when "node_shared_openssl" is "false", then OpenSSL has been
        # bundled into the node executable. So we need to include the same
        # header files that were used when building node.
        #
        'node_shared_openssl%': 'true',
        'conditions' : [
            [ 'OS=="win"', {
                'conditions': [
                    # "openssl_root" is the directory on Windows of the OpenSSL files.
                    # Check the "target_arch" variable to set good default values for
                    # both 64-bit and 32-bit builds of the module.
                    ['target_arch=="x64"', {
                        'openssl_root%': 'C:/OpenSSL-Win64'
                    }, {
                        'openssl_root%': 'C:/OpenSSL-Win32'
                    }],
                ],
                'openssl_include_path': '<(openssl_root)/include',
                'openssl_lib': '-l<(openssl_root)/lib/libeay32.lib',
            }, {
                'openssl_include_path': '<(node_root_dir)/deps/openssl/openssl/include',
                'openssl_lib': '',
                'conditions': [
                    ['target_arch=="ia32"', {
                        'openssl_config_path': [ '<(node_root_dir)/deps/openssl/config/piii' ]
                    }],
                    ['target_arch=="x64"', {
                        'openssl_config_path': [ '<(node_root_dir)/deps/openssl/config/k8' ]
                    }],
                    ['target_arch=="arm"', {
                        'openssl_config_path': [ '<(node_root_dir)/deps/openssl/config/arm' ]
                    }],
                    ['target_arch=="ppc64"', {
                        'openssl_config_path': [ '<(node_root_dir)/deps/openssl/config/powerpc64' ]
                    }],
                ],
            }]
        ],
    },

    'target_defaults': {
        'default_configuration': 'Debug',
        'configurations': {

            'Debug': {
                'include_dirs' : [
                    '<(nan_path)',
                    '<(openssl_include_path)',
                    '<(openssl_config_path)',
                ],
                # cancel node common using negatives (cflags!)
                'cflags!': ['-fno-exceptions'],
                'cflags_cc!': ['-fno-exceptions'],
                'cflags': ['-std=c++11', '-O0', '-g'],
                'xcode_settings': {
                    'OTHER_CFLAGS': [],
                    'OTHER_CPLUSPLUSFLAGS': [
                        '-std=c++11',
                        '-stdlib=libc++'
                    ],
                    'OTHER_LDFLAGS': [
                        '-stdlib=libc++'
                    ],
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
                    'MACOSX_DEPLOYMENT_TARGET': '10.7',
                },
                'msvs_settings': {
                    'VCCLCompilerTool': {
                        # Enable unwind semantics for Exception Handling.
                        # This one actually does the trick.
                        # This is also where you can put /GR or /MDd, or other defines.
                        'AdditionalOptions': [ '/EHsc' ],
                        'ExceptionHandling': 1, # /EHsc  doesn't work.
                        'RuntimeLibrary': 3, # shared debug
                    }
                },
            },

            'Release': {
                'include_dirs' : [
                    '<(nan_path)',
                    '<(openssl_include_path)',
                    '<(openssl_config_path)',
                ],
                # cancel node common using negatives (cflags!)
                'cflags!': ['-fno-exceptions'],
                'cflags_cc!': ['-fno-exceptions'],
                'cflags': ['-std=c++11', '-O3'],
                'xcode_settings': {
                    'OTHER_CFLAGS': [],
                    'OTHER_CPLUSPLUSFLAGS': [
                        '-std=c++11',
                        '-stdlib=libc++'
                    ],
                    'OTHER_LDFLAGS': [
                        '-stdlib=libc++'
                    ],
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
                    'MACOSX_DEPLOYMENT_TARGET': '10.7',
                },
                'msvs_settings': {
                    'VCCLCompilerTool': {
                        # Enable unwind semantics for Exception Handling.
                        # This one actually does the trick.
                        # This is also where you can put /GR or /MD, or other defines.
                        'AdditionalOptions': [ '/EHsc' ],
                        'ExceptionHandling': 1, # /EHsc  doesn't work.
                        'RuntimeLibrary': 2, # shared release
                    }
                },
            }
        }
    }
}

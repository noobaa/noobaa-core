{
    'target_defaults': {
        'default_configuration': 'Debug',
        'configurations': {

            'Debug': {
                'include_dirs' : [
                    '<!(node -e \"require(\'nan\')\")'
                ],
                # cancel node common using negatives (cflags!)
                'cflags!': ['-fno-exceptions'],
                'cflags_cc!': ['-fno-exceptions'],
                'cflags': ['-std=c++11'],
                'xcode_settings': {
                    'OTHER_CFLAGS': [],
                    'OTHER_CPLUSPLUSFLAGS': [
                        '-std=c++11',
                        # '-stdlib=libc++'
                    ],
                    'OTHER_LDFLAGS': [
                        # '-stdlib=libc++'
                    ],
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'
                    # 'MACOSX_DEPLOYMENT_TARGET': '10.7',
                },
                'msvs_settings': {},
            },

            'Release': {
                'include_dirs' : [
                    '<!(node -e \"require(\'nan\')\")'
                ],
                # cancel node common using negatives (cflags!)
                'cflags!': ['-fno-exceptions'],
                'cflags_cc!': ['-fno-exceptions'],
                'cflags': ['-std=c++11'],
                'xcode_settings': {
                    'OTHER_CFLAGS': [],
                    'OTHER_CPLUSPLUSFLAGS': [
                        '-std=c++11',
                        # '-stdlib=libc++'
                    ],
                    'OTHER_LDFLAGS': [
                        # '-stdlib=libc++'
                    ],
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'
                    # 'MACOSX_DEPLOYMENT_TARGET': '10.7',
                },
                'msvs_settings': {},
            }
        }
    }
}

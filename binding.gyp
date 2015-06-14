{
    'target_defaults': {
        'cflags!': [ '-fno-exceptions' ],
        'cflags_cc!': [ '-fno-exceptions' ],
        'conditions': [
            ['OS=="mac"', {
                'xcode_settings': {
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'
                }
            }]
        ]
    },
    "targets": [{
        "target_name": "native_util",
        # 'type': '<(library)',
        "sources": [
            "src/util/native/module.cc",
            "src/util/native/tpool.cc",
            "src/util/native/rabin.cc"
        ],
        'cflags!': [ '-fno-exceptions' ],
        'cflags_cc!': [ '-fno-exceptions' ],
        'conditions': [
            ['OS=="mac"', {
                'xcode_settings': {
                    'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'
                }
            }]
        ]
    }, {
        "target_name": "native_rpc",
        # 'type': '<(library)',
        # 'dependencies': ['native_util'],
        "sources": [
            "src/rpc/native/module.cc",
            "src/rpc/native/nudp.cc"
        ]
    }]
}

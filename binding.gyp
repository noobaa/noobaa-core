{
    'includes': ['common.gypi'],
    'targets': [{
        'target_name': 'native_util',
        #'type': '<(library)',
        'sources': [
            'src/util/native/module.cpp',
            'src/util/native/write_processor.cpp',
            'src/util/native/read_processor.cpp',
            'src/util/native/tpool.cpp',
            'src/util/native/gf2.cpp',
            'src/util/native/buzhash.cpp',
            'src/util/native/crypto.cpp',
            'src/util/native/buf.cpp',
        ],
    }, {
        'target_name': 'native_rpc',
        #'type': '<(library)',
        #'dependencies': ['native_util'],
        'sources': [
            'src/rpc/native/module.cpp',
            'src/rpc/native/nudp.cpp'
        ]
    }],
}

{
    'includes': ['../../common.gypi'],
    'targets': [{
        'target_name': 'base64',
        'type': 'static_library',
        'sources': [
            'cencode.cpp',
            'cencode.h',
            'cdecode.cpp',
            'cdecode.h',
        ],
    }]
}

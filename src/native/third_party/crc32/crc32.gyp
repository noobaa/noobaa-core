{
    'targets': [{
        'target_name': 'crc32',
        'type': 'static_library',
        'include_dirs' : ['.'],
        'sources': [
            'crc32.cpp',
            'crc32.h',
        ],
    }, {
        'target_name': 'runcrc',
        'type': 'executable',
        'dependencies': [
            'crc32'
        ],
        'include_dirs' : ['.'],
        'sources': [
            'runcrc.cpp',
        ],
    }]
}

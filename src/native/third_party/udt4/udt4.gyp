{
    'includes': ['../../common.gypi'],
    'targets': [{
        'target_name': 'udt4',
        'type': 'static_library',
        'sources': [
            'api.cpp',
            'buffer.cpp',
            'cache.cpp',
            'ccc.cpp',
            'channel.cpp',
            'common.cpp',
            'core.cpp',
            'epoll.cpp',
            'list.cpp',
            'md5.cpp',
            'packet.cpp',
            'queue.cpp',
            'window.cpp',
        ],
    }]
}

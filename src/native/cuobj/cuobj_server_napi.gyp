# Copyright (C) 2016 NooBaa
{
    'includes': ['../common.gypi', '../warnings.gypi'],

    'targets': [{
        'target_name': 'cuobj_server_napi',
        'type': 'static_library',
        'sources': [
            'cuobj_server_napi.cpp',
        ],
        'variables': {
            'CUOBJ_PATH%': '''<!(realpath /opt/cuObject/src)>''',
        },
        'defines': [
            'USE_CUOBJ_SERVER=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
            '<(CUOBJ_PATH)/include',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],
        'conditions' : [
            [ 'OS=="linux"', {
                'link_settings': {
                    'library_dirs': [
                        '<(CUOBJ_PATH)/lib',
                    ],
                    'libraries': [
                        '<(CUOBJ_PATH)/lib/libcuobjserver.so',
                    ],
                }
            }],
        ],
    }],
}

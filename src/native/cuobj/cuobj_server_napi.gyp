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
            # By default do not link with cuobj libraries on build time -
            # linking will be done dynamically at runtime (LD_PRELOAD or dlopen).
            # set USE_CUOBJ_LIBS=1 to link with cuobj libraries on build time.
            'USE_CUOBJ_LIBS%': 0,
            'CUOBJ_INC_PATH%': '/opt/cuObject/src/include',
            'CUOBJ_LIB_PATH%': '/opt/cuObject/src/lib',
        },
        'defines': [
            'USE_CUOBJ_SERVER=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
            '<(CUOBJ_INC_PATH)',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],
        'conditions' : [
            [ 'USE_CUOBJ_LIBS!=0 and OS=="linux"', {
                'link_settings': {
                    'library_dirs': [ '<(CUOBJ_LIB_PATH)' ],
                    'libraries': [ '-lcuobjserver' ],
                }
            }],
        ],
    }],
}

# Copyright (C) 2016 NooBaa
{
    'includes': ['../common.gypi', '../warnings.gypi'],

    'targets': [{
        'target_name': 'cuda_napi',
        'type': 'static_library',
        'sources': [
            'cuda_napi.cpp',
        ],
        'variables': {
            # By default do not link with cuda libraries on build time -
            # linking will be done dynamically at runtime (LD_PRELOAD or dlopen).
            # set USE_CUDA_LIBS=1 to link with cuda libraries on build time.
            'USE_CUDA_LIBS%': 0, 
            'CUDA_PATH%': '/usr/local/cuda',
            # cuobj include dir provides cuda.h, which is enough for cuda_napi compilation
            # even without full cuda toolkit when USE_CUDA_LIBS=0
            'CUOBJ_INC_PATH%': '/opt/cuObject/src/include',
        },
        'defines': [
            'USE_CUDA=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
            '<(CUDA_PATH)/include',
            '<(CUOBJ_INC_PATH)',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],
        'conditions' : [
            [ 'USE_CUDA_LIBS!=0 and OS=="linux"', {
                'link_settings': {
                    'library_dirs': [
                        '<(CUDA_PATH)/lib64',
                    ],
                    'libraries': [
                        '-lcuda',
                        '-lcudart',
                    ],
                }
            }],
        ],
    }],
}

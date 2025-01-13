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
            'CUDA_PATH%': '/usr/local/cuda',
            'CUOBJ_PATH%': '''<!(realpath /opt/cuObject/src)>''',
        },
        'defines': [
            'USE_CUDA=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],
        'conditions': [
            [ 'OS=="linux"', {
                'include_dirs': [
                    '<(CUDA_PATH)/include',
                ],
                'link_settings': {
                    'library_dirs': [
                        '<(CUDA_PATH)/lib64',
                    ],
                    'libraries': [
                        '-lcuda',
                        '-lcudart',
                    ],
                },
            }],
            [ 'OS=="mac"', {
                'include_dirs': [
                    '<(CUOBJ_PATH)/include',
                ],
                # no cuda libraries on macOS - just include dirs for compilation
            }],
        ],
    }],
}

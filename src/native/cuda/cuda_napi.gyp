# Copyright (C) 2016 NooBaa
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
            'CUOBJ_PATH%': '''<!(realpath ../../../../cuObject-0.8.1-Linux_x86_64/src)''',
        },
        'defines': [
            'BUILD_CUDA_NAPI=1',
            # 'USE_CUDA=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],
        # 'ldflags': [
            # '-Bdynamic', # prefer dynamic linking if possible
        # ],
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
            }],
        ],
    }],
}

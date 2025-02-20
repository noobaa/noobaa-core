# Copyright (C) 2016 NooBaa
{
    'includes': ['../common.gypi', '../warnings.gypi'],

    'targets': [{
        'target_name': 'rdma_napi',
        'type': 'static_library',
        'sources': [
            'rdma_server_napi.cpp',
            'rdma_client_napi.cpp',
        ],
        'variables': {
            'CUOBJ_PATH%': '''<!(realpath ../../../../cuObject-0.7.2-Linux_x86_64/src)''',
            # 'CUDA_PATH%': '/usr/local/cuda',
            # 'BUILD_CUDA_NAPI%': 0,
        },
        'defines': [
            'BUILD_RDMA_NAPI=1',
            # 'USE_CUDA=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
            '<(CUOBJ_PATH)/include',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],
        # 'ldflags': [
            # '-Bdynamic', # prefer dynamic linking if possible
        # ],
        'conditions' : [
            # [ 'BUILD_CUDA_NAPI!=0', {
            #     'defines': [
            #         'USE_CUDA=1',
            #     ],
            #     'include_dirs': [
            #         '<(CUDA_PATH)/include',
            #     ],
            # }],
            [ 'OS=="linux"', {
                'link_settings': {
                    # 'library_dirs': [
                    #     '<(CUOBJ_PATH)/lib',
                    # ],
                    'libraries': [
                        '<(CUOBJ_PATH)/lib/libcuobjclient.so',
                        '<(CUOBJ_PATH)/lib/libcuobjserver.so',
                        '<(CUOBJ_PATH)/lib/libcufile.so.1.13.0',
                        '<(CUOBJ_PATH)/lib/libcufile_rdma.so.1.13.0',
                    ],
                }
            }],
        ],
    }],
}

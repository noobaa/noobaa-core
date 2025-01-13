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
            'CUOBJ_PATH%': '''<!(realpath ../../../../cuObject-0.8.1-Linux_x86_64/src)''',
        },
        'defines': [
            'BUILD_RDMA_NAPI=1',
        ],
        'include_dirs': [
            '<@(napi_include_dirs)',
            '<(CUOBJ_PATH)/include',
        ],
        'dependencies': [
            '<@(napi_dependencies)',
        ],

        ## we use LD_PRELOAD on runtime so no need to use the libraries on link-time

        # 'conditions' : [
        #     [ 'OS=="linux"', {
        #         'link_settings': {
        #             'library_dirs': [
        #                 '<(CUOBJ_PATH)/lib',
        #             ],
        #             'libraries': [
        #                 '<(CUOBJ_PATH)/lib/libcuobjclient.so',
        #                 '<(CUOBJ_PATH)/lib/libcuobjserver.so',
        #                 '<(CUOBJ_PATH)/lib/libcufile.so.1.13.0',
        #                 '<(CUOBJ_PATH)/lib/libcufile_rdma.so.1.13.0',
        #             ],
        #         }
        #     }],
        # ],
    }],
}

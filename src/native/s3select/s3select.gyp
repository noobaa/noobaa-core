{
    'includes': ['../third_party/common_third_party.gypi'],
    'targets': [{
        'target_name': 's3select',
        'type': 'static_library',
        'cflags_cc!': ['-fno-rtti'],
        'include_dirs': [
            '<@(napi_include_dirs)',
            '../../../submodules/s3select/include',
            '../../../submodules/s3select/rapidjson/include/'
        ],
        'sources': [
            's3select_napi.cpp'
        ],
	'link_settings': {
		'libraries': ['/lib64/libboost_thread.so.1.66.0']
        },
	'variables': {
            'BUILD_S3SELECT_PARQUET%':0
        },
	'conditions': [
            ['BUILD_S3SELECT_PARQUET==1', {
                'link_settings': {
			'libraries': ['/lib64/libarrow.so', '/lib64/libparquet.so']
		},
                'cflags' : ['-D_ARROW_EXIST']
	    }]
        ],

    }]
}

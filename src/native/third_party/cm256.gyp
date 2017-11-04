{
    'includes': ['common_third_party.gypi'],
    'targets': [{
        'target_name': 'cm256',
        'type': 'static_library',
        'sources': [
            'cm256/cm256.cpp',
            'cm256/cm256.h',
            'cm256/gf256.cpp',
            'cm256/gf256.h',
        ],
    }]
}

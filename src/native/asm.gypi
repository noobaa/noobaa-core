# Copyright (C) 2016 NooBaa
{
    'conditions': [

        # LINUX
        [ 'OS=="linux"', {
            'conditions': [
                [ 'node_arch=="x64"', {
                    'defines': [
                        'HAVE_AS_KNOWS_AVX512',
                        'HAVE_AS_KNOWS_SHANI',
                    ],
                    'rules': [{
                        'rule_name': 'assemble',
                        'extension': 'asm',
                        'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).o'],
                        'action': [
                            'nasm',
                            '-felf64',
                            '-DPIC',
                            '-DHAVE_AS_KNOWS_AVX512',
                            '-DHAVE_AS_KNOWS_SHANI',
                            '<!@(for i in <(_include_dirs); do echo -I $i; done)',
                            '-o', '<@(_outputs)',
                            '<(RULE_INPUT_PATH)',
                        ],
                        'process_outputs_as_sources': 1,
                        'message': 'NASM <(RULE_INPUT_PATH)',
                    }],
                }],
                [ 'node_arch=="arm64"', {
                    'defines': ['NO_SVE2=1'],
                    'rules': [{
                        'rule_name': 'assemble',
                        'extension': 'S',
                        'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).o'],
                        'action': [
                            'gcc',
                            '-D__ASSEMBLY__',
                            '-DNO_SVE2=1',
                            '-O2',
                            '-c',
                            '<!@(for i in <(_include_dirs); do echo -I $i; done)',
                            '-o', '<@(_outputs)',
                            '<(RULE_INPUT_PATH)',
                        ],
                        'process_outputs_as_sources': 1,
                        'message': 'ASM <(RULE_INPUT_PATH)',
                    }],
                }],
            ],
        }],

        # MAC
        [ 'OS=="mac"', {
            'rules': [{
                'rule_name': 'assemble',
                'extension': 'asm',
                'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).o'],
                'action': [
                    # TODO fix nasm on Mac
                    'yasm',
                    # 'nasm',
                    '-fmacho64',
                    # '-DHAVE_AS_KNOWS_AVX512',
                    # '-DHAVE_AS_KNOWS_SHANI',
                    '--prefix=_',
                    '<!@(for i in <(_include_dirs); do echo -I $i; done)',
                    '-o', '<@(_outputs)',
                    '<(RULE_INPUT_PATH)',
                ],
                'process_outputs_as_sources': 1,
                'message': 'NASM <(RULE_INPUT_PATH)',
            }],
        }],

        # WINDOWS
        [ 'OS=="win"', {
            'rules': [{
                'rule_name': 'assemble',
                'extension': 'asm',
                'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).obj'],
                'action': [
                    'C:/cygwin64/bin/nasm.exe',
                    '-fwin64',
                    '-DHAVE_AS_KNOWS_AVX512',
                    '-DHAVE_AS_KNOWS_SHANI',
                    '<!@(for /D %i in (<(_include_dirs)) do @echo -I %i)',
                    '-o', '<@(_outputs)',
                    '<(RULE_INPUT_PATH)',
                ],
                'process_outputs_as_sources': 1,
                'message': 'NASM <(RULE_INPUT_PATH)',
            }],
        }],

    ],
}

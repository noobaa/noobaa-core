# Copyright (C) 2016 NooBaa
{
    'conditions': [

        # LINUX
        [ 'OS=="linux"', {
            'rules': [{
                'rule_name': 'assemble',
                'extension': 'asm',
                'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).o'],
                'action': [
                    'yasm',
                    '-felf64',
                    '-DPIC',
                    '<!@(for i in <(_include_dirs); do echo -I $i; done)',
                    '-o', '<@(_outputs)',
                    '<(RULE_INPUT_PATH)',
                ],
                'process_outputs_as_sources': 1,
                'message': 'YASM <(RULE_INPUT_PATH)',
            }],
        }],

        # MAC
        [ 'OS=="mac"', {
            'rules': [{
                'rule_name': 'assemble',
                'extension': 'asm',
                'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).o'],
                'action': [
                    'yasm',
                    '-fmacho64',
                    '--prefix=_',
                    '<!@(for i in <(_include_dirs); do echo -I $i; done)',
                    '-o', '<@(_outputs)',
                    '<(RULE_INPUT_PATH)',
                ],
                'process_outputs_as_sources': 1,
                'message': 'YASM <(RULE_INPUT_PATH)',
            }],
        }],

        # WINDOWS
        [ 'OS=="win"', {
            'rules': [{
                'rule_name': 'assemble',
                'extension': 'asm',
                'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).obj'],
                'action': [
                    'C:/cygwin64/bin/yasm.exe',
                    '-fwin64',
                    '<!@(for /D %i in (<(_include_dirs)) do @echo -I %i)',
                    '-o', '<@(_outputs)',
                    '<(RULE_INPUT_PATH)',
                ],
                'process_outputs_as_sources': 1,
                'message': 'YASM <(RULE_INPUT_PATH)',
            }],
        }],

    ],
}

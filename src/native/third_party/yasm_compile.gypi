# Copyright (c) 2012 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

# This is an gyp include to use YASM for compiling assembly files.
#
# Files to be compiled with YASM should have an extension of .asm.
#
# There are two variables for this include:
# yasm_flags : Pass additional flags into YASM.
# yasm_output_path : Output directory for the compiled object files.
#
# Sample usage:
# 'sources': [
#   'ultra_optimized_awesome.asm',
# ],
# 'variables': {
#   'yasm_flags': [
#     '-I', 'assembly_include',
#   ],
#   'yasm_output_path': '<(SHARED_INTERMEDIATE_DIR)/project',
# },
# 'includes': [
#   'third_party/yasm/yasm_compile.gypi'
# ],

{
    'variables': {

        'conditions': [

            # Define output extension.
            [ 'OS=="win"', {
                'yasm_path': 'yasm.exe',
                'asm_obj_extension': 'obj',
            }, {
                'yasm_path': '<!(which yasm)',
                'asm_obj_extension': 'o',
            }],

            # Define yasm_flags that pass into YASM.
            [ 'os_posix==1 and OS!="mac" and target_arch=="ia32"', {
                'yasm_flags': [
                    '-felf32',
                    '-m', 'x86',
                ],
            }],
            [ 'os_posix==1 and OS!="mac" and target_arch=="x64"', {
                'yasm_flags': [
                    '-felf64',
                    '-m', 'amd64',
                    '-DPIC',
                ],
            }],
            [ 'OS=="mac" and target_arch=="ia32"', {
                'yasm_flags': [
                    '-fmacho32',
                    '-m', 'x86',
                    '--prefix=_',
                    '-O3',
                ],
            }],
            [ 'OS=="mac" and target_arch=="x64"', {
                'yasm_flags': [
                    '-fmacho64',
                    # '-m', 'x64',
                    '--prefix=_',
                    '-O3',
                ],
            }],
            [ 'OS=="win" and target_arch=="ia32"', {
                'yasm_flags': [
                    '-fwin32',
                    '-m', 'x86',
                    '-DPREFIX',
                ],
            }],
            [ 'OS=="win" and target_arch=="x64"', {
                'yasm_flags': [
                    '-fwin64',
                    # '-m', 'x86',
                    '-DPREFIX',
                ],
            }],

        ],
    },  # variables

    'rules': [{
        'rule_name': 'assemble',
        'extension': 'asm',
        'inputs': ['<(yasm_path)'],
        'outputs': ['<(INTERMEDIATE_DIR)/<(RULE_INPUT_ROOT).<(asm_obj_extension)'],
        'action': [
            '<(yasm_path)',
            '<@(yasm_flags)',
            '-o', '<@(_outputs)',
            '<(RULE_INPUT_PATH)',
        ],
        'process_outputs_as_sources': 1,
        'message': 'Compile assembly <(RULE_INPUT_PATH).',
    }],  # rules

}

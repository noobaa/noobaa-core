# Copyright (C) 2016 NooBaa
{
    'includes': ['common_third_party.gypi'],

    'targets': [

        {
            'target_name': 'isa-l-crc',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l/include/',
                'isa-l/crc/',
            ],
            'sources': [
                'isa-l/crc/crc_base.c',
                'isa-l/crc/crc64_base.c',
                'isa-l/crc/crc16_t10dif_01.asm',
                'isa-l/crc/crc16_t10dif_by4.asm',
                'isa-l/crc/crc32_ieee_01.asm',
                'isa-l/crc/crc32_ieee_by4.asm',
                'isa-l/crc/crc32_iscsi_01.asm',
                'isa-l/crc/crc32_iscsi_00.asm',
                'isa-l/crc/crc_multibinary.asm',
                'isa-l/crc/crc64_multibinary.asm',
                'isa-l/crc/crc64_ecma_refl_by8.asm',
                'isa-l/crc/crc64_ecma_norm_by8.asm',
                'isa-l/crc/crc64_iso_refl_by8.asm',
                'isa-l/crc/crc64_iso_norm_by8.asm',
                'isa-l/crc/crc64_jones_refl_by8.asm',
                'isa-l/crc/crc64_jones_norm_by8.asm',
                'isa-l/crc/crc32_gzip_refl_by8.asm',
            ]
        },

        {
            'target_name': 'isa-l-ec',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l/include/',
                'isa-l/erasure_code/',
            ],
            'sources': [
                'isa-l/erasure_code/ec_base.c',
                'isa-l/erasure_code/ec_highlevel_func.c',
            ],
            # compile asm only for x64 until we have support for ppc
            # see https://github.com/intel/isa-l/issues/7
            'conditions': [ [ 'node_arch=="x64"', { 'sources': [
                'isa-l/erasure_code/ec_multibinary.asm',
                'isa-l/erasure_code/gf_vect_mul_sse.asm',
                'isa-l/erasure_code/gf_vect_dot_prod_sse.asm',
                'isa-l/erasure_code/gf_2vect_dot_prod_sse.asm',
                'isa-l/erasure_code/gf_3vect_dot_prod_sse.asm',
                'isa-l/erasure_code/gf_4vect_dot_prod_sse.asm',
                'isa-l/erasure_code/gf_5vect_dot_prod_sse.asm',
                'isa-l/erasure_code/gf_6vect_dot_prod_sse.asm',
                'isa-l/erasure_code/gf_vect_mad_sse.asm',
                'isa-l/erasure_code/gf_2vect_mad_sse.asm',
                'isa-l/erasure_code/gf_3vect_mad_sse.asm',
                'isa-l/erasure_code/gf_4vect_mad_sse.asm',
                'isa-l/erasure_code/gf_5vect_mad_sse.asm',
                'isa-l/erasure_code/gf_6vect_mad_sse.asm',
                'isa-l/erasure_code/gf_vect_mul_avx.asm',
                'isa-l/erasure_code/gf_vect_dot_prod_avx.asm',
                'isa-l/erasure_code/gf_2vect_dot_prod_avx.asm',
                'isa-l/erasure_code/gf_3vect_dot_prod_avx.asm',
                'isa-l/erasure_code/gf_4vect_dot_prod_avx.asm',
                'isa-l/erasure_code/gf_5vect_dot_prod_avx.asm',
                'isa-l/erasure_code/gf_6vect_dot_prod_avx.asm',
                'isa-l/erasure_code/gf_vect_mad_avx.asm',
                'isa-l/erasure_code/gf_2vect_mad_avx.asm',
                'isa-l/erasure_code/gf_3vect_mad_avx.asm',
                'isa-l/erasure_code/gf_4vect_mad_avx.asm',
                'isa-l/erasure_code/gf_5vect_mad_avx.asm',
                'isa-l/erasure_code/gf_6vect_mad_avx.asm',
                'isa-l/erasure_code/gf_vect_dot_prod_avx2.asm',
                'isa-l/erasure_code/gf_2vect_dot_prod_avx2.asm',
                'isa-l/erasure_code/gf_3vect_dot_prod_avx2.asm',
                'isa-l/erasure_code/gf_4vect_dot_prod_avx2.asm',
                'isa-l/erasure_code/gf_5vect_dot_prod_avx2.asm',
                'isa-l/erasure_code/gf_6vect_dot_prod_avx2.asm',
                'isa-l/erasure_code/gf_vect_mad_avx2.asm',
                'isa-l/erasure_code/gf_2vect_mad_avx2.asm',
                'isa-l/erasure_code/gf_3vect_mad_avx2.asm',
                'isa-l/erasure_code/gf_4vect_mad_avx2.asm',
                'isa-l/erasure_code/gf_5vect_mad_avx2.asm',
                'isa-l/erasure_code/gf_6vect_mad_avx2.asm',
                'isa-l/erasure_code/gf_vect_dot_prod_avx512.asm',
                'isa-l/erasure_code/gf_2vect_dot_prod_avx512.asm',
                'isa-l/erasure_code/gf_3vect_dot_prod_avx512.asm',
                'isa-l/erasure_code/gf_4vect_dot_prod_avx512.asm',
                'isa-l/erasure_code/gf_vect_mad_avx512.asm',
                'isa-l/erasure_code/gf_2vect_mad_avx512.asm',
                'isa-l/erasure_code/gf_3vect_mad_avx512.asm',
                'isa-l/erasure_code/gf_4vect_mad_avx512.asm',
            ]}]],
        },

        {
            'target_name': 'isa-l-rolling-hash',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l_crypto/include/',
                'isa-l_crypto/rolling_hash/',
            ],
            'sources': [
                'isa-l_crypto/rolling_hash/rolling_hashx_base.c',
                'isa-l_crypto/rolling_hash/rolling_hash2.c',
                'isa-l_crypto/rolling_hash/rolling_hash2_until_04.asm',
                'isa-l_crypto/rolling_hash/rolling_hash2_until_00.asm',
                'isa-l_crypto/rolling_hash/rolling_hash2_multibinary.asm',
            ],
        },

        {
            'target_name': 'isa-l-md5',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l_crypto/include/',
                'isa-l_crypto/md5_mb/',
            ],
            'sources': [
                # include
                'isa-l_crypto/include/md5_mb.h',
                'isa-l_crypto/include/types.h',
                'isa-l_crypto/include/multi_buffer.h',
                'isa-l_crypto/include/intrinreg.h',
                'isa-l_crypto/include/reg_sizes.asm',
                'isa-l_crypto/include/multibinary.asm',
                'isa-l_crypto/include/datastruct.asm',
                # asm
                'isa-l_crypto/md5_mb/md5_multibinary.asm',
                'isa-l_crypto/md5_mb/md5_job.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_datastruct.asm',
                # ctx
                # 'isa-l_crypto/md5_mb/md5_ctx_base.c',
                'isa-l_crypto/md5_mb/md5_ctx_sse.c',
                'isa-l_crypto/md5_mb/md5_ctx_avx.c',
                'isa-l_crypto/md5_mb/md5_ctx_avx2.c',
                'isa-l_crypto/md5_mb/md5_ctx_avx512.c',
                # mgr_init
                'isa-l_crypto/md5_mb/md5_mb_mgr_init_sse.c',
                'isa-l_crypto/md5_mb/md5_mb_mgr_init_avx2.c',
                'isa-l_crypto/md5_mb/md5_mb_mgr_init_avx512.c',
                # mgr_flush
                'isa-l_crypto/md5_mb/md5_mb_mgr_flush_sse.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_flush_avx.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_flush_avx2.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_flush_avx512.asm',
                # mgr_submit
                'isa-l_crypto/md5_mb/md5_mb_mgr_submit_sse.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_submit_avx.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_submit_avx2.asm',
                'isa-l_crypto/md5_mb/md5_mb_mgr_submit_avx512.asm',
                # x4x2
                'isa-l_crypto/md5_mb/md5_mb_x4x2_sse.asm',
                'isa-l_crypto/md5_mb/md5_mb_x4x2_avx.asm',
                'isa-l_crypto/md5_mb/md5_mb_x8x2_avx2.asm',
                'isa-l_crypto/md5_mb/md5_mb_x16x2_avx512.asm',
            ],
        },

        {
            'target_name': 'isa-l-sha1',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l_crypto/include/',
                'isa-l_crypto/sha1_mb/',
            ],
            'sources': [
                'isa-l_crypto/sha1_mb/sha1_ctx_sse.c',
                'isa-l_crypto/sha1_mb/sha1_ctx_avx.c',
                'isa-l_crypto/sha1_mb/sha1_ctx_avx2.c',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_init_sse.c',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_init_avx2.c',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_submit_sse.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_submit_avx.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_submit_avx2.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_flush_sse.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_flush_avx.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_flush_avx2.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_x4_sse.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_x4_avx.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_x8_avx2.asm',
                'isa-l_crypto/sha1_mb/sha1_multibinary.asm',
                'isa-l_crypto/sha1_mb/sha1_ctx_avx512.c',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_init_avx512.c',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_submit_avx512.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_flush_avx512.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_x16_avx512.asm',
                'isa-l_crypto/sha1_mb/sha1_opt_x1.asm',
                'isa-l_crypto/sha1_mb/sha1_ni_x1.asm',
                'isa-l_crypto/sha1_mb/sha1_ctx_sse_ni.c',
                'isa-l_crypto/sha1_mb/sha1_ctx_avx512_ni.c',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_submit_sse_ni.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_flush_sse_ni.asm',
                'isa-l_crypto/sha1_mb/sha1_mb_mgr_flush_avx512_ni.asm',
            ],
        },

        {
            'target_name': 'isa-l-sha256',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l_crypto/include/',
                'isa-l_crypto/sha256_mb/',
            ],
            'sources': [
                'isa-l_crypto/sha256_mb/sha256_ctx_sse.c',
                'isa-l_crypto/sha256_mb/sha256_ctx_avx.c',
                'isa-l_crypto/sha256_mb/sha256_ctx_avx2.c',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_init_sse.c',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_init_avx2.c',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_submit_sse.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_submit_avx.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_submit_avx2.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_flush_sse.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_flush_avx.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_flush_avx2.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_x4_sse.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_x4_avx.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_x8_avx2.asm',
                'isa-l_crypto/sha256_mb/sha256_multibinary.asm',
                'isa-l_crypto/sha256_mb/sha256_ctx_avx512.c',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_init_avx512.c',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_submit_avx512.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_flush_avx512.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_x16_avx512.asm',
                'isa-l_crypto/sha256_mb/sha256_opt_x1.asm',
                'isa-l_crypto/sha256_mb/sha256_ni_x1.asm',
                'isa-l_crypto/sha256_mb/sha256_ctx_sse_ni.c',
                'isa-l_crypto/sha256_mb/sha256_ctx_avx512_ni.c',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_submit_sse_ni.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_flush_sse_ni.asm',
                'isa-l_crypto/sha256_mb/sha256_mb_mgr_flush_avx512_ni.asm',
            ],
        },
        
        {
            'target_name': 'isa-l-sha512',
            'type': 'static_library',
            'includes': ['../asm.gypi'],
            'include_dirs': [
                'isa-l_crypto/include/',
                'isa-l_crypto/sha512_mb/',
            ],
            'sources': [
                'isa-l_crypto/sha512_mb/sha512_ctx_sse.c',
                'isa-l_crypto/sha512_mb/sha512_ctx_avx.c',
                'isa-l_crypto/sha512_mb/sha512_ctx_avx2.c',
                'isa-l_crypto/sha512_mb/sha512_ctx_sb_sse4.c',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_init_sse.c',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_init_avx2.c',
                'isa-l_crypto/sha512_mb/sha512_sb_mgr_init_sse4.c',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_submit_sse.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_submit_avx.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_submit_avx2.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_flush_sse.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_flush_avx.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_flush_avx2.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_x2_sse.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_x2_avx.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_x4_avx2.asm',
                'isa-l_crypto/sha512_mb/sha512_multibinary.asm',
                'isa-l_crypto/sha512_mb/sha512_sb_mgr_submit_sse4.c',
                'isa-l_crypto/sha512_mb/sha512_sb_mgr_flush_sse4.c',
                'isa-l_crypto/sha512_mb/sha512_sse4.asm',
                'isa-l_crypto/sha512_mb/sha512_ctx_avx512.c',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_init_avx512.c',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_submit_avx512.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_mgr_flush_avx512.asm',
                'isa-l_crypto/sha512_mb/sha512_mb_x8_avx512.asm',
            ],
        },

        # tests

        {
            'target_name': 'erasure_code_base_perf',
            'type': 'executable',
            'dependencies': ['isa-l-ec'],
            'include_dirs': ['isa-l/include/'],
            'sources': ['isa-l/erasure_code/erasure_code_base_perf.c']
        },

        {
            'target_name': 'erasure_code_base_test',
            'type': 'executable',
            'dependencies': ['isa-l-ec'],
            'include_dirs': ['isa-l/include/'],
            'sources': ['isa-l/erasure_code/erasure_code_base_test.c']
        },

        {
            'target_name': 'erasure_code_perf',
            'type': 'executable',
            'dependencies': ['isa-l-ec'],
            'include_dirs': ['isa-l/include/'],
            'sources': ['isa-l/erasure_code/erasure_code_perf.c']
        },

        {
            'target_name': 'erasure_code_sse_perf',
            'type': 'executable',
            'dependencies': ['isa-l-ec'],
            'include_dirs': ['isa-l/include/'],
            'sources': ['isa-l/erasure_code/erasure_code_sse_perf.c']
        },

        {
            'target_name': 'erasure_code_sse_test',
            'type': 'executable',
            'dependencies': ['isa-l-ec'],
            'include_dirs': ['isa-l/include/'],
            'sources': ['isa-l/erasure_code/erasure_code_sse_test.c']
        },

        {
            'target_name': 'erasure_code_test',
            'type': 'executable',
            'dependencies': ['isa-l-ec'],
            'include_dirs': ['isa-l/include/'],
            'sources': ['isa-l/erasure_code/erasure_code_test.c']
        },

        {
            'target_name': 'md5_mb_test',
            'type': 'executable',
            'dependencies': ['isa-l-md5'],
            'include_dirs': ['isa-l_crypto/include/'],
            'sources': ['isa-l_crypto/md5_mb/md5_mb_test.c']
        },

        {
            # TODO: dynamic linking to openssl usually needs more CFLAGS(-I) and LDFLAGS(-L)
            'target_name': 'md5_mb_vs_ossl_perf',
            'type': 'executable',
            'dependencies': ['isa-l-md5'],
            'include_dirs': ['isa-l_crypto/include/'],
            'ldflags': ['-lssl','-lcrypto'],
            'sources': ['isa-l_crypto/md5_mb/md5_mb_vs_ossl_perf.c']
        },

        {
            'target_name': 'sha256_mb_test',
            'type': 'executable',
            'dependencies': ['isa-l-sha256'],
            'include_dirs': ['isa-l_crypto/include/'],
            'sources': ['isa-l_crypto/sha256_mb/sha256_mb_test.c']
        }
    ],
}

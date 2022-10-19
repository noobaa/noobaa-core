/**********************************************************************
  Copyright(c) 2021 Arm Corporation All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in
      the documentation and/or other materials provided with the
      distribution.
    * Neither the name of Arm Corporation nor the names of its
      contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
**********************************************************************/

#ifndef _MH_SHA1_MURMUR3_AARCH64_INTERNAL_H_
#define _MH_SHA1_MURMUR3_AARCH64_INTERNAL_H_

/**
 *  @file mh_sha1_murmur3_aarch64_internal.h
 *  @brief mh_sha1_murmur3_aarch64 internal function prototypes and macros
 *
 *  Interface for mh_sha1_murmur3_aarch64 internal functions
 *
 */
#include <stdint.h>
#include "mh_sha1_murmur3_x64_128_internal.h"

#ifdef __cplusplus
extern "C" {
#endif

 /**
  * @brief  Calculate blocks which size is MH_SHA1_BLOCK_SIZE*N
  *
  * @requires Crypto Extension
  *
  * @param  input_data Pointer to input data to be processed
  * @param  mh_sha1_digests 16 segments digests
  * @param  frame_buffer Pointer to buffer which is a temp working area
  * @param  murmur3_x64_128_digests Murmur3 digest
  * @param  num_blocks The number of blocks.
  * @returns none
  *
  */
void mh_sha1_murmur3_block_ce(const uint8_t * input_data,
				      uint32_t mh_sha1_digests[SHA1_DIGEST_WORDS][HASH_SEGS],
				      uint8_t frame_buffer[MH_SHA1_BLOCK_SIZE],
				      uint32_t
				      murmur3_x64_128_digests[MURMUR3_x64_128_DIGEST_WORDS],
				      uint32_t num_blocks);

 /**
  * @brief  Calculate blocks which size is MH_SHA1_BLOCK_SIZE*N
  *
  * @requires ASIMD
  *
  * @param  input_data Pointer to input data to be processed
  * @param  mh_sha1_digests 16 segments digests
  * @param  frame_buffer Pointer to buffer which is a temp working area
  * @param  murmur3_x64_128_digests Murmur3 digest
  * @param  num_blocks The number of blocks.
  * @returns none
  *
  */
void mh_sha1_murmur3_block_asimd(const uint8_t * input_data,
				      uint32_t mh_sha1_digests[SHA1_DIGEST_WORDS][HASH_SEGS],
				      uint8_t frame_buffer[MH_SHA1_BLOCK_SIZE],
				      uint32_t
				      murmur3_x64_128_digests[MURMUR3_x64_128_DIGEST_WORDS],
				      uint32_t num_blocks);


#ifdef __cplusplus
}
#endif
#endif

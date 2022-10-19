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

	.arch armv8-a

#include "sha1_asimd_common.S"
.macro sha1_step_16_79_interleave0 windex:req
	// interleaving murmur3 operation
	.if (\windex % 4) == 0
		ldp mur_data1, mur_data2, [mur_data], #16
	.endif
	.if (\windex % 4) == 1
		/* rotate left by 31 bits */
		ror	mur_data1, mur_data1, #64-31
		/* rotate left by 33 bits */
		ror	mur_data2, mur_data2, #64-33
	.endif
	.if (\windex % 4) == 2
		eor	mur_hash1, mur_hash1, mur_data1
		/* rotate left by 27 bits */
		ror	mur_hash1, mur_hash1, #64-27
	.endif
	.if (\windex % 4) == 3
		eor	mur_hash2, mur_hash2, mur_data2
		/* rotate left by 31 bits */
		ror	mur_hash2, mur_hash2, #64-31
	.endif
.endm

.macro sha1_step_16_79_interleave1 windex:req
	// interleaving murmur3 operation
	.if (\windex % 4) == 0
		mul	mur_data1, mur_data1, mur_c1
		mul	mur_data2, mur_data2, mur_c2
	.endif
	.if (\windex % 4) == 1
		mul	mur_data1, mur_data1, mur_c2
		mul	mur_data2, mur_data2, mur_c1
	.endif
	.if (\windex % 4) == 2
		add	mur_hash1, mur_hash1, mur_hash2
		//mur_hash1 = mur_hash1 * 5 + N1
		add	mur_hash1, mur_hash1, mur_hash1, LSL #2
		add	mur_hash1, mur_n1, mur_hash1
	.endif
	.if (\windex % 4) == 3
		add	mur_hash2, mur_hash2, mur_hash1
		// mur_hash2 = mur_hash2 * 5 + N2
		add	mur_hash2, mur_hash2, mur_hash2, LSL #2
		add	mur_hash2, mur_n2, mur_hash2
	.endif
.endm

.macro load_x4_word idx:req
	ld1 {WORD\idx\().16b},[segs_ptr]
	add segs_ptr,segs_ptr,#64
.endm

/*
 * void mh_sha1_murmur3_block_asimd (const uint8_t * input_data,
 *                               uint32_t mh_sha1_digests[SHA1_DIGEST_WORDS][HASH_SEGS],
 *                               uint8_t frame_buffer[MH_SHA1_BLOCK_SIZE],
 *                               uint32_t murmur3_x64_128_digests[MURMUR3_x64_128_DIGEST_WORDS],
 *                               uint32_t num_blocks);
 * arg 0 pointer to input data
 * arg 1 pointer to digests, include segments digests(uint32_t digests[16][5])
 * arg 2 pointer to aligned_frame_buffer which is used to save the big_endian data.
 * arg 3 pointer to murmur3 digest
 * arg 4 number  of 1KB blocks
 */

	input_data	.req	x0
	sha1_digest	.req	x1
	data_buf	.req	x2
	mur_digest	.req	x3
	num_blocks	.req	w4

	src	.req	x5
	dst	.req	x6
	offs	.req	x7
	mh_segs	.req	x8
	tmp	.req	x9
	tmpw	.req	w9
	segs_ptr	.req	x10
	mur_hash1	.req	x11
	mur_hash2	.req	x12
	mur_c1	.req	x13
	mur_c2	.req	x14
	mur_data1	.req	x19
	mur_data2	.req	x20
	mur_data	.req	x21
	mur_n1		.req	x22
	mur_n1_w	.req	w22
	mur_n2		.req	x23
	mur_n2_w	.req	w23
	block_ctr	.req	w24

	.global mh_sha1_murmur3_block_asimd
	.type mh_sha1_murmur3_block_asimd, %function
mh_sha1_murmur3_block_asimd:
	cmp	num_blocks, #0
	beq	.return
	sha1_asimd_save_stack
	stp	x19, x20, [sp, -48]!
	stp	x21, x22, [sp, 16]
	stp	x23, x24, [sp, 32]

	mov	mur_data, input_data
	ldr	mur_hash1, [mur_digest]
	ldr	mur_hash2, [mur_digest, 8]
	adr	mur_c1, C1
	ldr	mur_c1, [mur_c1]
	adr	mur_c2, C2
	ldr	mur_c2, [mur_c2]
	adr	tmp, N1
	ldr	mur_n1_w, [tmp]
	adr	tmp, N2
	ldr	mur_n2_w, [tmp]

	mov	mh_segs, #0
.seg_loops:
	add	segs_ptr,input_data,mh_segs
	mov	offs, #64
	add	src, sha1_digest, mh_segs
	ld1	{VA.4S}, [src], offs
	ld1	{VB.4S}, [src], offs
	ld1	{VC.4S}, [src], offs
	ld1	{VD.4S}, [src], offs
	ld1	{VE.4S}, [src], offs
	mov	block_ctr,num_blocks

.block_loop:
	sha1_single
	subs	block_ctr, block_ctr, 1
	bne	.block_loop

	mov	offs, #64
	add	dst, sha1_digest, mh_segs
	st1	{VA.4S}, [dst], offs
	st1	{VB.4S}, [dst], offs
	st1	{VC.4S}, [dst], offs
	st1	{VD.4S}, [dst], offs
	st1	{VE.4S}, [dst], offs

	add	mh_segs, mh_segs, #16
	cmp	mh_segs, #64
	bne	.seg_loops

	/* save murmur-hash digest */
	str	mur_hash1, [mur_digest], #8
	str	mur_hash2, [mur_digest]

	ldp	x21, x22, [sp, 16]
	ldp	x23, x24, [sp, 32]
	ldp	x19, x20, [sp], 48
	sha1_asimd_restore_stack
.return:
	ret

	.size mh_sha1_murmur3_block_asimd, .-mh_sha1_murmur3_block_asimd
	.section .rodata.cst16,"aM",@progbits,16
	.align  16
KEY_0:
	.word	0x5a827999
	.word	0x5a827999
	.word	0x5a827999
	.word	0x5a827999
KEY_1:
	.word	0x6ed9eba1
	.word	0x6ed9eba1
	.word	0x6ed9eba1
	.word	0x6ed9eba1
KEY_2:
	.word	0x8f1bbcdc
	.word	0x8f1bbcdc
	.word	0x8f1bbcdc
	.word	0x8f1bbcdc
KEY_3:
	.word	0xca62c1d6
	.word	0xca62c1d6
	.word	0xca62c1d6
	.word	0xca62c1d6
N1:
	.word	0x52dce729
	.word	0x52dce729
	.word	0x52dce729
	.word	0x52dce729
N2:
	.word	0x38495ab5
	.word	0x38495ab5
	.word	0x38495ab5
	.word	0x38495ab5
C1:
	.dword	0x87c37b91114253d5
	.dword	0x87c37b91114253d5
C2:
	.dword	0x4cf5ad432745937f
	.dword	0x4cf5ad432745937f

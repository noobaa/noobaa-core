/**********************************************************************
  Copyright(c) 2022 Arm Corporation All rights reserved.

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

#if defined(NO_SVE2)
	.arch armv8.2-a+sve
#else
	.arch armv8.2-a+sve2
#endif


// copying data from sparse memory unto continous stack space
// in oroder to gather-load into SVE registers
.macro copy_mb_16words vecs:req,dest:req
	mov	src,\vecs
	mov	dst,\dest
	mov	counter,total_lanes
10:
	ldr	tmp,[src],8
	ldr	tmp,[tmp]
	add	tmp,tmp,block_ctr,lsl 6
	ld1	{TMPV0.4s,TMPV1.4s,TMPV2.4s,TMPV3.4s}, [tmp]
	st1	{TMPV0.4s,TMPV1.4s,TMPV2.4s,TMPV3.4s}, [dst],64
	subs	counter,counter,1
	b.ne	10b
.endm

.macro load_init
	mov	tmpw,16
	index VOFFS.s,0,tmpw
	copy_mb_16words	job_vec,databuf
.endm

.macro load_word pipelines:req,windex:req,zreg0:req,zreg1
	add	tmp,databuf,\windex * 4
	ld1w	{ \zreg0\().s}, p0/z, [tmp, VOFFS.s, UXTW 2]
	.if	\pipelines > 1
		add	tmp,tmp,veclen,lsl #6
		ld1w	{\zreg1\().s}, p1/z, [tmp, VOFFS.s, UXTW 2]
	.endif
.endm

#include "md5_sve_common.S"

/* int md5_mb_sve_max_lanes()
 */
	.global md5_mb_sve_max_lanes
	.type md5_mb_sve_max_lanes, %function
md5_mb_sve_max_lanes:
	cntw	x0
	add	x0,x0,x0
	ret
	.size md5_mb_sve_max_lanes, .-md5_mb_sve_max_lanes

/*
 *  void md5_mb_sve/sv2(int blocks, int total_lanes, MD5_JOB **job_vec)
 */
	num_blocks	.req	w0
	total_lanes	.req	w1
	job_vec	.req	x2
	src	.req	x5
	dst	.req	x6
	tmp	.req	x8
	tmpw	.req	w8
	block_ctr	.req	x9
	block_ctr_w	.req	w9
	savedsp	.req	x10
	databuf	.req	x11
	counter	.req	w12
	veclen	.req	x13
	veclen_w	.req	w13
	abcd_buf	.req	x14
	md5key_adr	.req	x15

.macro IMPLEMENT_MD5_MB sve2_flag:req
	cbz	num_blocks,.return\sve2_flag\()
	md5_sve_save_stack
	mov	savedsp,sp
	// reserve (16 * lanes) for abcd buf
	mov	tmpw,total_lanes,lsl 4
	sub	abcd_buf,sp,tmp
	// reserve (64 * lanes) for data buf
	mov	tmpw,total_lanes,lsl 6
	sub	databuf,abcd_buf,tmp
	mov	sp,databuf
	adr	md5key_adr,MD5_CONST_KEYS
	whilelo	p0.s,wzr,total_lanes
	mov	src,job_vec
	mov	dst,abcd_buf
	mov	counter,total_lanes
.ldr_hash\sve2_flag\():
	ldr	tmp,[src],8
	add	tmp,tmp,64
	ld1	{v0.16b},[tmp]
	st1	{v0.16b},[dst],16
	subs	counter,counter,1
	bne	.ldr_hash\sve2_flag\()
	ld4w	{VA_0.s,VB_0.s,VC_0.s,VD_0.s},p0/z,[abcd_buf]
	mov	block_ctr,0
	cntp	veclen,p0,p0.s
	cmp	veclen_w,total_lanes
	b.eq	.loop_1x\sve2_flag\()
	whilelo	p1.s,veclen_w,total_lanes
	add	tmp,abcd_buf,veclen,lsl #4
	ld4w	{VA_1.s,VB_1.s,VC_1.s,VD_1.s},p1/z,[tmp]
	b	.loop_2x\sve2_flag\()
.loop_1x\sve2_flag\():
	md5_single	1,\sve2_flag
	add	block_ctr, block_ctr, 1
	cmp	block_ctr_w,num_blocks
	bne	.loop_1x\sve2_flag\()
	st4w	{VA_0.s,VB_0.s,VC_0.s,VD_0.s},p0,[abcd_buf]
	b	1f
.loop_2x\sve2_flag\():
	md5_single	2,\sve2_flag
	add	block_ctr, block_ctr, 1
	cmp	block_ctr_w,num_blocks
	bne	.loop_2x\sve2_flag\()
	st4w	{VA_0.s,VB_0.s,VC_0.s,VD_0.s},p0,[abcd_buf]
	add	tmp,abcd_buf,veclen,lsl #4
	st4w	{VA_1.s,VB_1.s,VC_1.s,VD_1.s},p1,[tmp]
1:
	mov	dst,job_vec
	mov	src,abcd_buf
.str_hash\sve2_flag\():
	ld1	{v0.16b},[src],16
	ldr	tmp,[dst],8
	add	tmp,tmp,64
	st1	{v0.16b},[tmp]
	subs	total_lanes,total_lanes,1
	bne	.str_hash\sve2_flag\()
	mov	sp,savedsp
	md5_sve_restore_stack
.return\sve2_flag\():
	ret
.endm

	.global md5_mb_sve
	.type md5_mb_sve, %function
md5_mb_sve:
.sve_entry:
	IMPLEMENT_MD5_MB 0
	.size md5_mb_sve, .-md5_mb_sve

	.global md5_mb_sve2
	.type md5_mb_sve2, %function
md5_mb_sve2:
#if	!defined(NO_SVE2)
	IMPLEMENT_MD5_MB 1
#else
#warning "SVE2 has been bypassed in the build"
	b	.sve_entry
#endif
	.size md5_mb_sve2, .-md5_mb_sve2

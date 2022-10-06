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

	.arch armv8.2-a+sve

.macro copy_mb_16words vecs:req,dest:req
	mov	src,\vecs
	mov	dst,\dest
	mov	ctr,lanes
1:
	ldr	tmp,[src],8
	ldr	tmp,[tmp]
	add	tmp,tmp,block_ctr,lsl 6
	ld1	{TMPV0.4s,TMPV1.4s,TMPV2.4s,TMPV3.4s}, [tmp]
	st1	{TMPV0.4s,TMPV1.4s,TMPV2.4s,TMPV3.4s}, [dst],64
	subs	ctr,ctr,1
	b.ne	1b
.endm

.macro load_words windex:req
	.if	\windex == 0
		mov	tmpw,16
		index VOFFS.s,0,tmpw
		copy_mb_16words	job_vec,databuf
		mov	dataptr,databuf
	.endif
	ld1w	{ WORD\windex\().s}, p0/z, [dataptr, VOFFS.s, UXTW 2]
	add	dataptr,dataptr,4
.endm

#include "sm3_sve_common.S"

/* int sm3_mb_sve_max_lanes()
 * return : max lanes of SVE vector
 */
	.global sm3_mb_sve_max_lanes
	.type sm3_mb_sve_max_lanes, %function
sm3_mb_sve_max_lanes:
	cntw	x0
	ret
	.size sm3_mb_sve_max_lanes, .-sm3_mb_sve_max_lanes
/*
 *  void sm3_mb_sve(int blocks, int total_lanes, SM3_JOB **job_vec)
 */
	num_blocks	.req	w0
	total_lanes	.req	w1
	job_vec	.req	x2
	lanes	.req	x4
	src	.req	x5
	dst	.req	x6
	lane_offset	.req	w7
	lane_offset_x	.req	x7
	tmp	.req	x8
	tmpw	.req	w8
	block_ctr	.req	x9
	block_ctr_w	.req	w9
	savedsp	.req	x10
	databuf	.req	x11
	dataptr	.req	x12
	efgh_buf	.req	x12
	ctr	.req	x13
	abcd_buf	.req	x14
	sm3const_adr	.req	x15

	.global sm3_mb_sve
	.type sm3_mb_sve, %function
sm3_mb_sve:
	cbz	num_blocks,.return
	sm3_sve_save_stack
	mov	savedsp,sp
	mov	lane_offset, #0
	whilelo	p0.s,	wzr, total_lanes
	// reserve (32 * max lanes) for abcdefgh buf
	cntw	tmp
	lsl	tmp, tmp, 5
	sub	abcd_buf,sp,tmp
	mov	tmp,63
	bic	abcd_buf,abcd_buf,tmp
	// reserve (64 * lanes) for data buf
	cntp	lanes,p0,p0.s
	lsl	tmp,lanes,6
	sub	databuf,abcd_buf,tmp
	mov	sp,databuf
	adr	sm3const_adr,SM3_CONSTS
.seg_loops:
	mov	src,job_vec
	mov	dst,abcd_buf
	cntp	lanes,p0,p0.s
	add	efgh_buf,abcd_buf,lanes,lsl 4
	mov	ctr,lanes
.ldr_hash:
	ldr	tmp,[src],8
	add	tmp,tmp,64
	ld1	{v0.16b, v1.16b},[tmp]
	rev32	v0.16b,v0.16b
	rev32	v1.16b,v1.16b
	st1	{v0.16b},[dst],16
	st1	{v1.16b},[efgh_buf],16
	subs	ctr,ctr,1
	bne	.ldr_hash
	ld4w	{VA.s,VB.s,VC.s,VD.s},p0/z,[abcd_buf]
	add	tmp,abcd_buf,lanes,lsl 4
	ld4w	{VE.s,VF.s,VG.s,VH.s},p0/z,[tmp]
	mov	block_ctr,0
	// always unpredicated SVE mode in current settings
	pred_mode=0
.block_loop:
	sm3_single
	add	block_ctr, block_ctr, 1
	cmp	block_ctr_w,num_blocks
	bne	.block_loop
	st4w	{VA.s,VB.s,VC.s,VD.s},p0,[abcd_buf]
	add	efgh_buf,abcd_buf,lanes,lsl 4
	st4w	{VE.s,VF.s,VG.s,VH.s},p0,[efgh_buf]
	mov	dst,job_vec
	mov	src,abcd_buf
	add	job_vec,job_vec,lanes,lsl 3
	mov	ctr,lanes
.str_hash:
	ld1	{v0.16b},[src],16
	ld1	{v1.16b},[efgh_buf],16
	rev32	v0.16b,v0.16b
	rev32	v1.16b,v1.16b
	ldr	tmp,[dst],8
	add	tmp,tmp,64
	st1	{v0.16b,v1.16b},[tmp]
	subs	ctr,ctr,1
	bne	.str_hash
	incw	lane_offset_x
	whilelo	p0.s,	lane_offset, total_lanes
	b.mi	.seg_loops
	mov	sp,savedsp
	sm3_sve_restore_stack
.return:
	ret
	.size sm3_mb_sve, .-sm3_mb_sve

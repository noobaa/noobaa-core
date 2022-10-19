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

.macro internal_load windex
	// load 64-bytes from each address to maximize usage of cache line
	.if \windex == 0
		mov     tmp,dataptr
		ld1	{WORD0.4s},[data0],16
		ld1	{WORD4.4s},[data0],16
		ld1	{WORD8.4s},[data0],16
		ld1	{WORD12.4s},[data0],16

		ld1	{WORD1.4s},[data1],16
		ld1	{WORD5.4s},[data1],16
		ld1	{WORD9.4s},[data1],16
		ld1	{WORD13.4s},[data1],16

		ld1	{WORD2.4s},[data2],16
		ld1	{WORD6.4s},[data2],16
		ld1	{WORD10.4s},[data2],16
		ld1	{WORD14.4s},[data2],16

		ld1	{WORD3.4s},[data3],16
		ld1	{WORD7.4s},[data3],16
		ld1	{WORD11.4s},[data3],16
		ld1	{WORD15.4s},[data3],16

		st4	{WORD0.s,WORD1.s,WORD2.s,WORD3.s}[0],[tmp],16
		st4	{WORD0.s,WORD1.s,WORD2.s,WORD3.s}[1],[tmp],16
		st4	{WORD0.s,WORD1.s,WORD2.s,WORD3.s}[2],[tmp],16
		st4	{WORD0.s,WORD1.s,WORD2.s,WORD3.s}[3],[tmp],16
	.endif

	.if \windex == 4
		mov     tmp,dataptr
		st4	{WORD4.s,WORD5.s,WORD6.s,WORD7.s}[0],[tmp],16
		st4	{WORD4.s,WORD5.s,WORD6.s,WORD7.s}[1],[tmp],16
		st4	{WORD4.s,WORD5.s,WORD6.s,WORD7.s}[2],[tmp],16
		st4	{WORD4.s,WORD5.s,WORD6.s,WORD7.s}[3],[tmp],16
	.endif

	.if \windex == 8
		mov     tmp,dataptr
		st4	{WORD8.s,WORD9.s,WORD10.s,WORD11.s}[0],[tmp],16
		st4	{WORD8.s,WORD9.s,WORD10.s,WORD11.s}[1],[tmp],16
		st4	{WORD8.s,WORD9.s,WORD10.s,WORD11.s}[2],[tmp],16
		st4	{WORD8.s,WORD9.s,WORD10.s,WORD11.s}[3],[tmp],16
	.endif

	.if \windex == 12
		mov     tmp,dataptr
		st4	{WORD12.s,WORD13.s,WORD14.s,WORD15.s}[0],[tmp],16
		st4	{WORD12.s,WORD13.s,WORD14.s,WORD15.s}[1],[tmp],16
		st4	{WORD12.s,WORD13.s,WORD14.s,WORD15.s}[2],[tmp],16
		st4	{WORD12.s,WORD13.s,WORD14.s,WORD15.s}[3],[tmp],16
	.endif
.endm

.macro load_x4_word idx:req
	internal_load	\idx
	ld1	{WORD\idx\().16b},[dataptr],16
.endm

/*
 *  void sha1_mb_asimd_x4(SHA1_JOB *j0, SHA1_JOB*j1, SHA1_JOB*j2, SHA1_JOB *j3, int blocks)
 */
	job0	.req	x0
	job1	.req	x1
	job2	.req	x2
	job3	.req	x3
	num_blocks	.req	w4
	tmp	.req	x5
	data0	.req	x6
	data1	.req	x7
	data2	.req	x8
	data3	.req	x9
	databuf	.req	x10
	dataptr	.req	x11
	savedsp	.req	x12

	.global sha1_mb_asimd_x4
	.type sha1_mb_asimd_x4, %function
sha1_mb_asimd_x4:
	cmp	num_blocks, #0
	beq	.return
	sha1_asimd_save_stack
	mov	savedsp,sp
	sub	databuf,sp,256
	mov	tmp,63
	bic	databuf,databuf,tmp
	mov	sp,databuf

	add	tmp,job0,64
	ld4 {VA.s,VB.s,VC.s,VD.s}[0],[tmp],#16
	ld1	{VE.s}[0],[tmp]
	ldr	data0,[job0]

	add	tmp,job1,64
	ld4 {VA.s,VB.s,VC.s,VD.s}[1],[tmp],#16
	ld1	{VE.s}[1],[tmp]
	ldr	data1,[job1]

	add	tmp,job2,64
	ld4 {VA.s,VB.s,VC.s,VD.s}[2],[tmp],#16
	ld1	{VE.s}[2],[tmp]
	ldr	data2,[job2]

	add	tmp,job3,64
	ld4 {VA.s,VB.s,VC.s,VD.s}[3],[tmp],#16
	ld1	{VE.s}[3],[tmp]
	ldr	data3,[job3]

.block_loop:
	mov	dataptr,databuf
	sha1_single
	subs	num_blocks, num_blocks, 1
	bne	.block_loop

	add	tmp,job0,64
	st4 {VA.s,VB.s,VC.s,VD.s}[0],[tmp],#16
	st1	{VE.s}[0],[tmp]

	add	tmp,job1,64
	st4 {VA.s,VB.s,VC.s,VD.s}[1],[tmp],#16
	st1	{VE.s}[1],[tmp]

	add	tmp,job2,64
	st4 {VA.s,VB.s,VC.s,VD.s}[2],[tmp],#16
	st1	{VE.s}[2],[tmp]

	add	tmp,job3,64
	st4 {VA.s,VB.s,VC.s,VD.s}[3],[tmp],#16
	st1	{VE.s}[3],[tmp]

	mov	sp,savedsp
	sha1_asimd_restore_stack
.return:
	ret

	.size sha1_mb_asimd_x4, .-sha1_mb_asimd_x4
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

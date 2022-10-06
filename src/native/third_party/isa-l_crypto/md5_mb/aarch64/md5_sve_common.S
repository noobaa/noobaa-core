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
	VK	.req z0
	VOFFS	.req z1
	VA_0	.req z2
	VB_0	.req z3
	VC_0	.req z4
	VD_0	.req z5
	VF_0	.req z6
	VF_1	.req z7
	VA_1	.req z16
	VB_1	.req z17
	VC_1	.req z18
	VD_1	.req z19
	MD5WORD0_0	.req z20
	MD5WORD1_0	.req z21
	MD5WORD0_1	.req z22
	MD5WORD1_1	.req z23
	TMPV0	.req v20
	TMPV1	.req v21
	TMPV2	.req v22
	TMPV3	.req v23
	VTMP_0	.req z24
	VAA_0	.req z25
	VBB_0	.req z26
	VCC_0	.req z27
	VDD_0	.req z28
	VTMP_1	.req z29
	VAA_1	.req z30
	VBB_1	.req z31
	VCC_1	.req z8
	VDD_1	.req z9
	VZERO	.req z10
	TT	.req z0

.macro rotate_left_x1	out:req,in:req,tmp:req,bits
	.if \bits == 16
		revh	\out\().s,p0/m,\in\().s
	.else
		.if have_sve2 == 0
			lsl	\tmp\().s, \in\().s,\bits
			lsr	\out\().s,\in\().s,32-\bits
			orr	\out\().d,\out\().d,\tmp\().d
		.else
			movprfx	\out,\in
			xar	\out\().s,\out\().s,VZERO.s,32-\bits
		.endif
	.endif
.endm

.macro rotate_left_x2	out:req,in:req,tmp:req,bits,out1:req,in1:req,tmp1:req,bits1
	.if \bits == 16
		revh	\out\().s,p0/m,\in\().s
		revh	\out1\().s,p0/m,\in1\().s
	.else
		.if have_sve2 == 0
			lsl	\tmp\().s, \in\().s,\bits
			lsl	\tmp1\().s, \in1\().s,\bits1
			lsr	\out\().s,\in\().s,32-\bits
			lsr	\out1\().s,\in1\().s,32-\bits1
			orr	\out\().d,\out\().d,\tmp\().d
			orr	\out1\().d,\out1\().d,\tmp1\().d
		.else
			movprfx	\out,\in
			xar	\out\().s,\out\().s,VZERO.s,32-\bits
			movprfx	\out1,\in1
			xar	\out1\().s,\out1\().s,VZERO.s,32-\bits1
		.endif
	.endif
.endm

.macro bsl_x1	ret:req,x:req,y:req,z:req,tmp:req
	.if have_sve2 == 0
		bic	\ret\().d,\z\().d,\x\().d
		and	\tmp\().d,\x\().d,\y\().d
		orr	\ret\().d,\ret\().d,\tmp\().d
	.else
		movprfx	\ret,\y
		bsl	\ret\().d,\ret\().d,\z\().d,\x\().d
	.endif
.endm

.macro bsl_x2	ret:req,x:req,y:req,z:req,tmp:req,ret1:req,x1:req,y1:req,z1:req,tmp1:req
	.if have_sve2 == 0
		bic	\ret\().d,\z\().d,\x\().d
		bic	\ret1\().d,\z1\().d,\x1\().d
		and	\tmp\().d,\x\().d,\y\().d
		and	\tmp1\().d,\x1\().d,\y1\().d
		orr	\ret\().d,\ret\().d,\tmp\().d
		orr	\ret1\().d,\ret1\().d,\tmp1\().d
	.else
		movprfx	\ret,\y
		bsl	\ret\().d,\ret\().d,\z\().d,\x\().d
		movprfx	\ret1,\y1
		bsl	\ret1\().d,\ret1\().d,\z1\().d,\x1\().d
	.endif
.endm


// F = D ^ (B and (C xor D))
// that is (B and C) or ((not B) and D)
.macro FUNC_F0_x1
	bsl_x1	VF_0,VB_0,VC_0,VD_0,VTMP_0
.endm

.macro FUNC_F0_x2
	bsl_x2	VF_0,VB_0,VC_0,VD_0,VTMP_0,VF_1,VB_1,VC_1,VD_1,VTMP_1
.endm

// F = C xor (D and (B xor C))
// that is (D and B) or ((not D) and C)
.macro FUNC_F1_x1
	bsl_x1	VF_0,VD_0,VB_0,VC_0,VTMP_0
.endm

.macro FUNC_F1_x2
	bsl_x2	VF_0,VD_0,VB_0,VC_0,VTMP_0,VF_1,VD_1,VB_1,VC_1,VTMP_1
.endm

// F := B xor C xor D
.macro FUNC_F2_x1
	.if have_sve2 == 0
		eor	VF_0.d,VB_0.d,VC_0.d
		eor	VF_0.d,VF_0.d,VD_0.d
	.else
		movprfx	VF_0,VB_0
		eor3	VF_0.d,VF_0.d,VC_0.d,VD_0.d
	.endif
.endm

.macro FUNC_F2_x2
	.if have_sve2 == 0
		eor	VF_0.d,VB_0.d,VC_0.d
		eor	VF_1.d,VB_1.d,VC_1.d
		eor	VF_0.d,VF_0.d,VD_0.d
		eor	VF_1.d,VF_1.d,VD_1.d
	.else
		movprfx	VF_0,VB_0
		eor3	VF_0.d,VF_0.d,VC_0.d,VD_0.d
		movprfx	VF_1,VB_1
		eor3	VF_1.d,VF_1.d,VC_1.d,VD_1.d
	.endif
.endm

// F := C xor (B or (not D))
.macro FUNC_F3_x1
	not	VF_0.s,p0/m,VD_0.s
	orr	VF_0.d,VF_0.d,VB_0.d
	eor	VF_0.d,VF_0.d,VC_0.d
.endm

.macro FUNC_F3_x2
	not	VF_0.s,p0/m,VD_0.s
	not	VF_1.s,p0/m,VD_1.s
	orr	VF_0.d,VF_0.d,VB_0.d
	orr	VF_1.d,VF_1.d,VB_1.d
	eor	VF_0.d,VF_0.d,VC_0.d
	eor	VF_1.d,VF_1.d,VC_1.d
.endm

.macro SWAP_STATES
	.unreq TT
	TT .req VA_0
	.unreq VA_0
	VA_0 .req VD_0
	.unreq VD_0
	VD_0 .req VC_0
	.unreq VC_0
	VC_0 .req VB_0
	.unreq VB_0
	VB_0 .req TT

	.unreq TT
	TT .req VA_1
	.unreq VA_1
	VA_1 .req VD_1
	.unreq VD_1
	VD_1 .req VC_1
	.unreq VC_1
	VC_1 .req VB_1
	.unreq VB_1
	VB_1 .req TT
.endm

.macro MD5_STEP_x1	windex:req,mg:req,func_f:req,bits:req
	ld1rw	{VK.s},p0/z,[md5key_adr,windex * 4]
	\func_f\()_x1
	add	VTMP_0.s,VA_0.s,\mg\()_0.s
	add	VF_0.s,VF_0.s,VK.s
	add	VF_0.s,VF_0.s,VTMP_0.s
	rotate_left_x1	VA_0,VF_0,VTMP_0,\bits
	add	VA_0.s,VA_0.s,VB_0.s
.endm

.macro MD5_STEP_x2	windex:req,mg:req,func_f:req,bits:req
	ld1rw	{VK.s},p0/z,[md5key_adr,windex * 4]
	\func_f\()_x2
	add	VTMP_0.s,VA_0.s,\mg\()_0.s
	add	VTMP_1.s,VA_1.s,\mg\()_1.s
	add	VF_0.s,VF_0.s,VK.s
	add	VF_1.s,VF_1.s,VK.s
	add	VF_0.s,VF_0.s,VTMP_0.s
	add	VF_1.s,VF_1.s,VTMP_1.s
	rotate_left_x2	VA_0,VF_0,VTMP_0,\bits,VA_1,VF_1,VTMP_1,\bits
	add	VA_0.s,VA_0.s,VB_0.s
	add	VA_1.s,VA_1.s,VB_1.s
.endm

.altmacro
.macro load_words	index:req,mg:req
	load_word	%num_pipelines,\index,MD5WORD\mg\()_0,MD5WORD\mg\()_1
.endm

.macro MD5_STEP_WRAPPER pipelines:req,windex:req,gindex:req,mg:req,func_f:req,bits:req,gindex_next,mg_next
	.ifnb \gindex_next
		load_words	\gindex_next,\mg_next
	.endif
	MD5_STEP_x\pipelines\()	\windex,MD5WORD\mg\(),\func_f,\bits
.endm

.macro exec_step windex:req,gindex:req,bits:req,gindex_next
	.if \windex % 2 == 0
		mg=0
		mg_next=1
	.else
		mg=1
		mg_next=0
	.endif

	.if \windex <= 15
		MD5_STEP_WRAPPER	%num_pipelines,\windex,\gindex,%mg,FUNC_F0,\bits,\gindex_next,%mg_next
	.endif
	.if \windex >= 16 && \windex <= 31
		MD5_STEP_WRAPPER	%num_pipelines,\windex,\gindex,%mg,FUNC_F1,\bits,\gindex_next,%mg_next
	.endif
	.if \windex >= 32 && \windex <= 47
		MD5_STEP_WRAPPER	%num_pipelines,\windex,\gindex,%mg,FUNC_F2,\bits,\gindex_next,%mg_next
	.endif
	.if \windex >= 48 && \windex < 63
		MD5_STEP_WRAPPER	%num_pipelines,\windex,\gindex,%mg,FUNC_F3,\bits,\gindex_next,%mg_next
	.endif
	.if \windex == 63
		MD5_STEP_WRAPPER	%num_pipelines,\windex,\gindex,%mg,FUNC_F3,\bits
	.endif
	SWAP_STATES
.endm

.macro exec_steps
	exec_step 0,0,7,1
	exec_step 1,1,12,2
	exec_step 2,2,17,3
	exec_step 3,3,22,4
	exec_step 4,4,7,5
	exec_step 5,5,12,6
	exec_step 6,6,17,7
	exec_step 7,7,22,8
	exec_step 8,8,7,9
	exec_step 9,9,12,10
	exec_step 10,10,17,11
	exec_step 11,11,22,12
	exec_step 12,12,7,13
	exec_step 13,13,12,14
	exec_step 14,14,17,15
	exec_step 15,15,22,1
	exec_step 16,1,5,6
	exec_step 17,6,9,11
	exec_step 18,11,14,0
	exec_step 19,0,20,5
	exec_step 20,5,5,10
	exec_step 21,10,9,15
	exec_step 22,15,14,4
	exec_step 23,4,20,9
	exec_step 24,9,5,14
	exec_step 25,14,9,3
	exec_step 26,3,14,8
	exec_step 27,8,20,13
	exec_step 28,13,5,2
	exec_step 29,2,9,7
	exec_step 30,7,14,12
	exec_step 31,12,20,5
	exec_step 32,5,4,8
	exec_step 33,8,11,11
	exec_step 34,11,16,14
	exec_step 35,14,23,1
	exec_step 36,1,4,4
	exec_step 37,4,11,7
	exec_step 38,7,16,10
	exec_step 39,10,23,13
	exec_step 40,13,4,0
	exec_step 41,0,11,3
	exec_step 42,3,16,6
	exec_step 43,6,23,9
	exec_step 44,9,4,12
	exec_step 45,12,11,15
	exec_step 46,15,16,2
	exec_step 47,2,23,0
	exec_step 48,0,6,7
	exec_step 49,7,10,14
	exec_step 50,14,15,5
	exec_step 51,5,21,12
	exec_step 52,12,6,3
	exec_step 53,3,10,10
	exec_step 54,10,15,1
	exec_step 55,1,21,8
	exec_step 56,8,6,15
	exec_step 57,15,10,6
	exec_step 58,6,15,13
	exec_step 59,13,21,4
	exec_step 60,4,6,11
	exec_step 61,11,10,2
	exec_step 62,2,15,9
	exec_step 63,9,21
.endm

.macro prepare_x1
	load_words	0,0
	orr	VAA_0.d,VA_0.d,VA_0.d
	orr	VBB_0.d,VB_0.d,VB_0.d
	orr	VCC_0.d,VC_0.d,VC_0.d
	orr	VDD_0.d,VD_0.d,VD_0.d
.endm

.macro prepare_x2
	load_words	0,0
	orr	VAA_0.d,VA_0.d,VA_0.d
	orr	VAA_1.d,VA_1.d,VA_1.d
	orr	VBB_0.d,VB_0.d,VB_0.d
	orr	VBB_1.d,VB_1.d,VB_1.d
	orr	VCC_0.d,VC_0.d,VC_0.d
	orr	VCC_1.d,VC_1.d,VC_1.d
	orr	VDD_0.d,VD_0.d,VD_0.d
	orr	VDD_1.d,VD_1.d,VD_1.d
.endm

.macro finish_x1
	add	VA_0.s,VA_0.s,VAA_0.s
	add	VB_0.s,VB_0.s,VBB_0.s
	add	VC_0.s,VC_0.s,VCC_0.s
	add	VD_0.s,VD_0.s,VDD_0.s
.endm

.macro finish_x2
	add	VA_0.s,VA_0.s,VAA_0.s
	add	VA_1.s,VA_1.s,VAA_1.s
	add	VB_0.s,VB_0.s,VBB_0.s
	add	VB_1.s,VB_1.s,VBB_1.s
	add	VC_0.s,VC_0.s,VCC_0.s
	add	VC_1.s,VC_1.s,VCC_1.s
	add	VD_0.s,VD_0.s,VDD_0.s
	add	VD_1.s,VD_1.s,VDD_1.s
.endm

.macro md5_single	pipelines:req,sve2_flag:req
	.if	\sve2_flag == 1
		have_sve2=1
		dup	VZERO.s,#0
	.else
		have_sve2=0
	.endif
	num_pipelines=\pipelines
	load_init

	prepare_x\pipelines\()
	exec_steps
	finish_x\pipelines\()
.endm

.macro md5_sve_save_stack
	stp	d8,d9,[sp, -32]!
	stp	d10,d11,[sp, 16]
.endm

.macro md5_sve_restore_stack
	ldp	d10,d11,[sp, 16]
	ldp	d8,d9,[sp],32
.endm

	.section .rodata.cst16,"aM",@progbits,16
	.align  16

MD5_CONST_KEYS:
	.word 0xd76aa478
	.word 0xe8c7b756
	.word 0x242070db
	.word 0xc1bdceee
	.word 0xf57c0faf
	.word 0x4787c62a
	.word 0xa8304613
	.word 0xfd469501
	.word 0x698098d8
	.word 0x8b44f7af
	.word 0xffff5bb1
	.word 0x895cd7be
	.word 0x6b901122
	.word 0xfd987193
	.word 0xa679438e
	.word 0x49b40821
	.word 0xf61e2562
	.word 0xc040b340
	.word 0x265e5a51
	.word 0xe9b6c7aa
	.word 0xd62f105d
	.word 0x02441453
	.word 0xd8a1e681
	.word 0xe7d3fbc8
	.word 0x21e1cde6
	.word 0xc33707d6
	.word 0xf4d50d87
	.word 0x455a14ed
	.word 0xa9e3e905
	.word 0xfcefa3f8
	.word 0x676f02d9
	.word 0x8d2a4c8a
	.word 0xfffa3942
	.word 0x8771f681
	.word 0x6d9d6122
	.word 0xfde5380c
	.word 0xa4beea44
	.word 0x4bdecfa9
	.word 0xf6bb4b60
	.word 0xbebfbc70
	.word 0x289b7ec6
	.word 0xeaa127fa
	.word 0xd4ef3085
	.word 0x04881d05
	.word 0xd9d4d039
	.word 0xe6db99e5
	.word 0x1fa27cf8
	.word 0xc4ac5665
	.word 0xf4292244
	.word 0x432aff97
	.word 0xab9423a7
	.word 0xfc93a039
	.word 0x655b59c3
	.word 0x8f0ccc92
	.word 0xffeff47d
	.word 0x85845dd1
	.word 0x6fa87e4f
	.word 0xfe2ce6e0
	.word 0xa3014314
	.word 0x4e0811a1
	.word 0xf7537e82
	.word 0xbd3af235
	.word 0x2ad7d2bb
	.word 0xeb86d391

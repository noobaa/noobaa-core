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

// macro F = (D ^ (B & (C ^ D)))
.macro FUNC_F0
	eor	VF.16b, VC.16b, VD.16b
	and	VF.16b, VB.16b, VF.16b
	eor	VF.16b, VD.16b, VF.16b
.endm

// F = (B ^ C ^ D)
.macro FUNC_F1
	eor	VF.16b, VB.16b, VC.16b
	eor	VF.16b, VF.16b, VD.16b
.endm

// F = ((B & C) | (B & D) | (C & D))
.macro FUNC_F2
	and	vT0.16b, VB.16b, VC.16b
	and	vT1.16b, VB.16b, VD.16b
	and	vT2.16b, VC.16b, VD.16b
	orr	VF.16b, vT0.16b, vT1.16b
	orr	VF.16b, VF.16b, vT2.16b
.endm

// F = (B ^ C ^ D)
.macro FUNC_F3
	FUNC_F1
.endm

.altmacro
.macro load_next_word windex
	.if \windex < 16
		load_x4_word	\windex
	.endif
.endm

// FUNC_F0 is merged into STEP_00_15 for efficiency
.macro SHA1_STEP_00_15_F0 windex:req
	rev32	WORD\windex\().16b,WORD\windex\().16b
	next_word=\windex+1
	load_next_word %next_word
	// e = (a leftrotate 5) + f + e + k + w[i]
	ushr	VT.4s, VA.4s, 32 - 5
	add	VE.4s, VE.4s, VK.4s
	sli	VT.4s, VA.4s, 5
	eor	VF.16b, VC.16b, VD.16b
	add	VE.4s, VE.4s, WORD\windex\().4s
	and	VF.16b, VB.16b, VF.16b
	add	VE.4s, VE.4s, VT.4s
	eor	VF.16b, VD.16b, VF.16b
	ushr	VT.4s, VB.4s, 32 - 30
	add	VE.4s, VE.4s, VF.4s
	sli	VT.4s, VB.4s, 30
.endm

.macro SHA1_STEP_16_79 windex:req,func_f:req,reg_3:req,reg_8:req,reg_14:req,reg_16:req
	eor	vT0.16b,\reg_3\().16b,\reg_8\().16b
	eor	VT.16b,\reg_14\().16b,\reg_16\().16b
	eor	vT0.16b,vT0.16b,VT.16b
	// e = (a leftrotate 5) + f + e + k + w[i]
	ushr	VT.4s, vT0.4s, 32 - 1
	add	VE.4s, VE.4s, VK.4s
	ushr	vT1.4s, VA.4s, 32 - 5
	sli	VT.4s, vT0.4s, 1
	add	VE.4s, VE.4s, VT.4s
	sli	vT1.4s, VA.4s, 5
	mov	\reg_16\().16b,VT.16b
	add	VE.4s, VE.4s, vT1.4s
	ushr	VT.4s, VB.4s, 32 - 30
	\func_f
	add	VE.4s, VE.4s, VF.4s
	sli	VT.4s, VB.4s, 30
.endm

	VA	.req v0
	VB	.req v1
	VC	.req v2
	VD	.req v3
	VE	.req v4
	VT	.req v5
	VF	.req v6
	VK	.req v7
	WORD0	.req v8
	WORD1	.req v9
	WORD2	.req v10
	WORD3	.req v11
	WORD4	.req v12
	WORD5	.req v13
	WORD6	.req v14
	WORD7	.req v15
	WORD8	.req v16
	WORD9	.req v17
	WORD10	.req v18
	WORD11	.req v19
	WORD12	.req v20
	WORD13	.req v21
	WORD14	.req v22
	WORD15	.req v23
	vT0	.req v24
	vT1	.req v25
	vT2	.req v26
	vAA	.req v27
	vBB	.req v28
	vCC	.req v29
	vDD	.req v30
	vEE	.req v31
	TT	.req v0
	sha1key_adr	.req	x15

.macro SWAP_STATES
	// shifted VB is held in VT after each step
	.unreq TT
	TT .req VE
	.unreq VE
	VE .req VD
	.unreq VD
	VD .req VC
	.unreq VC
	VC .req VT
	.unreq	VT
	VT .req VB
	.unreq VB
	VB .req VA
	.unreq VA
	VA .req TT
.endm

.altmacro
.macro SHA1_STEP_16_79_WRAPPER windex:req,func_f:req,idx3:req,idx8:req,idx14:req,idx16:req
	SHA1_STEP_16_79 \windex,\func_f,WORD\idx3\(),WORD\idx8\(),WORD\idx14\(),WORD\idx16\()
.endm

.macro exec_step windex:req
	.if \windex <= 15
		SHA1_STEP_00_15_F0	windex
	.else
		idx14=((\windex - 14) & 15)
		idx8=((\windex - 8) & 15)
		idx3=((\windex - 3) & 15)
		idx16=(\windex & 15)
		.if \windex <= 19
			SHA1_STEP_16_79_WRAPPER	\windex,FUNC_F0,%idx3,%idx8,%idx14,%idx16
		.endif
		.if \windex >= 20 && \windex <= 39
			SHA1_STEP_16_79_WRAPPER	\windex,FUNC_F1,%idx3,%idx8,%idx14,%idx16
		.endif
		.if \windex >= 40 && \windex <= 59
			SHA1_STEP_16_79_WRAPPER	\windex,FUNC_F2,%idx3,%idx8,%idx14,%idx16
		.endif
		.if \windex >= 60 && \windex <= 79
			SHA1_STEP_16_79_WRAPPER	\windex,FUNC_F3,%idx3,%idx8,%idx14,%idx16
		.endif
	.endif

	SWAP_STATES

	.if \windex == 79
		// after 80 steps, the registers ABCDET has shifted from
		// its orignal order of 012345 to 341520
		// have to swap back for both compile- and run-time correctness
		mov	v0.16b,v3.16b
		.unreq VA
		VA	.req v0

		mov	vT0.16b,v2.16b
		mov	v2.16b,v1.16b
		mov	v1.16b,v4.16b
		.unreq VB
		VB	.req v1
		.unreq VC
		VC	.req v2

		mov	v3.16b,v5.16b
		.unreq VD
		VD	.req v3

		mov	v4.16b,vT0.16b
		.unreq VE
		VE	.req v4

		.unreq VT
		VT	.req v5
	.endif
.endm

.macro exec_steps idx:req,more:vararg
	exec_step	\idx
	.ifnb \more
		exec_steps	\more
	.endif
.endm

.macro sha1_single
	load_x4_word 0

	mov	vAA.16B, VA.16B
	mov	vBB.16B, VB.16B
	mov	vCC.16B, VC.16B
	mov	vDD.16B, VD.16B
	mov	vEE.16B, VE.16B

	adr	sha1key_adr, KEY_0
	ld1	{VK.4s}, [sha1key_adr]
	exec_steps	0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19

	// 20 ~ 39
	adr	sha1key_adr, KEY_1
	ld1	{VK.4s}, [sha1key_adr]
	exec_steps	20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39

	// 40 ~ 59
	adr	sha1key_adr, KEY_2
	ld1	{VK.4s}, [sha1key_adr]
	exec_steps	40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59

	// 60 ~ 79
	adr	sha1key_adr, KEY_3
	ld1	{VK.4s}, [sha1key_adr]
	exec_steps	60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79

	add	VA.4s, vAA.4s, VA.4s
	add	VB.4s, vBB.4s, VB.4s
	add	VC.4s, vCC.4s, VC.4s
	add	VD.4s, vDD.4s, VD.4s
	add	VE.4s, vEE.4s, VE.4s
.endm

.macro sha1_asimd_save_stack
	stp	d8,d9,[sp, -64]!
	stp	d10,d11,[sp, 16]
	stp	d12,d13,[sp, 32]
	stp	d14,d15,[sp, 48]
.endm

.macro sha1_asimd_restore_stack
	ldp	d10,d11,[sp, 16]
	ldp	d12,d13,[sp, 32]
	ldp	d14,d15,[sp, 48]
	ldp	d8,d9,[sp],64
.endm

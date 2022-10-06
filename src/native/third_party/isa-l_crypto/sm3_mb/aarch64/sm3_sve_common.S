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
	VA	.req z0
	VB	.req z1
	VC	.req z2
	VD	.req z3
	VE	.req z4
	VF	.req z5
	VG	.req z6
	VH	.req z7
	TMPV0	.req v8
	TMPV1	.req v9
	TMPV2	.req v10
	TMPV3	.req v11
	WORD0	.req z8
	WORD1	.req z9
	WORD2	.req z10
	WORD3	.req z11
	WORD4	.req z12
	WORD5	.req z13
	WORD6	.req z14
	WORD7	.req z15
	WORD8	.req z16
	WORD9	.req z17
	WORD10	.req z18
	WORD11	.req z19
	WORD12	.req z20
	WORD13	.req z21
	WORD14	.req z22
	WORD15	.req z23
	WORD16	.req z24
	VOFFS	.req z24	// reuse WORD16
	SS1	.req z25
	SS2	.req z26
	VT	.req z26	// reuse SS2
	TT2	.req z27
	VT1	.req z28
	VT2	.req z29
	VT3	.req z30
	VT4	.req z31
	VZERO	.req z31
	TT	.req z0

.macro sve_op	inst:req,regd,args:vararg
	.if	pred_mode == 1
		\inst	\regd,p0/m,\args
	.else
		\inst	\regd,\args
	.endif
.endm

.macro sve_bitop	inst:req,regd:req,regm:req
	.if	pred_mode == 1
		\inst	\regd\().s,p0/m,\regd\().s,\regm\().s
	.else
		\inst	\regd\().d,\regd\().d,\regm\().d
	.endif
.endm

.macro rotate_left0	out:req,in:req,tmp:req,bits:req,args:vararg
	.if	have_sve2 == 0
		lsl	\tmp\().s,\in\().s,\bits
	.else
		movprfx	\out\().d,\in\().d
		xar	\out\().s,\out\().s,VZERO.s,32-\bits
	.endif

	.ifnb	\args
		rotate_left0	\args
	.endif
.endm

.macro rotate_left1	out:req,in:req,tmp:req,bits:req,args:vararg
	.if	have_sve2 == 0
		lsr	\out\().s,\in\().s,32-\bits
	.endif

	.ifnb	\args
		rotate_left1	\args
	.endif
.endm

.macro rotate_left2	out:req,in:req,tmp:req,bits:req,args:vararg
	.if	have_sve2 == 0
		orr	\out\().d,\out\().d,\tmp\().d
	.endif

	.ifnb	\args
		rotate_left2	\args
	.endif
.endm

.macro rotate_left	args:vararg
	rotate_left0	\args
	rotate_left1	\args
	rotate_left2	\args
.endm

.macro SVE_EOR3 rd:req,r1:req,r2:req
	.if	have_sve2 == 0
		sve_bitop	eor,\rd,\r1
		sve_bitop	eor,\rd,\r2
	.else
		eor3	\rd\().d,\rd\().d,\r1\().d,\r2\().d
	.endif
.endm

.macro FUNC_EOR3	ret:req,x:req,y:req,z:req
	.if	have_sve2 == 0
		eor	\ret\().d,\x\().d,\y\().d
		sve_bitop	eor,\ret,\z
	.else
		movprfx	\ret\().d,\x\().d
		eor3	\ret\().d,\ret\().d,\y\().d,\z\().d
	.endif
.endm

.macro FUNC_FF	windex:req,ret:req,x:req,y:req,z:req,tmp1:req,tmp2:req
	and	\ret\().d,\x\().d,\y\().d
	and	\tmp1\().d,\x\().d,\z\().d
	and	\tmp2\().d,\y\().d,\z\().d
	sve_bitop	orr,\ret,\tmp1
	sve_bitop	orr,\ret,\tmp2
.endm

.macro FUNC_BSL	ret:req,x:req,y:req,z:req,tmp:req
	.if have_sve2 == 0
		bic	\ret\().d,\z\().d,\x\().d
		and	\tmp\().d,\x\().d,\y\().d
		sve_bitop	orr,\ret,\tmp
	.else
		movprfx	\ret\().d,\x\().d
		bsl	\ret\().d,\ret\().d,\y\().d,\z\().d
	.endif
.endm

.altmacro
.macro load_next_words windex
	.if \windex < 16
		load_words	\windex
	.endif
.endm

.macro SM3_STEP_00_11 windex:req,w:req,w4:req
	// SS1 = rol32(rol32(a, 12) + e + rol32(T, (j % 32)), 7)
	ld1rw	{VT2.s},p0/z,[sm3const_adr,\windex * 4]
	rotate_left	SS1,VA,VT1,12
	mov	SS2.s,p0/m,SS1.s
	sve_op	add,SS1.s,SS1.s,VE.s
	sve_op	add,SS1.s,SS1.s,VT2.s
	rotate_left	SS1,SS1,VT2,7
	// d <- TT2 = GG(index, e, f, g) + h + SS1 + W[index]
	add	VT2.s,\w\().s,VH.s
	FUNC_EOR3	TT2,VE,VF,VG
	// SS2 = SS1 ^ rol32(a, 12)
	sve_bitop	eor,SS2,SS1
	sve_op	add,TT2.s,TT2.s,VT2.s
	// h <- TT1 = FF(index, a, b, c) + d + SS2 + WB[index]
	FUNC_EOR3	VH,VA,VB,VC
	eor	VT1.d,\w\().d,\w4\().d
	sve_op	add,VH.s,VH.s,VD.s
	sve_op	add,VH.s,VH.s,VT1.s
	add	VD.s,TT2.s,SS1.s
	sve_op	add,VH.s,VH.s,SS2.s
	// d = P0(TT2)
	rotate_left	VT1,VD,VT2,9,VT3,VD,VT4,17
	SVE_EOR3	VD,VT1,VT3
	// b = rol32(b, 9)
	// f = rol32(f, 19)
	rotate_left	VB,VB,VT3,9,VF,VF,VT4,19
.endm

.macro SM3_STEP_12_15 windex:req,w:req,w4:req,w16:req,w13:req,w9:req,w6:req,w3:req
	// SS1 = rol32(rol32(a, 12) + e + rol32(T, (j % 32)), 7)
	rotate_left	VT,\w3,VT1,15,\w4,\w13,VT2,7,SS1,VA,VT3,12
	ld1rw	{VT1.s},p0/z,[sm3const_adr,\windex * 4]
	mov	TT2.s,p0/m,SS1.s
	sve_bitop	eor,VT,\w16
	sve_op	add,SS1.s,SS1.s,VE.s
	sve_bitop	eor,VT,\w9
	sve_op	add,SS1.s,SS1.s,VT1.s
	rotate_left	VT1,VT,VT2,15,VT3,VT,VT4,23
	SVE_EOR3	VT,VT1,VT3
	rotate_left	SS1,SS1,VT2,7
	sve_bitop	eor,\w4,VT
	// SS2 = SS1 ^ rol32(a, 12)
	eor	SS2.d,TT2.d,SS1.d
	sve_bitop	eor,\w4,\w6
	// d <- TT2 = GG(index, e, f, g) + h + SS1 + W[index]
	FUNC_EOR3	TT2,VE,VF,VG
	add	VT1.s,\w\().s,VH.s
	sve_op	add,TT2.s,TT2.s,VT1.s
	// h <- TT1 = FF(index, a, b, c) + d + SS2 + WB[index]
	FUNC_EOR3	VH,VA,VB,VC
	eor	VT1.d,\w\().d,\w4\().d
	sve_op	add,VH.s,VH.s,VD.s
	// b = rol32(b, 9)
	// f = rol32(f, 19)
	rotate_left	VB,VB,VT3,9
	sve_op	add,VH.s,VH.s,VT1.s
	add	VD.s,TT2.s,SS1.s
	sve_op	add,VH.s,VH.s,SS2.s
	// d = P0(TT2)
	rotate_left	VT1,VD,VT2,9,VT3,VD,VT4,17,VF,VF,TT2,19
	SVE_EOR3	VD,VT1,VT3
.endm

.macro SM3_STEP_16_62 windex:req,w:req,w4:req,w16:req,w13:req,w9:req,w6:req,w3:req
	// SS1 = rol32(rol32(a, 12) + e + rol32(T, (j % 32)), 7)
	rotate_left	VT,\w3,VT1,15,\w4,\w13,VT2,7,SS1,VA,VT3,12
	ld1rw	{VT1.s},p0/z,[sm3const_adr,\windex * 4]
	mov	TT2.s,p0/m,SS1.s
	sve_bitop	eor,VT,\w16
	sve_op	add,SS1.s,SS1.s,VE.s
	sve_bitop	eor,VT,\w9
	sve_op	add,SS1.s,SS1.s,VT1.s
	rotate_left	VT1,VT,VT2,15,VT3,VT,VT4,23
	SVE_EOR3	\w4,VT,VT1
	rotate_left	SS1,SS1,VT2,7
	sve_bitop	eor,\w4,VT3
	// SS2 = SS1 ^ rol32(a, 12)
	eor	SS2.d,TT2.d,SS1.d
	sve_bitop	eor,\w4,\w6
	// d <- TT2 = GG(index, e, f, g) + h + SS1 + W[index]
	sve_op	add,SS1.s,SS1.s,\w\().s
	FUNC_BSL	TT2,VE,VF,VG,VT1
	sve_op	add,SS1.s,SS1.s,VH.s
	// h <- TT1 = FF(index, a, b, c) + d + SS2 + WB[index]
	FUNC_FF	\windex,VH,VA,VB,VC,VT1,VT2
	eor	VT1.d,\w\().d,\w4\().d
	sve_op	add,VH.s,VH.s,VD.s
	// b = rol32(b, 9)
	// f = rol32(f, 19)
	rotate_left	VB,VB,VT2,9,VF,VF,VT4,19
	sve_op	add,VH.s,VH.s,VT1.s
	add	VD.s,TT2.s,SS1.s
	sve_op	add,VH.s,VH.s,SS2.s
	// d = P0(TT2)
	rotate_left	VT1,VD,VT2,9,VT3,VD,VT4,17
	SVE_EOR3	VD,VT1,VT3
.endm

.macro SM3_STEP_63 windex:req,w:req,w4:req,w16:req,w13:req,w9:req,w6:req,w3:req
	// SS1 = rol32(rol32(a, 12) + e + rol32(T, (j % 32)), 7)
	rotate_left	VT,\w3,VT1,15,\w4,\w13,VT2,7,SS1,VA,VT3,12
	ld1rw	{VT1.s},p0/z,[sm3const_adr,\windex * 4]
	mov	TT2.s,p0/m,SS1.s
	sve_bitop	eor,VT,\w16
	sve_op	add,SS1.s,SS1.s,VE.s
	sve_bitop	eor,VT,\w9
	sve_op	add,SS1.s,SS1.s,VT1.s
	rotate_left	VT1,VT,VT2,15,VT3,VT,VT4,23
	SVE_EOR3	VT,VT1,VT3
	rotate_left	SS1,SS1,VT2,7
	sve_bitop	eor,\w4,VT
	// SS2 = SS1 ^ rol32(a, 12)
	eor	SS2.d,TT2.d,SS1.d
	sve_bitop	eor,\w4,\w6
	// d <- TT2 = GG(index, e, f, g) + h + SS1 + W[index]
	FUNC_BSL	TT2,VE,VF,VG,VT1
	add	VT1.s,\w\().s,VH.s
	.if \windex == 63
		ld1w    {WORD0.s},p0/z,[abcd_buf, 0, MUL VL]
		ld1w    {WORD1.s},p0/z,[abcd_buf, 1, MUL VL]
		ld1w    {WORD2.s},p0/z,[abcd_buf, 2, MUL VL]
		ld1w    {WORD3.s},p0/z,[abcd_buf, 3, MUL VL]
		ld1w    {WORD4.s},p0/z,[abcd_buf, 4, MUL VL]
		ld1w    {WORD5.s},p0/z,[abcd_buf, 5, MUL VL]
		ld1w    {WORD6.s},p0/z,[abcd_buf, 6, MUL VL]
		ld1w    {WORD7.s},p0/z,[abcd_buf, 7, MUL VL]
	.endif
	sve_op	add,TT2.s,TT2.s,VT1.s
	// h <- TT1 = FF(index, a, b, c) + d + SS2 + WB[index]
	FUNC_FF	\windex,VH,VA,VB,VC,VT1,VT2
	eor	VT1.d,\w\().d,\w4\().d
	sve_op	add,VH.s,VH.s,VD.s
	// b = rol32(b, 9)
	// f = rol32(f, 19)
	rotate_left	VB,VB,VT2,9,VF,VF,VT4,19
	sve_op	add,VH.s,VH.s,VT1.s
	add	VD.s,TT2.s,SS1.s
	sve_bitop	eor,VA,WORD1
	sve_bitop	eor,VB,WORD2
	sve_bitop	eor,VC,WORD3
	// d = P0(TT2)
	rotate_left	VT1,VD,VT2,9,VT3,VD,VT4,17
	sve_bitop	eor,VF,WORD6
	SVE_EOR3	VD,VT1,VT3
	sve_bitop	eor,VG,WORD7
	sve_bitop	eor,VD,WORD4
	sve_op	add,VH.s,VH.s,SS2.s
	sve_bitop	eor,VE,WORD5
	sve_bitop	eor,VH,WORD0
.endm

.macro SWAP_STATES
	.unreq TT
	TT .req VH
	.unreq VH
	VH .req VG
	.unreq VG
	VG .req VF
	.unreq VF
	VF .req VE
	.unreq VE
	VE .req VD
	.unreq VD
	VD .req VC
	.unreq VC
	VC .req VB
	.unreq VB
	VB .req VA
	.unreq VA
	VA .req TT
.endm

.altmacro
.macro SM3_STEP_WRAPPER windex:req,idx:req,idx4:req,idx16,idx13,idx9,idx6,idx3
	.if \windex <= 11
		revb	WORD\idx4\().s, p0/m, WORD\idx4\().s
		next=\idx4+1
		load_next_words %next
		SM3_STEP_00_11	\windex,WORD\idx\(),WORD\idx4\()
	.else
		.if \windex < 16
			SM3_STEP_12_15	\windex,WORD\idx\(),WORD\idx4\(),WORD\idx16\(),WORD\idx13\(),WORD\idx9\(),WORD\idx6\(),WORD\idx3\()
		.else
			.if \windex == 63
				SM3_STEP_63	\windex,WORD\idx\(),WORD\idx4\(),WORD\idx16\(),WORD\idx13\(),WORD\idx9\(),WORD\idx6\(),WORD\idx3\()
			.else
				SM3_STEP_16_62	\windex,WORD\idx\(),WORD\idx4\(),WORD\idx16\(),WORD\idx13\(),WORD\idx9\(),WORD\idx6\(),WORD\idx3\()
			.endif
		.endif
	.endif
.endm

.macro exec_step windex:req
	.if \windex <= 11
		idx4=\windex+4
		SM3_STEP_WRAPPER	\windex,\windex,%idx4
	.else
		idxp4=\windex + 4
		idx4=idxp4 % 17
		idx16=(idxp4 - 16) % 17
		idx13=(idxp4 - 13) % 17
		idx9=(idxp4 - 9) % 17
		idx6=(idxp4 - 6) % 17
		idx3=(idxp4 - 3) % 17
		idx=\windex % 17
		SM3_STEP_WRAPPER	\windex,%idx,%idx4,%idx16,%idx13,%idx9,%idx6,%idx3
	.endif
	SWAP_STATES
.endm

.macro sm3_exec
	current_step=0
	.rept	64
		exec_step	%current_step
		current_step=current_step+1
	.endr
.endm

.macro sm3_single	sve2:vararg
	.ifnb	\sve2
		have_sve2 = 1
	.else
		have_sve2=0
	.endif
	st1w    {VA.s},p0,[abcd_buf, 0, MUL VL]
	st1w    {VB.s},p0,[abcd_buf, 1, MUL VL]
	st1w    {VC.s},p0,[abcd_buf, 2, MUL VL]
	st1w    {VD.s},p0,[abcd_buf, 3, MUL VL]
	st1w    {VE.s},p0,[abcd_buf, 4, MUL VL]
	st1w    {VF.s},p0,[abcd_buf, 5, MUL VL]
	st1w    {VG.s},p0,[abcd_buf, 6, MUL VL]
	st1w    {VH.s},p0,[abcd_buf, 7, MUL VL]
	load_words 0
	load_words 1
	load_words 2
	load_words 3
	load_words 4
	revb	WORD0.s, p0/m, WORD0.s
	revb	WORD1.s, p0/m, WORD1.s
	revb	WORD2.s, p0/m, WORD2.s
	revb	WORD3.s, p0/m, WORD3.s
	.if     have_sve2 == 1
		mov	VZERO.s,p0/m,#0
	.endif
	sm3_exec
.endm

.macro sm3_sve_save_stack
	stp	d8,d9,[sp, -64]!
	stp	d10,d11,[sp, 16]
	stp	d12,d13,[sp, 32]
	stp	d14,d15,[sp, 48]
.endm

.macro sm3_sve_restore_stack
	ldp	d10,d11,[sp, 16]
	ldp	d12,d13,[sp, 32]
	ldp	d14,d15,[sp, 48]
	ldp	d8,d9,[sp],64
.endm

	.section .rodata.cst16,"aM",@progbits,16
	.align  16
SM3_CONSTS:
	.word 0x79CC4519
	.word 0xF3988A32
	.word 0xE7311465
	.word 0xCE6228CB
	.word 0x9CC45197
	.word 0x3988A32F
	.word 0x7311465E
	.word 0xE6228CBC
	.word 0xCC451979
	.word 0x988A32F3
	.word 0x311465E7
	.word 0x6228CBCE
	.word 0xC451979C
	.word 0x88A32F39
	.word 0x11465E73
	.word 0x228CBCE6
	.word 0x9D8A7A87
	.word 0x3B14F50F
	.word 0x7629EA1E
	.word 0xEC53D43C
	.word 0xD8A7A879
	.word 0xB14F50F3
	.word 0x629EA1E7
	.word 0xC53D43CE
	.word 0x8A7A879D
	.word 0x14F50F3B
	.word 0x29EA1E76
	.word 0x53D43CEC
	.word 0xA7A879D8
	.word 0x4F50F3B1
	.word 0x9EA1E762
	.word 0x3D43CEC5
	.word 0x7A879D8A
	.word 0xF50F3B14
	.word 0xEA1E7629
	.word 0xD43CEC53
	.word 0xA879D8A7
	.word 0x50F3B14F
	.word 0xA1E7629E
	.word 0x43CEC53D
	.word 0x879D8A7A
	.word 0x0F3B14F5
	.word 0x1E7629EA
	.word 0x3CEC53D4
	.word 0x79D8A7A8
	.word 0xF3B14F50
	.word 0xE7629EA1
	.word 0xCEC53D43
	.word 0x9D8A7A87
	.word 0x3B14F50F
	.word 0x7629EA1E
	.word 0xEC53D43C
	.word 0xD8A7A879
	.word 0xB14F50F3
	.word 0x629EA1E7
	.word 0xC53D43CE
	.word 0x8A7A879D
	.word 0x14F50F3B
	.word 0x29EA1E76
	.word 0x53D43CEC
	.word 0xA7A879D8
	.word 0x4F50F3B1
	.word 0x9EA1E762
	.word 0x3D43CEC5


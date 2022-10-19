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

	input_data	.req	x0
	num_blocks	.req	w1
	digest	.req	x2

	// x2 is reused intentionally between digest/tmp
	// due to running out of registers
	TMP	.req	x2
	TMPW	.req	w2
	sha1key_adr	.req	x3
	WK	.req	w3
	WF	.req	w4
	WA	.req w5
	WB	.req w6
	WC	.req w7
	WD	.req w8
	WE	.req w9
	WORD0	.req w10
	WORD1	.req w11
	WORD2	.req w12
	WORD3	.req w13
	WORD4	.req w14
	WORD5	.req w15
	WORD6	.req w16
	WORD7	.req w17
	WORD8	.req w18
	WORD9	.req w19
	WORD10	.req w20
	WORD11	.req w21
	WORD12	.req w22
	WORD13	.req w23
	WORD14	.req w24
	WORD15	.req w25
	AA	.req w26
	BB	.req w27
	CC	.req w28
	DD	.req w29
	EE	.req w30

	TT	.req w0

.macro save_stack
	stp	x16,x17,[sp, -128]!
	stp	x18,x19,[sp, 16]
	stp	x20,x21,[sp, 32]
	stp	x22,x23,[sp, 48]
	stp	x24,x25,[sp, 64]
	stp	x26,x27,[sp, 80]
	stp	x28,x29,[sp, 96]
	str	x30,[sp, 112]
	// have to reuse x2, which is digest address
	str	x2,[sp, 120]
.endm

.macro restore_stack
	ldp	x18,x19,[sp, 16]
	ldp	x20,x21,[sp, 32]
	ldp	x22,x23,[sp, 48]
	ldp	x24,x25,[sp, 64]
	ldp	x26,x27,[sp, 80]
	ldp	x28,x29,[sp, 96]
	ldr	x30,[sp, 112]
	ldr	x2,[sp, 120]
	ldp	x16,x17,[sp],128
.endm
// macro F = (D ^ (B & (C ^ D)))
.macro FUNC_F0
	eor	WF, WC, WD
	and	WF, WB, WF
	eor	WF, WD, WF
.endm

// F = (B ^ C ^ D)
.macro FUNC_F1
	eor	WF, WB, WC
	eor	WF, WF, WD
.endm

// F = ((B & C) | (B & D) | (C & D))
.macro FUNC_F2
	and	TMPW, WB, WC
	and	WF, WB, WD
	orr	WF, WF, TMPW
	and	TMPW, WC, WD
	orr	WF, WF, TMPW
.endm

// F = (B ^ C ^ D)
.macro FUNC_F3
	FUNC_F1
.endm

.altmacro
.macro load_next_word windex
	.if \windex < 16
		load_word_at	\windex
	.endif
.endm

.macro SHA1_STEP_00_15 windex:req
	rev	WORD\windex\(),WORD\windex\()
	next_word=\windex+1
	load_next_word	%next_word

	ror	TMPW,WA,#32-5
	add	WE,WE,TMPW
	add	WE,WE,WK
	FUNC_F0
	ror	WB,WB,#32-30
	add	WE,WE,WORD\windex\()
	add	WE,WE,WF
.endm

.macro SHA1_STEP_16_79 windex:req,func_f:req,reg_3:req,reg_8:req,reg_14:req,reg_16:req
	eor	TMPW,\reg_14,\reg_8
	eor	\reg_16,\reg_16,\reg_3
	eor	\reg_16,\reg_16,TMPW

	ror	TMPW,WA,#32-5
	ror	\reg_16,\reg_16, #32 - 1

	add	WE,WE,TMPW
	add	WE,WE,WK
	\func_f
	ror WB,WB,#32-30
	add	WE,WE,\reg_16
	add	WE,WE,WF
.endm

.macro SWAP_STATES
	.unreq TT
	TT .req WE
	.unreq WE
	WE .req WD
	.unreq WD
	WD .req WC
	.unreq WC
	WC .req WB
	.unreq WB
	WB .req WA
	.unreq WA
	WA .req TT
.endm

.altmacro
.macro SHA1_STEP_16_79_WRAPPER windex:req,func_f:req,idx3:req,idx8:req,idx14:req,idx16:req
	SHA1_STEP_16_79 \windex,\func_f,WORD\idx3\(),WORD\idx8\(),WORD\idx14\(),WORD\idx16\()
.endm

.macro exec_step windex:req
	.if \windex <= 15
		SHA1_STEP_00_15	windex
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
.endm

.macro exec_steps idx:req,more:vararg
	exec_step	\idx
	.ifnb \more
		exec_steps	\more
	.endif
.endm

.altmacro

.macro load_two_words_at idx0:req,idx1:req
	ldp	WORD\idx0\(),WORD\idx1\(),[input_data],8
.endm

.macro load_word_at idx:req
	.if \idx % 2 == 0
		idx1=\idx+1
		load_two_words_at	\idx,%idx1
	.endif
.endm

/*
 *  void sha1_aarch64_x1(uint32_t *input_data, int num_blocks, uint32_t digest[5])
 */
	.global sha1_aarch64_x1
	.type sha1_aarch64_x1, %function
sha1_aarch64_x1:
	cmp	num_blocks, #0
	beq	.return

	ldp	WA,WB,[digest]
	ldp	WC,WD,[digest,8]
	ldr	WE,[digest,16]
	save_stack

.block_loop:
	mov	AA, WA
	mov	BB, WB
	mov	CC, WC
	mov	DD, WD
	mov	EE, WE

	load_word_at	0

	adr	sha1key_adr, KEY_0
	ldr	WK, [sha1key_adr]
	exec_steps	0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19

	// 20 ~ 39
	adr	sha1key_adr, KEY_1
	ldr	WK, [sha1key_adr]
	exec_steps	20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39

	// 40 ~ 59
	adr	sha1key_adr, KEY_2
	ldr	WK, [sha1key_adr]
	exec_steps	40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59

	// 60 ~ 79
	adr	sha1key_adr, KEY_3
	ldr	WK, [sha1key_adr]
	exec_steps	60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79

	add	WA, AA, WA
	add	WB, BB, WB
	add	WC, CC, WC
	add	WD, DD, WD
	add	WE, EE, WE

	subs	num_blocks, num_blocks, 1
	bne	.block_loop

	restore_stack
	stp	WA,WB,[digest]
	stp	WC,WD,[digest,8]
	str	WE,[digest,16]

.return:
	ret

	.size sha1_aarch64_x1, .-sha1_aarch64_x1
	.section .rodata.cst16,"aM",@progbits,16
	.align  16
KEY_0:
	.word	0x5a827999
KEY_1:
	.word	0x6ed9eba1
KEY_2:
	.word	0x8f1bbcdc
KEY_3:
	.word	0xca62c1d6

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

.altmacro
.macro aes_key_expand_next next:req,prev:req,ctx:req
	.if \next == 9
		mov \ctx, 0x1b
	.endif
	dup	vdest.4s,vKey\prev\().s[3]
	ext	vtmp.16b,vzero.16b,vKey\prev\().16b,#12
	aese	vdest.16b,vzero.16b
	eor	vKey\next\().16b,vKey\prev\().16b,vtmp.16b
	ext	vtmp.16b,vzero.16b,vtmp.16b,#12
	eor	vKey\next\().16b,vKey\next\().16b,vtmp.16b
	ext	vtmp.16b,vzero.16b,vtmp.16b,#12
	mov	tmpw,vdest.s[0]
	eor	tmpw,\ctx,tmpw,ror 8
	dup	vdest.4s,tmpw
	eor	vKey\next\().16b,vKey\next\().16b,vtmp.16b
	mov	\ctx,ctx,lsl 1
	eor	vKey\next\().16b,vKey\next\().16b,vdest.16b
.endm

/* when loadin key = 0
 *     arg1 = input key
 *     arg2 = rcon ctx register (optional)
 * when loading key > 0
 *     arg1 = rcon ctx register  (optional)
 */
.macro aes_key_expand key:req,arg1,arg2
	.if \key == 0
		ld1	{vKey\key\().4s},[\arg1]
		movi vzero.4s, 0
		.ifb \arg2
			mov	rcon,#0x01
		.endif

		.ifnb \arg2
			mov	\arg2,#0x01
		.endif
	.endif

	.if \key > 0
		prev=\key-1
		.ifb \arg1
			aes_key_expand_next	\key,%prev,rcon
		.endif

		.ifnb \arg1
			aes_key_expand_next	\key,%prev,\arg1
		.endif
	.endif
.endm

.macro aes_round block:req,key:req,mode:req
	.if \key < 9
		.if mode == 0
			aese	\block\().16b,vKey\key\().16b
			aesmc	\block\().16b,\block\().16b
		.else
			aesd	\block\().16b,vKey\key\().16b
			aesimc	\block\().16b,\block\().16b
		.endif
	.endif
	.if \key == 9
		.if mode == 0
			aese	\block\().16b,vKey\key\().16b
		.else
			aesd	\block\().16b,vKey\key\().16b
		.endif
	.endif
	.if \key == 10
		eor	\block\().16b,\block\().16b,vKey\key\().16b
	.endif
.endm

.macro aes_round_interleave b0:req,b1:req,b2:req,b3:req,key:req,mode:req,last_key
	.if \key < 9
		.if \mode == 0
			aese	\b0\().16b,vKey\key\().16b
			aesmc	\b0\().16b,\b0\().16b
			aese	\b1\().16b,vKey\key\().16b
			aesmc	\b1\().16b,\b1\().16b
			aese	\b2\().16b,vKey\key\().16b
			aesmc	\b2\().16b,\b2\().16b
			aese	\b3\().16b,vKey\key\().16b
			aesmc	\b3\().16b,\b3\().16b
		.else
			aesd	\b0\().16b,vKey\key\().16b
			aesimc	\b0\().16b,\b0\().16b
			aesd	\b1\().16b,vKey\key\().16b
			aesimc	\b1\().16b,\b1\().16b
			aesd	\b2\().16b,vKey\key\().16b
			aesimc	\b2\().16b,\b2\().16b
			aesd	\b3\().16b,vKey\key\().16b
			aesimc	\b3\().16b,\b3\().16b
		.endif
	.endif

	.if \key == 9
		.if \mode == 0
			aese	\b0\().16b,vKey\key\().16b
			eor	\b0\().16b,\b0\().16b,vKey\last_key\().16b
			aese	\b1\().16b,vKey\key\().16b
			eor	\b1\().16b,\b1\().16b,vKey\last_key\().16b
			aese	\b2\().16b,vKey\key\().16b
			eor	\b2\().16b,\b2\().16b,vKey\last_key\().16b
			aese	\b3\().16b,vKey\key\().16b
			eor	\b3\().16b,\b3\().16b,vKey\last_key\().16b
		.else
			aesd	\b0\().16b,vKey\key\().16b
			eor	\b0\().16b,\b0\().16b,vKey\last_key\().16b
			aesd	\b1\().16b,vKey\key\().16b
			eor	\b1\().16b,\b1\().16b,vKey\last_key\().16b
			aesd	\b2\().16b,vKey\key\().16b
			eor	\b2\().16b,\b2\().16b,vKey\last_key\().16b
			aesd	\b3\().16b,vKey\key\().16b
			eor	\b3\().16b,\b3\().16b,vKey\last_key\().16b
		.endif
	.endif
.endm

.macro aes_rounds_interleave b0:req,b1:req,b2:req,b3:req,mode
	aes_round_interleave \b0,\b1,\b2,\b3,0,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,1,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,2,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,3,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,4,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,5,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,6,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,7,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,8,\mode
	aes_round_interleave \b0,\b1,\b2,\b3,9,\mode,10
.endm

.macro aes_rounds blk:req,mode:req
	aes_round	\blk,0,\mode
	aes_round	\blk,1,\mode
	aes_round	\blk,2,\mode
	aes_round	\blk,3,\mode
	aes_round	\blk,4,\mode
	aes_round	\blk,5,\mode
	aes_round	\blk,6,\mode
	aes_round	\blk,7,\mode
	aes_round	\blk,8,\mode
	aes_round	\blk,9,\mode
	aes_round	\blk,10,\mode
.endm

/* load k1/k2 from memory and encrypt the tweak by k2
 * boths keys will share the same set of registers
 * but will never overlap (k2 is used only once and discarded)
 */
.macro keyload_and_encrypt_tweak iv:req,k2:req,k1:req
	ldp	qKey0,qKey1,[\k2],#32
	aes_enc_round	\iv,0
	ldp	qKey2,qKey3,[\k2],#32
	aes_enc_round	\iv,1
	ldp	qKey0,qKey1,[\k1],#32
	aes_enc_round	\iv,2
	ldp	qKey4,qKey5,[\k2],#32
	aes_enc_round	\iv,3
	ldp	qKey2,qKey3,[\k1],#32
	aes_enc_round	\iv,4
	ldp	qKey6,qKey7,[\k2],#32
	aes_enc_round	\iv,5
	ldp	qKey4,qKey5,[\k1],#32
	aes_enc_round	\iv,6
	ldp	qKey8,qKey9,[k2],#32
	aes_enc_round	\iv,7
	ldp	qKey6,qKey7,[\k1],#32
	aes_enc_round	\iv,8
	ld1	{vKey10.16b},[\k2],#16
	aes_enc_round	\iv,9
	ldp	qKey8,qKey9,[\k1],#32
	aes_enc_round	\iv,10
	ld1	{vKey10.16b},[\k1],#16
.endm

.macro save_stack
	stp	d8,d9,[sp, -32]!
	add	tmpbuf,sp,16
.endm

.macro restore_stack
	ldp	d8,d9,[sp],32
.endm


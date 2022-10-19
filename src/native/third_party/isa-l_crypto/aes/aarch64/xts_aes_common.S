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

.macro  declare_var_vector_reg name:req,reg:req
.ifdef q\name
	.unreq	q\name
	.unreq	v\name
	.unreq	s\name
	.unreq	d\name
.endif
	.set q\name , \reg
	q\name	.req	q\reg
	v\name	.req	v\reg
	s\name	.req	s\reg
	d\name	.req	d\reg
.endm

.macro  declare_var_generic_reg name:req,reg:req
	\name	.req	x\reg
	x\name	.req	x\reg
	w\name	.req	w\reg
.endm

	declare_var_vector_reg	zero ,0
	declare_var_vector_reg	tmp,1
	declare_var_vector_reg	mask,2
	declare_var_vector_reg	dest,3
	declare_var_vector_reg	blk0,4
	declare_var_vector_reg	blk1,5
	declare_var_vector_reg	blk2,6
	declare_var_vector_reg	blk3,7
	declare_var_vector_reg	Key11,8
	declare_var_vector_reg	Key12,9
	declare_var_vector_reg	Key13,10
	declare_var_vector_reg	Key14,11
	declare_var_vector_reg	SavedIv,16
	declare_var_vector_reg	IV0,17
	declare_var_vector_reg	IV1,18
	declare_var_vector_reg	IV2,19
	declare_var_vector_reg	IV3,20
	declare_var_vector_reg	Key0,21
	declare_var_vector_reg	Key1,22
	declare_var_vector_reg	Key2,23
	declare_var_vector_reg	Key3,24
	declare_var_vector_reg	Key4,25
	declare_var_vector_reg	Key5,26
	declare_var_vector_reg	Key6,27
	declare_var_vector_reg	Key7,28
	declare_var_vector_reg	Key8,29
	declare_var_vector_reg	Key9,30
	declare_var_vector_reg	Key10,31

.macro aes_enc_round block:req,key:req
	aes_round	\block,\key,0
.endm

.macro aes_dec_round block:req,key:req
	aes_round	\block,\key,1
.endm

.macro update_iv current:req,next:req
	mov	ivh,\current\().d[1]
	mov	ivl,\current\().d[0]
	mov	tmpw,#0x87
	extr	tmpx2,ivh,ivh,#32
	extr	ivh,ivh,ivl,#63
	and	tmpw,tmpw,tmpw2,asr#31
	eor	ivl,tmpx,ivl,lsl#1
	mov	\next\().d[1],ivh
	mov	\next\().d[0],ivl
.endm

.macro process_4_blks inp:req,outp:req,mode:req,is_tail
	update_iv	vIV0,vIV1
	update_iv	vIV1,vIV2
	ldp	qblk0,qblk1,[\inp],#32
	ldp	qblk2,qblk3,[\inp],#32
	.ifnb	\is_tail
		update_iv	vIV2, vSavedIv
		update_iv	vSavedIv,vIV3
	.else
		update_iv	vIV2,vIV3
	.endif
	eor	vblk0.16b,vblk0.16b,vIV0.16b
	eor	vblk1.16b,vblk1.16b,vIV1.16b
	eor	vblk2.16b,vblk2.16b,vIV2.16b
	eor	vblk3.16b,vblk3.16b,vIV3.16b

	aes_rounds_interleave vblk0,vblk1,vblk2,vblk3,\mode
	eor	vblk0.16b,vblk0.16b,vIV0.16b
	eor	vblk1.16b,vblk1.16b,vIV1.16b
	stp	qblk0,qblk1,[\outp],#32
	eor	vblk2.16b,vblk2.16b,vIV2.16b
	eor	vblk3.16b,vblk3.16b,vIV3.16b
	stp	qblk2,qblk3,[\outp],#32
	.ifb \is_tail
		update_iv	vIV3,vIV0
	.endif
.endm

.macro process_1_blk inp:req,outp:req,mode:req
	ld1	{vblk0.16b},[\inp],#16
	eor	vblk0.16b,vblk0.16b,vIV0.16b
	aes_rounds	vblk0,\mode
	eor	vblk0.16b,vblk0.16b,vIV0.16b
	str	qblk0,[\outp], #16
.endm

	key2	.req	x0
	key1	.req	x1
	iv	.req	x2
	bytes	.req	x3
	inp	.req	x4
	outp	.req	x5
	rcon	.req	w6
	blocks	.req	x7
	tmpx	.req	x8
	tmpw	.req	w8
	tmpw2	.req	w9
	tmpx2	.req	x9
	ivl	.req	x10
	ivh	.req	x11
	lastblk	.req	x12
	tmpbuf	.req	x13
	tailcnt	.req	x14
	rcon2	.req	w15

.macro xts_aes_crypt mode:req,expander,more:vararg
	save_stack

	ld1	{vIV0.16b},[iv],16
	.ifnb \expander
		\expander\()	\more
	.endif
	lsr	blocks,bytes,4
	and	tailcnt,bytes,#0x0F

	cmp	bytes,16
	b.lt	.return

.process_4_blks:
	cmp	blocks, 4
	b.lt	.singles
	subs	blocks,blocks,4
	/* in decryption mode, check whether this is
	 * last block before the less-than-one-block tail
	 * need to swap tweak in this case
	 */
	.if \mode == 1
		b.gt	.not_tail_4blk
		cmp	tailcnt,1
		b.lt	.not_tail_4blk
		process_4_blks	inp,outp,\mode,1
		b	.process_4_blks
.not_tail_4blk:
	.endif
	process_4_blks	inp,outp,\mode
	b	.process_4_blks

.singles:
	subs	blocks,blocks,#1
	b.lt	.checktail
	/* in decryption mode, check whether this is
	 *last block before the less-than-one-block tail
	 * need to swap tweak in this case
	 */
	.if \mode == 1
		b.gt	.not_tail_1blk
		cmp	tailcnt,1
		b.lt	.not_tail_1blk
		mov	vSavedIv.16b, vIV0.16b
		update_iv	vSavedIv, vIV0
		process_1_blk	inp,outp,\mode
		b	.checktail
.not_tail_1blk:
	.endif
	process_1_blk	inp,outp,\mode
	update_iv	vIV0,vIV0
	b .singles
.checktail:
	cmp	tailcnt,1
	b.lt	.return
	sub	lastblk,outp,#16
.copytail:
	subs	tailcnt,tailcnt,#1
	ldrb	tmpw,[lastblk,tailcnt]
	strb	tmpw,[outp,tailcnt]
	ldrb	tmpw,[inp,tailcnt]
	strb	tmpw,[tmpbuf,tailcnt]
	b.gt	.copytail
	and	tailcnt,bytes,#0x0F
.steal:
	cmp	tailcnt,15
	ldrb	tmpw,[lastblk,tailcnt]
	strb	tmpw,[tmpbuf,tailcnt]
	add	tailcnt,tailcnt,#1
	b.lt	.steal
	.if \mode == 1
		mov	vIV0.16b,vSavedIv.16b
	.endif
	process_1_blk	tmpbuf,lastblk,\mode
.return:
	restore_stack
	ret
.endm


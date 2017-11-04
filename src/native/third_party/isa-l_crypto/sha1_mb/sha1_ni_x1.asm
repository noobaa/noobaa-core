;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;  Copyright(c) 2011-2017 Intel Corporation All rights reserved.
;
;  Redistribution and use in source and binary forms, with or without
;  modification, are permitted provided that the following conditions
;  are met:
;    * Redistributions of source code must retain the above copyright
;      notice, this list of conditions and the following disclaimer.
;    * Redistributions in binary form must reproduce the above copyright
;      notice, this list of conditions and the following disclaimer in
;      the documentation and/or other materials provided with the
;      distribution.
;    * Neither the name of Intel Corporation nor the names of its
;      contributors may be used to endorse or promote products derived
;      from this software without specific prior written permission.
;
;  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
;  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
;  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
;  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
;  OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
;  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
;  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
;  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
;  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
;  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
;  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%include "sha1_mb_mgr_datastruct.asm"
%include "reg_sizes.asm"

%ifdef HAVE_AS_KNOWS_SHANI
default rel

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%ifidn __OUTPUT_FORMAT__, elf64
 ; Linux
 %define arg0  rdi
 %define arg1  rsi
%else
 ; Windows
 %define arg0   rcx
 %define arg1   rdx
%endif

;; FRAMESZ plus pushes must be an odd multiple of 8
%define FRAMESZ	32	; space for ABCDE
%define RSPSAVE	rax

%define ABCD		xmm0
; two E's b/c for ping-pong
%define E0		xmm1
%define E1		xmm2
%define MSG0		xmm3
%define MSG1		xmm4
%define MSG2		xmm5
%define MSG3		xmm6
%define SHUF_MASK	xmm7

; arg index is start from 0 while mgr_flush/submit is from 1
%define MGR	arg0
%define NBLK	arg1
%define NLANX4	r10	; consistent with caller
%define IDX	r8	; local variable -- consistent with caller
%define DPTR	r11	; local variable -- input buffer pointer
%define TMP	r9	; local variable -- assistant to address digest
;%define TMP2	r8	; local variable -- assistant to address digest
align 32

; void sha1_ni_x1(SHA1_MB_ARGS_Xn *args, uint32_t size_in_blocks);
; arg 0 : MGR : pointer to args (only 4 of the 16 lanes used)
; arg 1 : NBLK : size (in blocks) ;; assumed to be >= 1
; invisibile arg 2 : IDX : hash on which lane
; invisibile arg 3 : NLANX4 : max lanes*4 for this arch (digest is placed by it)
; 		 (sse/avx is 4, avx2 is 8, avx512 is 16)
;
; Clobbers registers: rax, r9~r11, xmm0-xmm7
;
global sha1_ni_x1:function internal
sha1_ni_x1:
	mov	RSPSAVE, rsp
	sub     rsp, FRAMESZ
	and	rsp, ~0xF	; Align 16Bytes downward

	shl	NBLK, 6		; transform blk amount into bytes
	jz	backto_mgr

	; detach idx from nlanx4
	mov	IDX, NLANX4
	shr	NLANX4, 8
	and	IDX, 0xff

	lea	TMP, [MGR + 4*IDX]
	;; Initialize digest
	pinsrd	ABCD, [TMP + 0*NLANX4], 3
	pinsrd	ABCD, [TMP + 1*NLANX4], 2
	pinsrd	ABCD, [TMP + 2*NLANX4], 1
	lea	TMP, [TMP + 2*NLANX4]	; MGR + 4*IDX + 2*NLANX4
	pinsrd	ABCD, [TMP + 1*NLANX4], 0
	pinsrd	E0, [TMP + 2*NLANX4], 3
	pand	E0, [IDX3_WORD_MASK]

	movdqa	SHUF_MASK, [PSHUFFLE_SHANI_MASK]

	;; Load input pointers
	mov     DPTR, [MGR + _data_ptr + IDX*8]
	;; nblk is used to indicate data end
	add	NBLK, DPTR

lloop:
	; Save hash values for addition after rounds
	movdqa		[rsp + 0*16], E0
	movdqa		[rsp + 1*16], ABCD

	; do rounds 0-3
	movdqu		MSG0, [DPTR + 0*16]
	pshufb		MSG0, SHUF_MASK
		paddd		E0, MSG0
		movdqa		E1, ABCD
		sha1rnds4	ABCD, E0, 0

	; do rounds 4-7
	movdqu		MSG1, [DPTR + 1*16]
	pshufb		MSG1, SHUF_MASK
		sha1nexte	E1, MSG1
		movdqa		E0, ABCD
		sha1rnds4	ABCD, E1, 0
	sha1msg1	MSG0, MSG1

	; do rounds 8-11
	movdqu		MSG2, [DPTR + 2*16]
	pshufb		MSG2, SHUF_MASK
		sha1nexte	E0, MSG2
		movdqa		E1, ABCD
		sha1rnds4	ABCD, E0, 0
	sha1msg1	MSG1, MSG2
	pxor		MSG0, MSG2

	; do rounds 12-15
	movdqu		MSG3, [DPTR + 3*16]
	pshufb		MSG3, SHUF_MASK
		sha1nexte	E1, MSG3
		movdqa		E0, ABCD
	sha1msg2	MSG0, MSG3
		sha1rnds4	ABCD, E1, 0
	sha1msg1	MSG2, MSG3
	pxor		MSG1, MSG3

	; do rounds 16-19
		sha1nexte	E0, MSG0
		movdqa		E1, ABCD
	sha1msg2	MSG1, MSG0
		sha1rnds4	ABCD, E0, 0
	sha1msg1	MSG3, MSG0
	pxor		MSG2, MSG0

	; do rounds 20-23
		sha1nexte	E1, MSG1
		movdqa		E0, ABCD
	sha1msg2	MSG2, MSG1
		sha1rnds4	ABCD, E1, 1
	sha1msg1	MSG0, MSG1
	pxor		MSG3, MSG1

	; do rounds 24-27
		sha1nexte	E0, MSG2
		movdqa		E1, ABCD
	sha1msg2	MSG3, MSG2
		sha1rnds4	ABCD, E0, 1
	sha1msg1	MSG1, MSG2
	pxor		MSG0, MSG2

	; do rounds 28-31
		sha1nexte	E1, MSG3
		movdqa		E0, ABCD
	sha1msg2	MSG0, MSG3
		sha1rnds4	ABCD, E1, 1
	sha1msg1	MSG2, MSG3
	pxor		MSG1, MSG3

	; do rounds 32-35
		sha1nexte	E0, MSG0
		movdqa		E1, ABCD
	sha1msg2	MSG1, MSG0
		sha1rnds4	ABCD, E0, 1
	sha1msg1	MSG3, MSG0
	pxor		MSG2, MSG0

	; do rounds 36-39
		sha1nexte	E1, MSG1
		movdqa		E0, ABCD
	sha1msg2	MSG2, MSG1
		sha1rnds4	ABCD, E1, 1
	sha1msg1	MSG0, MSG1
	pxor		MSG3, MSG1

	; do rounds 40-43
		sha1nexte	E0, MSG2
		movdqa		E1, ABCD
	sha1msg2	MSG3, MSG2
		sha1rnds4	ABCD, E0, 2
	sha1msg1	MSG1, MSG2
	pxor		MSG0, MSG2

	; do rounds 44-47
		sha1nexte	E1, MSG3
		movdqa		E0, ABCD
	sha1msg2	MSG0, MSG3
		sha1rnds4	ABCD, E1, 2
	sha1msg1	MSG2, MSG3
	pxor		MSG1, MSG3

	; do rounds 48-51
		sha1nexte	E0, MSG0
		movdqa		E1, ABCD
	sha1msg2	MSG1, MSG0
		sha1rnds4	ABCD, E0, 2
	sha1msg1	MSG3, MSG0
	pxor		MSG2, MSG0

	; do rounds 52-55
		sha1nexte	E1, MSG1
		movdqa		E0, ABCD
	sha1msg2	MSG2, MSG1
		sha1rnds4	ABCD, E1, 2
	sha1msg1	MSG0, MSG1
	pxor		MSG3, MSG1

	; do rounds 56-59
		sha1nexte	E0, MSG2
		movdqa		E1, ABCD
	sha1msg2	MSG3, MSG2
		sha1rnds4	ABCD, E0, 2
	sha1msg1	MSG1, MSG2
	pxor		MSG0, MSG2

	; do rounds 60-63
		sha1nexte	E1, MSG3
		movdqa		E0, ABCD
	sha1msg2	MSG0, MSG3
		sha1rnds4	ABCD, E1, 3
	sha1msg1	MSG2, MSG3
	pxor		MSG1, MSG3

	; do rounds 64-67
		sha1nexte	E0, MSG0
		movdqa		E1, ABCD
	sha1msg2	MSG1, MSG0
		sha1rnds4	ABCD, E0, 3
	sha1msg1	MSG3, MSG0
	pxor		MSG2, MSG0

	; do rounds 68-71
		sha1nexte	E1, MSG1
		movdqa		E0, ABCD
	sha1msg2	MSG2, MSG1
		sha1rnds4	ABCD, E1, 3
	pxor		MSG3, MSG1

	; do rounds 72-75
		sha1nexte	E0, MSG2
		movdqa		E1, ABCD
	sha1msg2	MSG3, MSG2
		sha1rnds4	ABCD, E0, 3

	; do rounds 76-79
		sha1nexte	E1, MSG3
		movdqa		E0, ABCD
		sha1rnds4	ABCD, E1, 3

	; Add current hash values with previously saved
	sha1nexte	E0, [rsp + 0*16]
	paddd		ABCD, [rsp + 1*16]

	; Increment data pointer and loop if more to process
	add		DPTR, 64
	cmp		DPTR, NBLK
	jne		lloop

	; write out digests
	lea	TMP, [MGR + 4*IDX]
	pextrd	[TMP + 0*NLANX4], ABCD, 3
	pextrd	[TMP + 1*NLANX4], ABCD, 2
	pextrd	[TMP + 2*NLANX4], ABCD, 1
	lea	TMP, [TMP + 2*NLANX4]	; MGR + 4*IDX + 2*NLANX4
	pextrd	[TMP + 1*NLANX4], ABCD, 0
	pextrd	[TMP + 2*NLANX4], E0, 3

	; update input pointers
	mov     [MGR + _data_ptr + IDX*8], DPTR

backto_mgr:
	;;;;;;;;;;;;;;;;
	;; Postamble

	mov     rsp, RSPSAVE

	ret


section .data align=16
PSHUFFLE_SHANI_MASK:	dq 0x08090a0b0c0d0e0f, 0x0001020304050607
IDX3_WORD_MASK:		dq 0x0000000000000000, 0xFFFFFFFF00000000

%else
%ifidn __OUTPUT_FORMAT__, win64
global no_sha1_ni_x1
no_sha1_ni_x1:
%endif
%endif ; HAVE_AS_KNOWS_SHANI

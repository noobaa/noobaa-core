;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;  Copyright(c) 2011-2020 Intel Corporation All rights reserved.
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

%include "sm3_mb_mgr_datastruct.asm"
%include "reg_sizes.asm"

[bits 64]
default rel
section .text

;; code to compute oct SM3 using SSE-256 / AVX2
;; outer calling routine takes care of save and restore of XMM registers
;; Logic designed/laid out by JDG

;; Function clobbers: rax, rcx, rdx, rsi, rdi, r9-r15; eax;ymm0-15
;; Windows clobbers:  rax rdx rsi rdi        r9 r10 r11 r12 r13 r14 r15
;; Windows preserves:         rcx             rbp r8
;;
;; Linux clobbers:    rax rcx rdx rsi            r9 r10 r11 r12 r13 r14 r15
;; Linux preserves:           rdi rbp r8
;;
;; clobbers ymm0-15

%ifidn __OUTPUT_FORMAT__, elf64
 ; Linux definitions
     %define arg1 	rdi
     %define arg2	rsi
     %define reg3	rcx
     %define reg4	rdx
%else
 ; Windows definitions
     %define arg1 	rcx
     %define arg2 	rdx
     %define reg3	rsi
     %define reg4	rdi
%endif

; Common definitions
%define STATE    arg1
%define INP_SIZE arg2
%define SIZE	 INP_SIZE ; rsi

%define IDX     rax
%define TBL	reg3

%define inp0 r9
%define inp1 r10
%define inp2 r11
%define inp3 r12
%define inp4 r13
%define inp5 r14
%define inp6 r15
%define inp7 reg4

%define APPEND(a,b) a %+ b

%define WB0 ymm0
%define WB1 ymm1
%define WB2 ymm2
%define WB3 ymm3
%define WB4 ymm4
%define WB5 ymm5
%define WB6 ymm6
%define WB7 ymm7
%define WB8 ymm8
%define WB9 ymm9
%define WB10 ymm10
%define WB11 ymm11
%define WB12 ymm12
%define WB13 ymm13
%define WB14 ymm14
%define WB15 ymm15

%define WBTMP0 ymm8
%define WBTMP1 ymm9

%define WBTMP2 ymm0
%define WBTMP3 ymm1

%define A	ymm0
%define B	ymm1
%define C	ymm2
%define D	ymm3
%define E	ymm4
%define F	ymm5
%define G	ymm6
%define H	ymm7

%define TMP0	ymm8
%define TMP1	ymm9
%define TMP2	ymm10

; W(j) = WB(j) + WB(j+4)
; Keep WB(j) - W(j+4) to reduce momory read
%define Wj0	ymm11
%define Wj1	ymm12
%define Wj2	ymm13
%define Wj3	ymm14
%define Wj4	ymm15


%define SZ8	8*SM3_DIGEST_WORD_SIZE	; Size of one vector register
%define PTR_SZ                  8
%define SM3_DIGEST_WORD_SIZE	4
%define MAX_SM3_LANES		8
%define NUM_SM3_DIGEST_WORDS	8
%define SM3_DIGEST_ROW_SIZE	(MAX_SM3_LANES * SM3_DIGEST_WORD_SIZE)

; Define stack usage

;; Assume stack aligned to 32 bytes before call
;; Therefore FRAMESZ mod 32 must be 32-8 = 24
struc stack_frame
  .data		resb	16*SZ8
  .digest	resb	8*SZ8
  .wbtmp	resb	69*SZ8
  .rsp		resb	8
endstruc
%define FRAMESZ	stack_frame_size
%define _DIGEST	stack_frame.digest
%define _WBTMP	stack_frame.wbtmp
%define _RSP_SAVE	stack_frame.rsp

%define YTMP0	rsp + _WBTMP + 0*SZ8
%define YTMP1	rsp + _WBTMP + 1*SZ8
%define YTMP2	rsp + _WBTMP + 2*SZ8
%define YTMP3	rsp + _WBTMP + 3*SZ8
%define YTMP4	rsp + _WBTMP + 4*SZ8

%define YTMPI	rsp + _WBTMP + I*SZ8
%define YTMPI_1 rsp + _WBTMP + (I - 1)*SZ8
%define YTMPI_2 rsp + _WBTMP + (I - 2)*SZ8
%define YTMPI_4 rsp + _WBTMP + (I - 4)*SZ8
%define YTMPI5 	rsp + _WBTMP + (I + 5)*SZ8


%define VMOVPS	vmovups

;;;;;;;;
; same as sha256
;;;;;;;;
%macro TRANSPOSE8 10
%define %%r0 %1
%define %%r1 %2
%define %%r2 %3
%define %%r3 %4
%define %%r4 %5
%define %%r5 %6
%define %%r6 %7
%define %%r7 %8
%define %%t0 %9
%define %%t1 %10
	; process top half (r0..r3) {a...d}
	vshufps	%%t0, %%r0, %%r1, 0x44	; t0 = {b5 b4 a5 a4   b1 b0 a1 a0}
	vshufps	%%r0, %%r0, %%r1, 0xEE	; r0 = {b7 b6 a7 a6   b3 b2 a3 a2}
	vshufps %%t1, %%r2, %%r3, 0x44	; t1 = {d5 d4 c5 c4   d1 d0 c1 c0}
	vshufps	%%r2, %%r2, %%r3, 0xEE	; r2 = {d7 d6 c7 c6   d3 d2 c3 c2}
	vshufps	%%r3, %%t0, %%t1, 0xDD	; r3 = {d5 c5 b5 a5   d1 c1 b1 a1}
	vshufps	%%r1, %%r0, %%r2, 0x88	; r1 = {d6 c6 b6 a6   d2 c2 b2 a2}
	vshufps	%%r0, %%r0, %%r2, 0xDD	; r0 = {d7 c7 b7 a7   d3 c3 b3 a3}
	vshufps	%%t0, %%t0, %%t1, 0x88	; t0 = {d4 c4 b4 a4   d0 c0 b0 a0}

	; use r2 in place of t0
	; process bottom half (r4..r7) {e...h}
	vshufps	%%r2, %%r4, %%r5, 0x44	; r2 = {f5 f4 e5 e4   f1 f0 e1 e0}
	vshufps	%%r4, %%r4, %%r5, 0xEE	; r4 = {f7 f6 e7 e6   f3 f2 e3 e2}
	vshufps %%t1, %%r6, %%r7, 0x44	; t1 = {h5 h4 g5 g4   h1 h0 g1 g0}
	vshufps	%%r6, %%r6, %%r7, 0xEE	; r6 = {h7 h6 g7 g6   h3 h2 g3 g2}
	vshufps	%%r7, %%r2, %%t1, 0xDD	; r7 = {h5 g5 f5 e5   h1 g1 f1 e1}
	vshufps	%%r5, %%r4, %%r6, 0x88	; r5 = {h6 g6 f6 e6   h2 g2 f2 e2}
	vshufps	%%r4, %%r4, %%r6, 0xDD	; r4 = {h7 g7 f7 e7   h3 g3 f3 e3}
	vshufps	%%t1, %%r2, %%t1, 0x88	; t1 = {h4 g4 f4 e4   h0 g0 f0 e0}

	vperm2f128	%%r6, %%r5, %%r1, 0x13	; h6...a6
	vperm2f128	%%r2, %%r5, %%r1, 0x02	; h2...a2
	vperm2f128	%%r5, %%r7, %%r3, 0x13	; h5...a5
	vperm2f128	%%r1, %%r7, %%r3, 0x02	; h1...a1
	vperm2f128	%%r7, %%r4, %%r0, 0x13	; h7...a7
	vperm2f128	%%r3, %%r4, %%r0, 0x02	; h3...a3
	vperm2f128	%%r4, %%t1, %%t0, 0x13	; h4...a4
	vperm2f128	%%r0, %%t1, %%t0, 0x02	; h0...a0
%endmacro

%macro ROTATE_W 0

	%xdefine TMP_ Wj0
	%xdefine Wj0 Wj1
	%xdefine Wj1 Wj2
	%xdefine Wj2 Wj3
	%xdefine Wj3 Wj4

	%xdefine Wj4 TMP_

%endmacro

; ROTATE A,B,C,D
%macro ROTATE_ARGS_AD 0

	%xdefine TMP_ D
	%xdefine D C
	%xdefine C B
	%xdefine B A
	%xdefine A TMP2
	%xdefine TMP2 TMP_

%endmacro

%macro ROTATE_ARGS_EH 0

	%xdefine TMP_ H
	%xdefine H G
	%xdefine G F
	%xdefine F E
	%xdefine E TMP0
	%xdefine TMP0 TMP_

%endmacro

%macro ROLD 3

%define %%reg %1
%define %%imm %2
%define %%tmp %3
	vpslld	%%tmp, %%reg, %%imm
	vpsrld	%%reg, %%reg, (32-(%%imm))
	vpor	%%reg, %%reg, %%tmp

%endmacro

%macro ROLD_nd 4
%define %%reg %1
%define %%imm %2
%define %%tmp %3
%define %%src %4
	vpslld	%%tmp, %%src, %%imm
	vpsrld	%%reg, %%src, (32-(%%imm))
	vpor	%%reg, %%reg, %%tmp
%endmacro

;; void sm3_x8_avx2(SM3_ARGS *args, uint64_t bytes);
;; arg 1 : STATE : pointer to input data
;; arg 2 : INP_SIZE  : size of input in blocks
mk_global sm3_mb_x8_avx2,function,internal
align 16
sm3_mb_x8_avx2:
	endbranch
	; general registers preserved in outer calling routine
	; outer calling routine saves all the YMM registers

	; save rsp, allocate 32-byte aligned for local variables
	mov	IDX, rsp
	sub	rsp, FRAMESZ
	and	rsp, ~31
	mov	[rsp + _RSP_SAVE], IDX

	lea	TBL,[TABLE]

	;; load the address of each of the 8 message lanes
	;; getting ready to transpose input onto stack
	mov	inp0,[STATE + _args_data_ptr + 0*PTR_SZ]
	mov	inp1,[STATE + _args_data_ptr + 1*PTR_SZ]
	mov	inp2,[STATE + _args_data_ptr + 2*PTR_SZ]
	mov	inp3,[STATE + _args_data_ptr + 3*PTR_SZ]
	mov	inp4,[STATE + _args_data_ptr + 4*PTR_SZ]
	mov	inp5,[STATE + _args_data_ptr + 5*PTR_SZ]
	mov	inp6,[STATE + _args_data_ptr + 6*PTR_SZ]
	mov	inp7,[STATE + _args_data_ptr + 7*PTR_SZ]

	xor	IDX, IDX

%assign cur_loop 0
lloop:

	;
	; Pre calculate the WB 0..68 an W 0..64
	; It will better than calculate WB/W in round method
	;
	; 	ps : SHA256(AVX2) calculate WB/W in round method
	;
	; Pre calculation memory io time:
	; 	read  : 68 + 3 * 52(read WB)
	;	write : 52(write WB17..68)
	; Round method calculation memory io time:
	;	read  : 48 * 6(read 6 number of WB each round)
	; 	write : 52 + 64(same as upper)
	;
	VMOVPS	WB0,[inp0+IDX]
	VMOVPS	WB1,[inp1+IDX]
	VMOVPS	WB2,[inp2+IDX]
	VMOVPS	WB3,[inp3+IDX]
	VMOVPS	WB4,[inp4+IDX]
	VMOVPS	WB5,[inp5+IDX]
	VMOVPS	WB6,[inp6+IDX]
	VMOVPS	WB7,[inp7+IDX]

	TRANSPOSE8 WB0, WB1, WB2, WB3, WB4, WB5, WB6, WB7, WBTMP0, WBTMP1
	vmovdqa WBTMP0, [SHUF_MASK]
	vpshufb WB0,WBTMP0
	vpshufb WB1,WBTMP0
	vpshufb WB2,WBTMP0
	vpshufb WB3,WBTMP0
	vpshufb WB4,WBTMP0
	vpshufb WB5,WBTMP0
	vpshufb WB6,WBTMP0
	vpshufb WB7,WBTMP0

	vmovdqa	[YTMP0], WB0
	vmovdqa	[YTMP1], WB1

	VMOVPS	WB8,[inp0+IDX + 32]
	VMOVPS	WB9,[inp1+IDX + 32]
	VMOVPS	WB10,[inp2+IDX + 32]
	VMOVPS	WB11,[inp3+IDX + 32]
	VMOVPS	WB12,[inp4+IDX + 32]
	VMOVPS	WB13,[inp5+IDX + 32]
	VMOVPS	WB14,[inp6+IDX + 32]
	VMOVPS	WB15,[inp7+IDX + 32]

	TRANSPOSE8 WB8, WB9, WB10, WB11, WB12, WB13, WB14, WB15, WBTMP2, WBTMP3
	vmovdqa WBTMP2, [SHUF_MASK]
	vpshufb WB8,WBTMP2
	vpshufb WB9,WBTMP2
	vpshufb WB10,WBTMP2
	vpshufb WB11,WBTMP2
	vpshufb WB12,WBTMP2
	vpshufb WB13,WBTMP2
	vpshufb WB14,WBTMP2
	vpshufb WB15,WBTMP2

; WB0 WB1 already saved
%assign I 2
%rep 14
	vmovdqa	[YTMPI], APPEND(WB,I)
%assign I (I+1)
%endrep

	vmovdqa	WB0 , [YTMP0]
	vmovdqa	WB1 , [YTMP1]

; Calculate WB 16...67
%rep 52
	%assign J (I % 16)
	%assign J_1 ((I-1) % 16) ;tmp to use
	%assign J_2 ((I-2) % 16) ;tmp to use
	%assign J_3 ((I-3) % 16)
	%assign J_4 ((I-4) % 16) ;tmp to use
	%assign J_9 ((I-9) % 16)
	%assign J_13 ((I-13) % 16)
	%assign J_6 ((I-6) % 16)

	ROLD_nd APPEND(WB,J_2),15,APPEND(WB,J_1),APPEND(WB,J_3)
	vpxor  APPEND(WB,J),APPEND(WB,J_2)
	vpxor  APPEND(WB,J),APPEND(WB,J_9)

	ROLD_nd APPEND(WB,J_2),15,APPEND(WB,J_1),APPEND(WB,J)
	ROLD_nd APPEND(WB,J_1),23,APPEND(WB,J_4),APPEND(WB,J)
	vpxor  APPEND(WB,J),APPEND(WB,J_2)
	vpxor  APPEND(WB,J),APPEND(WB,J_1)

	ROLD_nd APPEND(WB,J_2),7,APPEND(WB,J_1),APPEND(WB,J_13)
	vpxor  APPEND(WB,J),APPEND(WB,J_2)
	vpxor  APPEND(WB,J),APPEND(WB,J_6)

	vmovdqa	[YTMPI], APPEND(WB,J)

	vmovdqa APPEND(WB,J_1), [YTMPI_1]
	vmovdqa APPEND(WB,J_2), [YTMPI_2]
	vmovdqa APPEND(WB,J_4), [YTMPI_4]

	%assign I (I+1)
%endrep

	add	IDX, 4*4*4

	; Every round need load A-H
	; Because we pre calculate the WB
	vmovdqu	A,[STATE + 0*SM3_DIGEST_ROW_SIZE]
	vmovdqu	B,[STATE + 1*SM3_DIGEST_ROW_SIZE]
	vmovdqu	C,[STATE + 2*SM3_DIGEST_ROW_SIZE]
	vmovdqu	D,[STATE + 3*SM3_DIGEST_ROW_SIZE]
	vmovdqu	E,[STATE + 4*SM3_DIGEST_ROW_SIZE]
	vmovdqu	F,[STATE + 5*SM3_DIGEST_ROW_SIZE]
	vmovdqu	G,[STATE + 6*SM3_DIGEST_ROW_SIZE]
	vmovdqu	H,[STATE + 7*SM3_DIGEST_ROW_SIZE]

	vmovdqa Wj0, [YTMP0]
	vmovdqa Wj1, [YTMP1]
	vmovdqa Wj2, [YTMP2]
	vmovdqa Wj3, [YTMP3]
	vmovdqa Wj4, [YTMP4]


%assign I 0
%rep 16

	; SS1 - TMP1
	ROLD_nd TMP0,12,TMP1,A
	vmovdqa TMP1, [TBL + (I*32)]
	vpaddd TMP1,E
	vpaddd TMP1,TMP0
	ROLD TMP1,7,TMP2

	; SS2 - TMP2
	vpxor TMP2,TMP1,TMP0

	; TT1
	vpxor TMP0,A,B
	vpxor TMP0,C
	vpaddd TMP2,TMP0
	vpaddd TMP2,D
	vpxor TMP0,Wj0,Wj4
	vpaddd TMP2,TMP0

	ROLD B,9,TMP0

	; Rotate a,b,c,d first
	; after P0(TT2) , Wj0 will be relase
	ROTATE_ARGS_AD

	; P0(TT2)
	vpxor TMP0,E,F
	vpxor TMP0,G
	vpaddd TMP0,H
	vpaddd TMP0,TMP1
	vpaddd TMP0,Wj0

	ROLD_nd TMP1,9,TMP2,TMP0
	ROLD_nd Wj0,17,TMP2,TMP0

	vpxor TMP0,TMP1
	vpxor TMP0,Wj0

	ROLD F,19,TMP2

	ROTATE_ARGS_EH

	ROTATE_W

	vmovdqa Wj4, [YTMPI5]
	%assign I (I+1)
%endrep

%rep 48
	; SS1 - TMP1
	ROLD_nd TMP0,12,TMP1,A
	vmovdqa TMP1, [TBL + (I*32)]
	vpaddd TMP1,E
	vpaddd TMP1,TMP0
	ROLD TMP1,7,TMP2

	; SS2 - TMP2
	vpxor TMP2,TMP1,TMP0

	; SS2 + D first
	; D will be release
	; FF16/GG16 diff with FF64/GG64
	; So the register which keep D should be release before calculate TT1
	vpaddd TMP2,D

	; TT1
	vpor TMP0,A,B
	vpand TMP0,C
	vpand D,A,B
	vpor TMP0,D

	vpaddd TMP2,TMP0
	vpxor TMP0,Wj0,Wj4
	vpaddd TMP2,TMP0

	ROLD B,9,TMP0

	ROTATE_ARGS_AD

	; P0(TT2)
	vpaddd TMP1,H
	vpaddd TMP1,Wj0

	vpand TMP0,E,F
	vpandn Wj0,E,G
	vpor TMP0,Wj0

	vpaddd TMP0,TMP1

	ROLD_nd TMP1,9,TMP2,TMP0
	ROLD_nd Wj0,17,TMP2,TMP0

	vpxor TMP0,TMP1
	vpxor TMP0,Wj0

	ROLD F,19,TMP2

	ROTATE_ARGS_EH

	ROTATE_W
	vmovdqa Wj4, [YTMPI5]
	%assign I (I+1)
%endrep

	vpxor	A, A, [STATE + 0*SM3_DIGEST_ROW_SIZE]
        vpxor	B, B, [STATE + 1*SM3_DIGEST_ROW_SIZE]
        vpxor	C, C, [STATE + 2*SM3_DIGEST_ROW_SIZE]
        vpxor	D, D, [STATE + 3*SM3_DIGEST_ROW_SIZE]
        vpxor	E, E, [STATE + 4*SM3_DIGEST_ROW_SIZE]
        vpxor	F, F, [STATE + 5*SM3_DIGEST_ROW_SIZE]
        vpxor	G, G, [STATE + 6*SM3_DIGEST_ROW_SIZE]
        vpxor	H, H, [STATE + 7*SM3_DIGEST_ROW_SIZE]

	; Write back to memory (state object) the transposed digest
	vmovdqu	[STATE + 0*SM3_DIGEST_ROW_SIZE],A
	vmovdqu	[STATE + 1*SM3_DIGEST_ROW_SIZE],B
	vmovdqu	[STATE + 2*SM3_DIGEST_ROW_SIZE],C
	vmovdqu	[STATE + 3*SM3_DIGEST_ROW_SIZE],D
	vmovdqu	[STATE + 4*SM3_DIGEST_ROW_SIZE],E
	vmovdqu	[STATE + 5*SM3_DIGEST_ROW_SIZE],F
	vmovdqu	[STATE + 6*SM3_DIGEST_ROW_SIZE],G
	vmovdqu	[STATE + 7*SM3_DIGEST_ROW_SIZE],H

	sub 	SIZE, 1
	je	last_loop
	jmp	lloop

last_loop:


	; update input pointers
	add	inp0, IDX
	mov	[STATE + _args_data_ptr + 0*8], inp0
	add	inp1, IDX
	mov	[STATE + _args_data_ptr + 1*8], inp1
	add	inp2, IDX
	mov	[STATE + _args_data_ptr + 2*8], inp2
	add	inp3, IDX
	mov	[STATE + _args_data_ptr + 3*8], inp3
	add	inp4, IDX
	mov	[STATE + _args_data_ptr + 4*8], inp4
	add	inp5, IDX
	mov	[STATE + _args_data_ptr + 5*8], inp5
	add	inp6, IDX
	mov	[STATE + _args_data_ptr + 6*8], inp6
	add	inp7, IDX
	mov	[STATE + _args_data_ptr + 7*8], inp7

	;;;;;;;;;;;;;;;;
	;; Postamble
	mov	rsp, [rsp + _RSP_SAVE]
	ret


PSHUFFLE_BYTE_FLIP_MASK: dq 0x0405060700010203, 0x0c0d0e0f08090a0b
			 dq 0x0405060700010203, 0x0c0d0e0f08090a0b

align 64
global TABLE
TABLE:
	dq 0x79cc451979cc4519,0x79cc451979cc4519
	dq 0x79cc451979cc4519,0x79cc451979cc4519
	dq 0xf3988a32f3988a32,0xf3988a32f3988a32
	dq 0xf3988a32f3988a32,0xf3988a32f3988a32
	dq 0xe7311465e7311465,0xe7311465e7311465
	dq 0xe7311465e7311465,0xe7311465e7311465
	dq 0xce6228cbce6228cb,0xce6228cbce6228cb
	dq 0xce6228cbce6228cb,0xce6228cbce6228cb
	dq 0x9cc451979cc45197,0x9cc451979cc45197
	dq 0x9cc451979cc45197,0x9cc451979cc45197
	dq 0x3988a32f3988a32f,0x3988a32f3988a32f
	dq 0x3988a32f3988a32f,0x3988a32f3988a32f
	dq 0x7311465e7311465e,0x7311465e7311465e
	dq 0x7311465e7311465e,0x7311465e7311465e
	dq 0xe6228cbce6228cbc,0xe6228cbce6228cbc
	dq 0xe6228cbce6228cbc,0xe6228cbce6228cbc
	dq 0xcc451979cc451979,0xcc451979cc451979
	dq 0xcc451979cc451979,0xcc451979cc451979
	dq 0x988a32f3988a32f3,0x988a32f3988a32f3
	dq 0x988a32f3988a32f3,0x988a32f3988a32f3
	dq 0x311465e7311465e7,0x311465e7311465e7
	dq 0x311465e7311465e7,0x311465e7311465e7
	dq 0x6228cbce6228cbce,0x6228cbce6228cbce
	dq 0x6228cbce6228cbce,0x6228cbce6228cbce
	dq 0xc451979cc451979c,0xc451979cc451979c
	dq 0xc451979cc451979c,0xc451979cc451979c
	dq 0x88a32f3988a32f39,0x88a32f3988a32f39
	dq 0x88a32f3988a32f39,0x88a32f3988a32f39
	dq 0x11465e7311465e73,0x11465e7311465e73
	dq 0x11465e7311465e73,0x11465e7311465e73
	dq 0x228cbce6228cbce6,0x228cbce6228cbce6
	dq 0x228cbce6228cbce6,0x228cbce6228cbce6
	dq 0x9d8a7a879d8a7a87,0x9d8a7a879d8a7a87
	dq 0x9d8a7a879d8a7a87,0x9d8a7a879d8a7a87
	dq 0x3b14f50f3b14f50f,0x3b14f50f3b14f50f
	dq 0x3b14f50f3b14f50f,0x3b14f50f3b14f50f
	dq 0x7629ea1e7629ea1e,0x7629ea1e7629ea1e
	dq 0x7629ea1e7629ea1e,0x7629ea1e7629ea1e
	dq 0xec53d43cec53d43c,0xec53d43cec53d43c
	dq 0xec53d43cec53d43c,0xec53d43cec53d43c
	dq 0xd8a7a879d8a7a879,0xd8a7a879d8a7a879
	dq 0xd8a7a879d8a7a879,0xd8a7a879d8a7a879
	dq 0xb14f50f3b14f50f3,0xb14f50f3b14f50f3
	dq 0xb14f50f3b14f50f3,0xb14f50f3b14f50f3
	dq 0x629ea1e7629ea1e7,0x629ea1e7629ea1e7
	dq 0x629ea1e7629ea1e7,0x629ea1e7629ea1e7
	dq 0xc53d43cec53d43ce,0xc53d43cec53d43ce
	dq 0xc53d43cec53d43ce,0xc53d43cec53d43ce
	dq 0x8a7a879d8a7a879d,0x8a7a879d8a7a879d
	dq 0x8a7a879d8a7a879d,0x8a7a879d8a7a879d
	dq 0x14f50f3b14f50f3b,0x14f50f3b14f50f3b
	dq 0x14f50f3b14f50f3b,0x14f50f3b14f50f3b
	dq 0x29ea1e7629ea1e76,0x29ea1e7629ea1e76
	dq 0x29ea1e7629ea1e76,0x29ea1e7629ea1e76
	dq 0x53d43cec53d43cec,0x53d43cec53d43cec
	dq 0x53d43cec53d43cec,0x53d43cec53d43cec
	dq 0xa7a879d8a7a879d8,0xa7a879d8a7a879d8
	dq 0xa7a879d8a7a879d8,0xa7a879d8a7a879d8
	dq 0x4f50f3b14f50f3b1,0x4f50f3b14f50f3b1
	dq 0x4f50f3b14f50f3b1,0x4f50f3b14f50f3b1
	dq 0x9ea1e7629ea1e762,0x9ea1e7629ea1e762
	dq 0x9ea1e7629ea1e762,0x9ea1e7629ea1e762
	dq 0x3d43cec53d43cec5,0x3d43cec53d43cec5
	dq 0x3d43cec53d43cec5,0x3d43cec53d43cec5
	dq 0x7a879d8a7a879d8a,0x7a879d8a7a879d8a
	dq 0x7a879d8a7a879d8a,0x7a879d8a7a879d8a
	dq 0xf50f3b14f50f3b14,0xf50f3b14f50f3b14
	dq 0xf50f3b14f50f3b14,0xf50f3b14f50f3b14
	dq 0xea1e7629ea1e7629,0xea1e7629ea1e7629
	dq 0xea1e7629ea1e7629,0xea1e7629ea1e7629
	dq 0xd43cec53d43cec53,0xd43cec53d43cec53
	dq 0xd43cec53d43cec53,0xd43cec53d43cec53
	dq 0xa879d8a7a879d8a7,0xa879d8a7a879d8a7
	dq 0xa879d8a7a879d8a7,0xa879d8a7a879d8a7
	dq 0x50f3b14f50f3b14f,0x50f3b14f50f3b14f
	dq 0x50f3b14f50f3b14f,0x50f3b14f50f3b14f
	dq 0xa1e7629ea1e7629e,0xa1e7629ea1e7629e
	dq 0xa1e7629ea1e7629e,0xa1e7629ea1e7629e
	dq 0x43cec53d43cec53d,0x43cec53d43cec53d
	dq 0x43cec53d43cec53d,0x43cec53d43cec53d
	dq 0x879d8a7a879d8a7a,0x879d8a7a879d8a7a
	dq 0x879d8a7a879d8a7a,0x879d8a7a879d8a7a
	dq 0x0f3b14f50f3b14f5,0x0f3b14f50f3b14f5
	dq 0x0f3b14f50f3b14f5,0x0f3b14f50f3b14f5
	dq 0x1e7629ea1e7629ea,0x1e7629ea1e7629ea
	dq 0x1e7629ea1e7629ea,0x1e7629ea1e7629ea
	dq 0x3cec53d43cec53d4,0x3cec53d43cec53d4
	dq 0x3cec53d43cec53d4,0x3cec53d43cec53d4
	dq 0x79d8a7a879d8a7a8,0x79d8a7a879d8a7a8
	dq 0x79d8a7a879d8a7a8,0x79d8a7a879d8a7a8
	dq 0xf3b14f50f3b14f50,0xf3b14f50f3b14f50
	dq 0xf3b14f50f3b14f50,0xf3b14f50f3b14f50
	dq 0xe7629ea1e7629ea1,0xe7629ea1e7629ea1
	dq 0xe7629ea1e7629ea1,0xe7629ea1e7629ea1
	dq 0xcec53d43cec53d43,0xcec53d43cec53d43
	dq 0xcec53d43cec53d43,0xcec53d43cec53d43
	dq 0x9d8a7a879d8a7a87,0x9d8a7a879d8a7a87
	dq 0x9d8a7a879d8a7a87,0x9d8a7a879d8a7a87
	dq 0x3b14f50f3b14f50f,0x3b14f50f3b14f50f
	dq 0x3b14f50f3b14f50f,0x3b14f50f3b14f50f
	dq 0x7629ea1e7629ea1e,0x7629ea1e7629ea1e
	dq 0x7629ea1e7629ea1e,0x7629ea1e7629ea1e
	dq 0xec53d43cec53d43c,0xec53d43cec53d43c
	dq 0xec53d43cec53d43c,0xec53d43cec53d43c
	dq 0xd8a7a879d8a7a879,0xd8a7a879d8a7a879
	dq 0xd8a7a879d8a7a879,0xd8a7a879d8a7a879
	dq 0xb14f50f3b14f50f3,0xb14f50f3b14f50f3
	dq 0xb14f50f3b14f50f3,0xb14f50f3b14f50f3
	dq 0x629ea1e7629ea1e7,0x629ea1e7629ea1e7
	dq 0x629ea1e7629ea1e7,0x629ea1e7629ea1e7
	dq 0xc53d43cec53d43ce,0xc53d43cec53d43ce
	dq 0xc53d43cec53d43ce,0xc53d43cec53d43ce
	dq 0x8a7a879d8a7a879d,0x8a7a879d8a7a879d
	dq 0x8a7a879d8a7a879d,0x8a7a879d8a7a879d
	dq 0x14f50f3b14f50f3b,0x14f50f3b14f50f3b
	dq 0x14f50f3b14f50f3b,0x14f50f3b14f50f3b
	dq 0x29ea1e7629ea1e76,0x29ea1e7629ea1e76
	dq 0x29ea1e7629ea1e76,0x29ea1e7629ea1e76
	dq 0x53d43cec53d43cec,0x53d43cec53d43cec
	dq 0x53d43cec53d43cec,0x53d43cec53d43cec
	dq 0xa7a879d8a7a879d8,0xa7a879d8a7a879d8
	dq 0xa7a879d8a7a879d8,0xa7a879d8a7a879d8
	dq 0x4f50f3b14f50f3b1,0x4f50f3b14f50f3b1
	dq 0x4f50f3b14f50f3b1,0x4f50f3b14f50f3b1
	dq 0x9ea1e7629ea1e762,0x9ea1e7629ea1e762
	dq 0x9ea1e7629ea1e762,0x9ea1e7629ea1e762
	dq 0x3d43cec53d43cec5,0x3d43cec53d43cec5
	dq 0x3d43cec53d43cec5,0x3d43cec53d43cec5

SHUF_MASK:	dq 0x0405060700010203,0x0c0d0e0f08090a0b
		dq 0x0405060700010203,0x0c0d0e0f08090a0b

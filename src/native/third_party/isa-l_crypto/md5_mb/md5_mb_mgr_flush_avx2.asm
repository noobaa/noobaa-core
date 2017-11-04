;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;  Copyright(c) 2011-2016 Intel Corporation All rights reserved.
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

%include "md5_job.asm"
%include "md5_mb_mgr_datastruct.asm"

%include "reg_sizes.asm"

extern md5_mb_x8x2_avx2
default rel

%if 1
%ifidn __OUTPUT_FORMAT__, elf64
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; UN*X register definitions
%define arg1    rdi ; rcx
%define arg2    rsi ; rdx

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%else

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; WINDOWS register definitions
%define arg1    rcx
%define arg2    rdx

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
%endif

; Common register definitions

%define state   arg1
%define len2    arg2

; idx must be a register not clobberred by md5_mb_x8x2_avx2
%define idx             rbp

%define unused_lanes    r9

%define lane_data       r10

%define job_rax         rax
%define tmp             rax

%define num_lanes_inuse r8

%endif ;; if 1

; STACK_SPACE needs to be an odd multiple of 8
_XMM_SAVE_SIZE  equ 10*16
_GPR_SAVE_SIZE  equ 8*8
_ALIGN_SIZE     equ 8

_XMM_SAVE       equ 0
_GPR_SAVE       equ _XMM_SAVE + _XMM_SAVE_SIZE
STACK_SPACE     equ _GPR_SAVE + _GPR_SAVE_SIZE + _ALIGN_SIZE

%define APPEND(a,b) a %+ b

; JOB* md5_mb_mgr_flush_avx2(MB_MGR_HMAC_OOO *state)
; arg 1 : rcx : state
global md5_mb_mgr_flush_avx2:function
md5_mb_mgr_flush_avx2:
        sub     rsp, STACK_SPACE
        mov     [rsp + _GPR_SAVE + 8*0], rbx
        mov     [rsp + _GPR_SAVE + 8*3], rbp
        mov     [rsp + _GPR_SAVE + 8*4], r12
        mov     [rsp + _GPR_SAVE + 8*5], r13
        mov     [rsp + _GPR_SAVE + 8*6], r14
        mov     [rsp + _GPR_SAVE + 8*7], r15
%ifidn __OUTPUT_FORMAT__, win64
        mov     [rsp + _GPR_SAVE + 8*1], rsi
        mov     [rsp + _GPR_SAVE + 8*2], rdi
        vmovdqa  [rsp + _XMM_SAVE + 16*0], xmm6
        vmovdqa  [rsp + _XMM_SAVE + 16*1], xmm7
        vmovdqa  [rsp + _XMM_SAVE + 16*2], xmm8
        vmovdqa  [rsp + _XMM_SAVE + 16*3], xmm9
        vmovdqa  [rsp + _XMM_SAVE + 16*4], xmm10
        vmovdqa  [rsp + _XMM_SAVE + 16*5], xmm11
        vmovdqa  [rsp + _XMM_SAVE + 16*6], xmm12
        vmovdqa  [rsp + _XMM_SAVE + 16*7], xmm13
        vmovdqa  [rsp + _XMM_SAVE + 16*8], xmm14
        vmovdqa  [rsp + _XMM_SAVE + 16*9], xmm15
%endif

	mov	DWORD(num_lanes_inuse), [state + _num_lanes_inuse]
	cmp	num_lanes_inuse, 0
	jz	return_null

	; find a lane with a non-null job
	xor	idx, idx
%assign I 1
%rep 15
	cmp	qword [state + _ldata + I * _LANE_DATA_size + _job_in_lane], 0
	cmovne	idx, [APPEND(lane_,I)]
%assign I (I+1)
%endrep

	; copy idx to empty lanes
copy_lane_data:
	mov	tmp, [state + _args + _data_ptr + 8*idx]

%assign I 0
%rep 16
	cmp	qword [state + _ldata + I * _LANE_DATA_size + _job_in_lane], 0
	jne	APPEND(skip_,I)
	mov	[state + _args + _data_ptr + 8*I], tmp
	mov 	dword [state + _lens + 4*I], 0xFFFFFFFF
APPEND(skip_,I):
%assign I (I+1)
%endrep

	; Find min length
	vmovdqu ymm0, [state + _lens + 0*32]
        vmovdqu ymm1, [state + _lens + 1*32]

        vpminud ymm2, ymm0, ymm1        ; ymm2 has {D,C,B,A}
        vpalignr ymm3, ymm3, ymm2, 8    ; ymm3 has {x,x,D,C}
        vpminud ymm2, ymm2, ymm3        ; ymm2 has {x,x,E,F}
        vpalignr ymm3, ymm3, ymm2, 4    ; ymm3 has {x,x,x,E}
        vpminud ymm2, ymm2, ymm3        ; ymm2 has min value in low dword
	vperm2i128 ymm3, ymm2, ymm2, 1	; ymm3 has halves of ymm2 reversed
        vpminud ymm2, ymm2, ymm3        ; ymm2 has min value in low dword

	vmovd   DWORD(idx), xmm2
 	mov	len2, idx
	and	idx, 0xF
	shr	len2, 4
	jz	len_is_0

	vpand   ymm2, ymm2, [rel clear_low_nibble]
        vpshufd ymm2, ymm2, 0

        vpsubd  ymm0, ymm0, ymm2
        vpsubd  ymm1, ymm1, ymm2

        vmovdqu [state + _lens + 0*32], ymm0
        vmovdqu [state + _lens + 1*32], ymm1


	; "state" and "args" are the same address, arg1
	; len is arg2
	call	md5_mb_x8x2_avx2
	; state and idx are intact

len_is_0:
	; process completed job "idx"
	imul	lane_data, idx, _LANE_DATA_size
	lea	lane_data, [state + _ldata + lane_data]

	mov	job_rax, [lane_data + _job_in_lane]
	mov	unused_lanes, [state + _unused_lanes]
	mov	qword [lane_data + _job_in_lane], 0
	mov	dword [job_rax + _status], STS_COMPLETED
	shl	unused_lanes, 4
	or	unused_lanes, idx
	mov	[state + _unused_lanes], unused_lanes

        mov     DWORD(num_lanes_inuse), [state + _num_lanes_inuse]
        sub     num_lanes_inuse, 1
        mov     [state + _num_lanes_inuse], DWORD(num_lanes_inuse)

	mov	dword [state + _lens + 4*idx], 0xFFFFFFFF

	vmovd	xmm0, [state + _args_digest + 4*idx + 0*64]
	vpinsrd	xmm0, [state + _args_digest + 4*idx + 1*64], 1
	vpinsrd	xmm0, [state + _args_digest + 4*idx + 2*64], 2
	vpinsrd	xmm0, [state + _args_digest + 4*idx + 3*64], 3

	vmovdqa	[job_rax + _result_digest + 0*16], xmm0

return:

%ifidn __OUTPUT_FORMAT__, win64
        vmovdqa  xmm6, [rsp + _XMM_SAVE + 16*0]
        vmovdqa  xmm7, [rsp + _XMM_SAVE + 16*1]
        vmovdqa  xmm8, [rsp + _XMM_SAVE + 16*2]
        vmovdqa  xmm9, [rsp + _XMM_SAVE + 16*3]
        vmovdqa  xmm10, [rsp + _XMM_SAVE + 16*4]
        vmovdqa  xmm11, [rsp + _XMM_SAVE + 16*5]
        vmovdqa  xmm12, [rsp + _XMM_SAVE + 16*6]
        vmovdqa  xmm13, [rsp + _XMM_SAVE + 16*7]
        vmovdqa  xmm14, [rsp + _XMM_SAVE + 16*8]
        vmovdqa  xmm15, [rsp + _XMM_SAVE + 16*9]
        mov     rsi, [rsp + _GPR_SAVE + 8*1]
        mov     rdi, [rsp + _GPR_SAVE + 8*2]
%endif
        mov     rbx, [rsp + _GPR_SAVE + 8*0]
        mov     rbp, [rsp + _GPR_SAVE + 8*3]
        mov     r12, [rsp + _GPR_SAVE + 8*4]
        mov     r13, [rsp + _GPR_SAVE + 8*5]
        mov     r14, [rsp + _GPR_SAVE + 8*6]
        mov     r15, [rsp + _GPR_SAVE + 8*7]
        add     rsp, STACK_SPACE

        ret

return_null:
	xor	job_rax, job_rax
	jmp	return


section .data align=16

align 16
clear_low_nibble:
	dq 0x00000000FFFFFFF0, 0x0000000000000000
	dq 0x00000000FFFFFFF0, 0x0000000000000000
lane_1:     dq  1
lane_2:     dq  2
lane_3:     dq  3
lane_4:     dq  4
lane_5:     dq  5
lane_6:     dq  6
lane_7:     dq  7
lane_8:     dq  8
lane_9:     dq  9
lane_10:    dq  10
lane_11:    dq  11
lane_12:    dq  12
lane_13:    dq  13
lane_14:    dq  14
lane_15:    dq  15


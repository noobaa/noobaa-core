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
%ifndef __MEMCPY_ASM__
%define __MEMCPY_ASM__

%include "reg_sizes.asm"


; This file defines a series of macros to copy small to medium amounts
; of data from memory to memory, where the size is variable but limited.
;
; The macros are all called as:
; memcpy DST, SRC, SIZE, TMP0, TMP1, XTMP0, XTMP1, XTMP2, XTMP3
; with the parameters defined as:
;    DST     : register: pointer to dst (not modified)
;    SRC     : register: pointer to src (not modified)
;    SIZE    : register: length in bytes (not modified)
;    TMP0    : 64-bit temp GPR (clobbered)
;    TMP1    : 64-bit temp GPR (clobbered)
;    XTMP0   : temp XMM (clobbered)
;    XTMP1   : temp XMM (clobbered)
;    XTMP2   : temp XMM (clobbered)
;    XTMP3   : temp XMM (clobbered)
;
; The name indicates the options. The name is of the form:
; memcpy_<VEC>_<SZ><ZERO><RET>
; where:
; <VEC> is either "sse" or "avx" or "avx2"
; <SZ> is either "64" or "128" and defines largest value of SIZE
; <ZERO> is blank or "_1". If "_1" then the min SIZE is 1 (otherwise 0)
; <RET> is blank or "_ret". If blank, the code falls through. If "ret"
;                           it does a "ret" at the end
;
; For the avx2 versions, the temp XMM registers need to be YMM registers
; If the SZ is 64, then only two YMM temps are needed, i.e. it is called as:
; memcpy_avx2_64 DST, SRC, SIZE, TMP0, TMP1, YTMP0, YTMP1
; memcpy_avx2_128 DST, SRC, SIZE, TMP0, TMP1, YTMP0, YTMP1, YTMP2, YTMP3
;
; For example:
; memcpy_sse_64		: SSE,  0 <= size < 64, falls through
; memcpy_avx_64_1	: AVX1, 1 <= size < 64, falls through
; memcpy_sse_128_ret	: SSE,  0 <= size < 128, ends with ret
; mempcy_avx_128_1_ret	: AVX1, 1 <= size < 128, ends with ret
;

%macro memcpy_sse_64 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 64, 0, 0
%endm

%macro memcpy_sse_64_1 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 64, 0, 0
%endm

%macro memcpy_sse_128 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 128, 0, 0
%endm

%macro memcpy_sse_128_1 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 128, 0, 0
%endm

%macro memcpy_sse_64_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 64, 1, 0
%endm

%macro memcpy_sse_64_1_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 64, 1, 0
%endm

%macro memcpy_sse_128_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 128, 1, 0
%endm

%macro memcpy_sse_128_1_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 128, 1, 0
%endm


%macro memcpy_sse_16 5
	__memcpy_int %1,%2,%3,%4,%5,,,,, 0, 16, 0, 0
%endm

%macro memcpy_sse_16_1 5
	__memcpy_int %1,%2,%3,%4,%5,,,,, 1, 16, 0, 0
%endm

	;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%macro memcpy_avx_64 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 64, 0, 1
%endm

%macro memcpy_avx_64_1 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 64, 0, 1
%endm

%macro memcpy_avx_128 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 128, 0, 1
%endm

%macro memcpy_avx_128_1 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 128, 0, 1
%endm

%macro memcpy_avx_64_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 64, 1, 1
%endm

%macro memcpy_avx_64_1_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 64, 1, 1
%endm

%macro memcpy_avx_128_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 0, 128, 1, 1
%endm

%macro memcpy_avx_128_1_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,%8,%9, 1, 128, 1, 1
%endm


%macro memcpy_avx_16 5
	__memcpy_int %1,%2,%3,%4,%5,,,,, 0, 16, 0, 1
%endm

%macro memcpy_avx_16_1 5
	__memcpy_int %1,%2,%3,%4,%5,,,,, 1, 16, 0, 1
%endm

	;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%macro memcpy_avx2_64 7
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,--,--, 0, 64, 0, 2
%endm

%macro memcpy_avx2_64_1 7
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,--,--, 1, 64, 0, 2
%endm

%macro memcpy_avx2_128 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7, %8, %9, 0, 128, 0, 2
%endm

%macro memcpy_avx2_128_1 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7, %8, %9, 1, 128, 0, 2
%endm

%macro memcpy_avx2_64_ret 7
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,--,--, 0, 64, 1, 2
%endm

%macro memcpy_avx2_64_1_ret 7
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,--,--, 1, 64, 1, 2
%endm

%macro memcpy_avx2_128_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,--,--, 0, 128, 1, 2
%endm

%macro memcpy_avx2_128_1_ret 9
	__memcpy_int %1,%2,%3,%4,%5,%6,%7,--,--, 1, 128, 1, 2
%endm



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


%macro __memcpy_int 13
%define %%DST     %1	; register: pointer to dst (not modified)
%define %%SRC     %2	; register: pointer to src (not modified)
%define %%SIZE    %3	; register: length in bytes (not modified)
%define %%TMP0    %4	; 64-bit temp GPR (clobbered)
%define %%TMP1    %5	; 64-bit temp GPR (clobbered)
%define %%XTMP0   %6	; temp XMM (clobbered)
%define %%XTMP1   %7	; temp XMM (clobbered)
%define %%XTMP2   %8	; temp XMM (clobbered)
%define %%XTMP3   %9	; temp XMM (clobbered)
%define %%NOT0    %10	; if not 0, then assume size cannot be zero
%define %%MAXSIZE %11	; 128, 64, etc
%define %%USERET  %12   ; if not 0, use "ret" at end
%define %%USEAVX  %13   ; 0 = SSE, 1 = AVX1, 2 = AVX2

%if (%%USERET != 0)
 %define %%DONE	ret
%else
 %define %%DONE jmp %%end
%endif

%if (%%USEAVX != 0)
 %define %%MOVDQU vmovdqu
%else
 %define %%MOVDQU movdqu
%endif

%if (%%MAXSIZE >= 128)
	test	%%SIZE, 64
	jz	%%lt64
  %if (%%USEAVX >= 2)
	%%MOVDQU	%%XTMP0, [%%SRC + 0*32]
	%%MOVDQU	%%XTMP1, [%%SRC + 1*32]
	%%MOVDQU	%%XTMP2, [%%SRC + %%SIZE - 2*32]
	%%MOVDQU	%%XTMP3, [%%SRC + %%SIZE - 1*32]

	%%MOVDQU	[%%DST + 0*32], %%XTMP0
	%%MOVDQU	[%%DST + 1*32], %%XTMP1
	%%MOVDQU	[%%DST + %%SIZE - 2*32], %%XTMP2
	%%MOVDQU	[%%DST + %%SIZE - 1*32], %%XTMP3
  %else
	%%MOVDQU	%%XTMP0, [%%SRC + 0*16]
	%%MOVDQU	%%XTMP1, [%%SRC + 1*16]
	%%MOVDQU	%%XTMP2, [%%SRC + 2*16]
	%%MOVDQU	%%XTMP3, [%%SRC + 3*16]
	%%MOVDQU	[%%DST + 0*16], %%XTMP0
	%%MOVDQU	[%%DST + 1*16], %%XTMP1
	%%MOVDQU	[%%DST + 2*16], %%XTMP2
	%%MOVDQU	[%%DST + 3*16], %%XTMP3

	%%MOVDQU	%%XTMP0, [%%SRC + %%SIZE - 4*16]
	%%MOVDQU	%%XTMP1, [%%SRC + %%SIZE - 3*16]
	%%MOVDQU	%%XTMP2, [%%SRC + %%SIZE - 2*16]
	%%MOVDQU	%%XTMP3, [%%SRC + %%SIZE - 1*16]
	%%MOVDQU	[%%DST + %%SIZE - 4*16], %%XTMP0
	%%MOVDQU	[%%DST + %%SIZE - 3*16], %%XTMP1
	%%MOVDQU	[%%DST + %%SIZE - 2*16], %%XTMP2
	%%MOVDQU	[%%DST + %%SIZE - 1*16], %%XTMP3
  %endif
	%%DONE
%endif

%if (%%MAXSIZE >= 64)
%%lt64
	test	%%SIZE, 32
	jz	%%lt32
  %if (%%USEAVX >= 2)
	%%MOVDQU	%%XTMP0, [%%SRC + 0*32]
	%%MOVDQU	%%XTMP1, [%%SRC + %%SIZE - 1*32]
	%%MOVDQU	[%%DST + 0*32], %%XTMP0
	%%MOVDQU	[%%DST + %%SIZE - 1*32], %%XTMP1
  %else
	%%MOVDQU	%%XTMP0, [%%SRC + 0*16]
	%%MOVDQU	%%XTMP1, [%%SRC + 1*16]
	%%MOVDQU	%%XTMP2, [%%SRC + %%SIZE - 2*16]
	%%MOVDQU	%%XTMP3, [%%SRC + %%SIZE - 1*16]
	%%MOVDQU	[%%DST + 0*16], %%XTMP0
	%%MOVDQU	[%%DST + 1*16], %%XTMP1
	%%MOVDQU	[%%DST + %%SIZE - 2*16], %%XTMP2
	%%MOVDQU	[%%DST + %%SIZE - 1*16], %%XTMP3
  %endif
	%%DONE
%endif

%if (%%MAXSIZE >= 32)
%%lt32:
	test	%%SIZE, 16
	jz	%%lt16
  %if (%%USEAVX >= 2)
	%%MOVDQU	XWORD(%%XTMP0), [%%SRC + 0*16]
	%%MOVDQU	XWORD(%%XTMP1), [%%SRC + %%SIZE - 1*16]
	%%MOVDQU	[%%DST + 0*16], XWORD(%%XTMP0)
	%%MOVDQU	[%%DST + %%SIZE - 1*16], XWORD(%%XTMP1)
  %else
	%%MOVDQU	%%XTMP0, [%%SRC + 0*16]
	%%MOVDQU	%%XTMP1, [%%SRC + %%SIZE - 1*16]
	%%MOVDQU	[%%DST + 0*16], %%XTMP0
	%%MOVDQU	[%%DST + %%SIZE - 1*16], %%XTMP1
  %endif
	%%DONE
%endif

%if (%%MAXSIZE >= 16)
%%lt16:
	test	%%SIZE, 8
	jz	%%lt8
	mov	%%TMP0, [%%SRC]
	mov	%%TMP1, [%%SRC + %%SIZE - 8]
	mov	[%%DST], %%TMP0
	mov	[%%DST + %%SIZE - 8], %%TMP1
	%%DONE
%endif

%if (%%MAXSIZE >= 8)
%%lt8:
	test	%%SIZE, 4
	jz	%%lt4
	mov	DWORD(%%TMP0), [%%SRC]
	mov	DWORD(%%TMP1), [%%SRC + %%SIZE - 4]
	mov	[%%DST], DWORD(%%TMP0)
	mov	[%%DST + %%SIZE - 4], DWORD(%%TMP1)
	%%DONE
%endif

%if (%%MAXSIZE >= 4)
%%lt4:
	test	%%SIZE, 2
	jz	%%lt2
	movzx	DWORD(%%TMP0), word [%%SRC]
	movzx	DWORD(%%TMP1), byte [%%SRC + %%SIZE - 1]
	mov	[%%DST], WORD(%%TMP0)
	mov	[%%DST + %%SIZE - 1], BYTE(%%TMP1)
	%%DONE
%endif

%%lt2:
%if (%%NOT0 == 0)
	 test	 %%SIZE, 1
	 jz	 %%end
%endif
	movzx	DWORD(%%TMP0), byte [%%SRC]
	mov	[%%DST], BYTE(%%TMP0)
%%end:
%if (%%USERET != 0)
	ret
%endif
%endm

%endif ; ifndef __MEMCPY_ASM__

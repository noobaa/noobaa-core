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
    .arch armv8-a+crypto
    .text

#include "cbc_common.S"

        declare_var_vector_reg  Key0 ,17
        declare_var_vector_reg  Key1 ,18
        declare_var_vector_reg  Key2 ,19
        declare_var_vector_reg  Key3 ,20
        declare_var_vector_reg  Key4 ,21
        declare_var_vector_reg  Key5 ,22
        declare_var_vector_reg  Key6 ,23
        declare_var_vector_reg  Key7 ,24
        declare_var_vector_reg  Key8 ,25
        declare_var_vector_reg  Key9 ,26
        declare_var_vector_reg  Key10 ,27
        declare_var_vector_reg  Key11 ,28
        declare_var_vector_reg  Key12 ,29
        declare_var_vector_reg  Key13 ,30
        declare_var_vector_reg  Key14 ,31

.macro aes_encrypt_round    block,key
    aese    v\block\().16b,vKey\key\().16b
    .if \key < 13
        aesmc   v\block\().16b,v\block\().16b
    .endif
.endm

.macro aes_encrypt_round_name    block,key
    aese    v\block\().16b,v\key\().16b
    aesmc   v\block\().16b,v\block\().16b
.endm



.set        stack_size,64
.macro  push_stack
    stp      d8, d9,[sp,-stack_size]!
    stp     d10,d11,[sp,16]
    stp     d12,d13,[sp,32]
    stp     d14,d15,[sp,48]
.endm

.macro  pop_stack
    ldp     d10,d11,[sp,16]
    ldp     d12,d13,[sp,32]
    ldp     d14,d15,[sp,48]
    ldp     d8, d9, [sp], stack_size
.endm
/*
void aes_cbc_dec_128(
	void     *in,        //!< Input cipher text
	uint8_t  *IV,        //!< Must be 16 bytes aligned to a 16 byte boundary
	uint8_t  *keys,      //!< Must be on a 16 byte boundary and length of key size * key rounds or dec_keys of cbc_key_data
	void     *out,       //!< Output plain text
	uint64_t len_bytes   //!< Must be a multiple of 16 bytes
	);
*/
    declare_var_generic_reg in          ,0
    declare_var_generic_reg IV          ,1
    declare_var_generic_reg keys        ,2
    declare_var_generic_reg out         ,3
    declare_var_generic_reg len_bytes   ,4

    declare_var_vector_reg  State       ,0
    declare_var_vector_reg  FirstKey    ,1
    declare_var_vector_reg  Block       ,2
    declare_var_vector_reg  ConstKey    ,3
.macro  load_key    num
    ldr     qKey\num,[keys],16
.endm
.altmacro
.macro  cbc_encrypt     first:req
    lsr     xlen_bytes,xlen_bytes,4
    cbz     xlen_bytes,3f
    ldr     qState,[IV]
    ldr     qKey\first,[keys],16
    .set    lastkey_off,13-\first
    ldr     qKey14,[keys,lastkey_off*16]
    ldr     qBlock,[in],16
    n=\first
    second=1+\first
    .rept   5-n
        n=n+1
        load_key    %n
    .endr
    ld1     {vKey6.4s - vKey9.4s},[keys],4*16
    eor     vBlock.16b,vBlock.16b ,vState.16b
    eor     vConstKey.16b,vKey\first\().16b,vKey14.16b
    aes_encrypt_round   Block,\first
    ld1         {vKey10.4s - vKey13.4s},[keys]
    b           1f
2:
    aes_encrypt_round   Block,\first
    str                 qState,[out],16
1:
    sub                 xlen_bytes,xlen_bytes,1
    aes_encrypt_round   Block,%second
    cbz                 xlen_bytes,1f
    ldr                 qKey\first,[in],16
1:
    n=second
    .rept   12-n
        n=n+1
        aes_encrypt_round    Block,%n
    .endr

    eor         vKey\first\().16b,vKey\first\().16b,vConstKey.16b
    aes_encrypt_round   Block,13
    eor         vState.16b,vBlock.16b,vKey14.16b
    cbnz        xlen_bytes,2b
    str         qState,[out]
3:

.endm
START_FUNC(enc,128,aes)
    cbc_encrypt 4
    ret
END_FUNC(enc,128,aes)

START_FUNC(enc,192,aes)
    cbc_encrypt 2
    ret
END_FUNC(enc,192,aes)

START_FUNC(enc,256,aes)
    cbc_encrypt 0
    ret
END_FUNC(enc,256,aes)
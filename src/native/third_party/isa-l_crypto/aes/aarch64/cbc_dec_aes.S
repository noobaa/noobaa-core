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
    .altmacro
.macro _aes_decrypt_round    block:req,key:req
    aesd    v\block\().16b,vKey\key\().16b
    .if \key < 13
        aesimc   v\block\().16b,v\block\().16b
    .endif
    .if \key > 13
        .error "erro her"
    .endif
.endm

.macro  aes_decrypt_round   block,reg,key
    _aes_decrypt_round  In\reg\()_\block,\key
.endm

.macro  load_keys   first_key
    .if \first_key == 4
        ld1     {vKey4.4s -vKey6.4s},[keys],3*16
    .endif
    .ifc 2 , \first_key
        ldr     qKey2,[keys],1*16
        ld1     {vKey3.16b -vKey6.16b},[keys],4*16
    .endif
    .ifc 0 , \first_key
        ld1     {vKey0.16b -vKey2.16b},[keys],3*16
        ld1     {vKey3.16b -vKey6.16b},[keys],4*16
    .endif
    ld1     {vKey7.16b -vKey10.16b},[keys],4*16
    ld1     {vKey11.16b-vKey14.16b},[keys],4*16
.endm

.macro  aes_decrypt_blocks_round    blocks,key_idx,key_reg,next_keyreg,first_idx
    .if \key_idx == 12
        ldr q\next_keyreg,[keys],(\first_idx-13)*16
    .else
        ldr q\next_keyreg,[keys],16
    .endif
    n=0
    .rept   \blocks
        _aes_decrypt_round  %n,\key_reg
        n=n+1
    .endr
.endm

.macro  aes_decrypt_rounds   blocks,key_st,key_end,first_idx
    j=key_st
    .rept   \key_end - \key_st + 1
        aes_decrypt_blocks_round    \blocks,%j,%(j%2),%((j+1)%2),\first_idx
        j=j+1
    .endr
.endm

.macro  aes_cbc_decrypt_rounds  blocks,first_idx,reg,next_reg
    aes_decrypt_rounds  \blocks,\first_idx,12,\first_idx
.endm

.macro  declare_prefix idx,reg,prefix
    declare_var_vector_reg  \prefix\()\idx,\reg
.endm

.macro  mldr    reg,block,addr
    ldr qIn\reg\()_\block,[\addr],16
.endm

.macro  mldrin    reg,blocks,addr
    .if \blocks == 1
        ldr qIn\reg\()_0,[\addr],16
        .exitm
    .endif
    .if \blocks == 2
        ldp qIn\reg\()_0,qIn\reg\()_1,[\addr],2*16
        .exitm
    .endif
    .if \blocks == 3
        ldr qIn\reg\()_0,[\addr],16
        ldp qIn\reg\()_1,qIn\reg\()_2,[\addr],2*16
        .exitm
    .endif
    .if \blocks == 4
        ld1 {vIn\reg\()_0.16b-vIn\reg\()_3.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 5
        ldr qIn\reg\()_0,[\addr],16
        ld1 {vIn\reg\()_1.16b-vIn\reg\()_4.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 6
        ldp qIn\reg\()_0,qIn\reg\()_1,[\addr],2*16
        ld1 {vIn\reg\()_2.16b-vIn\reg\()_5.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 7
        ld1 {vIn\reg\()_0.16b-vIn\reg\()_2.16b},[\addr],3*16
        ld1 {vIn\reg\()_3.16b-vIn\reg\()_6.16b},[\addr],4*16
        .exitm
    .endif

    .if \blocks == 8
        ld1 {vIn\reg\()_0.16b-vIn\reg\()_3.16b},[\addr],4*16
        ld1 {vIn\reg\()_4.16b-vIn\reg\()_7.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 9
        ld1 {vIn\reg\()_0.16b-vIn\reg\()_3.16b},[\addr],4*16
        ld1 {vIn\reg\()_4.16b-vIn\reg\()_7.16b},[\addr],4*16
        ldr qIn\reg\()_8,[\addr],16
        .exitm
    .endif
.endm

.macro  mstrout    reg,blocks,addr
    .if \blocks == 1
        str qIn\reg\()_0,[\addr],16
        .exitm
    .endif
    .if \blocks == 2
        stp qIn\reg\()_0,qIn\reg\()_1,[\addr],2*16
        .exitm
    .endif
    .if \blocks == 3
        str qIn\reg\()_0,[\addr],16
        stp qIn\reg\()_1,qIn\reg\()_2,[\addr],2*16
        .exitm
    .endif
    .if \blocks == 4
        st1 {vIn\reg\()_0.16b-vIn\reg\()_3.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 5
        str qIn\reg\()_0,[\addr],16
        st1 {vIn\reg\()_1.16b-vIn\reg\()_4.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 6
        stp qIn\reg\()_0,qIn\reg\()_1,[\addr],2*16
        st1 {vIn\reg\()_2.16b-vIn\reg\()_5.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 7
        st1 {vIn\reg\()_0.16b-vIn\reg\()_2.16b},[\addr],3*16
        st1 {vIn\reg\()_3.16b-vIn\reg\()_6.16b},[\addr],4*16
        .exitm
    .endif

    .if \blocks == 8
        st1 {vIn\reg\()_0.16b-vIn\reg\()_3.16b},[\addr],4*16
        st1 {vIn\reg\()_4.16b-vIn\reg\()_7.16b},[\addr],4*16
        .exitm
    .endif
    .if \blocks == 9
        st1 {vIn\reg\()_0.16b-vIn\reg\()_3.16b},[\addr],4*16
        st1 {vIn\reg\()_4.16b-vIn\reg\()_7.16b},[\addr],4*16
        str qIn\reg\()_8,[\addr],16
        .exitm
    .endif
.endm

.macro  eorkey14    block,reg
    eor     vBlock\block\().16b,vKey14.16b,vState\reg\()_\block\().16b
.endm

.macro  eorblock    block,reg
    eor     vIn\reg\()_\block\().16b,vBlock\block\().16b,vIn\reg\()_\block\().16b
.endm

.macro  movstate0   block,reg
    mov     vState\reg\()_0.16b,vIn\reg\()_\block\().16b
.endm

.macro cbc_decrypt_rounds   blocks,reg,first_key,cur_blocks
    .ifb    \cur_blocks
        _blocks=\blocks
    .else
        _blocks=\cur_blocks
    .endif
    key=\first_key + 1
    .if 3*\blocks+1 >= 32-15+\first_key
        ldr_key %key,\first_key
    .endif
    n=0
    .rept   _blocks - 1
        eorkey14            %((n+1)%_blocks),\reg
        aes_decrypt_round   %n,\reg,\first_key
        n=n+1
    .endr
    eorkey14            0,\reg
    movstate0           %(_blocks-1),\reg
    aes_decrypt_round   %n,\reg,\first_key

    k=0
    .rept   15-\first_key-3
        n=0
        .if 3*\blocks+1 >= 32-15+\first_key
            ldr_key %(key+k+1),\first_key
        .endif

        .rept _blocks
            aes_decrypt_round   %n,\reg,%(key+k)
            n=n+1
        .endr
        k=k+1
    .endr
    n=0
    .if 3*\blocks+1 >= 32-15+\first_key
        ldr_key \first_key,\first_key
    .endif
    .rept _blocks
        aes_decrypt_round   %n,\reg,13
        eorblock            %n,\reg
        n=n+1
    .endr
.endm

.macro  print_macro a,b,c,d,e
    .print "print_macro,\a \b \c \d \e"
.endm

.macro  remainder_process   blocks,first_key,curblk
.if \blocks >   (1<<\curblk)
        tbz                 xlen_remainder,\curblk,1f
        mldrin              0,%(1<<\curblk),in
        cbc_decrypt_rounds  \blocks,0,\first_key,%(1<<\curblk)
        mstrout             0,%(1<<\curblk),out
1:
.endif
.endm

.macro  aes_cbc_decrypt_blocks  first_key,blocks
    division    \blocks, len_bytes,len_remainder,tmp0,tmp1
    mov         xlen_quotient_in,xlen_quotient
    /*
    input regs(2*\block) + tmp regs(\blocks) + State reg(1)
       + key regs(15-\first_key) < 32
    */
    .if 3*\blocks+1 < 32-15+\first_key
        n=\first_key
        .rept   15-\first_key
            declare_prefix  %n,%(n+17),Key
            n=n+1
        .endr
        load_keys   \first_key
    .else
        n=\first_key
        .rept   14-\first_key
            declare_prefix  %n,%((n%2)+29),Key
            n=n+1
        .endr
        declare_prefix  14,31,Key
        /* load first key */
        ldr_key \first_key,\first_key
        /* load last key */
        ldr_key 14,\first_key
    .endif
    m=\blocks
    l=\blocks-1
    declare_prefix  0,0,State0_
    declare_prefix  0,0,State1_
    n=0
    .rept   \blocks
        declare_prefix  %n,%(n+1),In0_
        declare_prefix  %n,%(n+m+1),In1_
        declare_prefix  %n,%(n+2*m+1),Block
        n=n+1
    .endr
    n=1
    .rept   \blocks -1
        declare_prefix  %n,%(n),State0_
        declare_prefix  %n,%(n+m),State1_
        n=n+1
    .endr
    ldr     qState0_0,[IV]
    cbz     xlen_quotient,9f
    mldrin  0,\blocks,in
    sub                 xlen_quotient_in,xlen_quotient_in,1
    b       5f

3:
    sub                 xlen_quotient,xlen_quotient,1
    mstrout             1,\blocks,out
    cbz                 xlen_quotient,9f
5:
    cbz                 xlen_quotient_in,1f
    mldrin              1,\blocks,in
    sub                 xlen_quotient_in,xlen_quotient_in,1
1:
    cbc_decrypt_rounds  \blocks,0,\first_key
    sub                 xlen_quotient,xlen_quotient,1
    mstrout             0,\blocks,out
    cbz                 xlen_quotient,9f

    cbz                 xlen_quotient_in,1f
    mldrin              0,\blocks,in
    sub                 xlen_quotient_in,xlen_quotient_in,1
1:
    cbc_decrypt_rounds  \blocks,1,\first_key
    b       3b
9:
    remainder_process   \blocks,\first_key,3
    remainder_process   \blocks,\first_key,2
    remainder_process   \blocks,\first_key,1
    remainder_process   \blocks,\first_key,0
.endm


.macro division     blocks,quotient,remainder,tmp0,tmp1
    .if \blocks == 1
            mov     x\remainder, 0
            .exitm
    .endif
    .if \blocks == 2
            and     x\remainder, x\quotient, 1
            lsr     x\quotient, x\quotient, 1
            .exitm
    .endif
    .if \blocks == 3
            mov     x\tmp0, -6148914691236517206
            mov     x\remainder, x\quotient
            movk    x\tmp0, 0xaaab, lsl 0
            umulh   x\tmp0, x\quotient, x\tmp0
            and     x\tmp1, x\tmp0, -2
            lsr     x\quotient, x\tmp0, 1
            add     x\tmp1, x\tmp1, x\quotient
            sub     x\remainder, x\remainder, x\tmp1
            .exitm
    .endif
    .if \blocks == 4
            and     x\remainder, x\quotient, 3
            lsr     x\quotient, x\quotient, 2
            .exitm
    .endif
    .if \blocks == 5
            mov     x\tmp0, -3689348814741910324
            mov     x\remainder, x\quotient
            movk    x\tmp0, 0xcccd, lsl 0
            umulh   x\tmp0, x\quotient, x\tmp0
            and     x\tmp1, x\tmp0, -4
            lsr     x\quotient, x\tmp0, 2
            add     x\tmp1, x\tmp1, x\quotient
            sub     x\remainder, x\remainder, x\tmp1
            .exitm
    .endif
    .if \blocks == 6
            mov     x\tmp0, -6148914691236517206
            mov     x\tmp1, x\quotient
            movk    x\tmp0, 0xaaab, lsl 0
            umulh   x\tmp0, x\quotient, x\tmp0
            lsr     x\quotient, x\tmp0, 2
            add     x\remainder, x\quotient, x\quotient, lsl 1
            sub     x\remainder, x\tmp1, x\remainder, lsl 1
            .exitm
    .endif
    .if \blocks == 7
            mov     x\tmp0, 9363
            mov     x\tmp1, x\quotient
            movk    x\tmp0, 0x9249, lsl 16
            movk    x\tmp0, 0x4924, lsl 32
            movk    x\tmp0, 0x2492, lsl 48
            umulh   x\quotient, x\quotient, x\tmp0
            sub     x\tmp0, x\tmp1, x\quotient
            add     x\tmp0, x\quotient, x\tmp0, lsr 1
            lsr     x\quotient, x\tmp0, 2
            lsl     x\remainder, x\quotient, 3
            sub     x\remainder, x\remainder, x\quotient
            sub     x\remainder, x\tmp1, x\remainder
            .exitm
    .endif
    .if \blocks == 8
            and     x\remainder, x\quotient, 7
            lsr     x\quotient, x\quotient, 3
            .exitm
    .endif
    .if \blocks == 9
            mov     x\tmp0, 58255
            mov     x\remainder, x\quotient
            movk    x\tmp0, 0x8e38, lsl 16
            movk    x\tmp0, 0x38e3, lsl 32
            movk    x\tmp0, 0xe38e, lsl 48
            umulh   x\tmp0, x\quotient, x\tmp0
            and     x\tmp1, x\tmp0, -8
            lsr     x\quotient, x\tmp0, 3
            add     x\tmp1, x\tmp1, x\quotient
            sub     x\remainder, x\remainder, x\tmp1
            .exitm
    .endif
.endm

.macro  ldr_key    num,first_key
    ldr     qKey\num,[keys,16*(\num - \first_key)]
.endm
#ifndef CBC_DECRYPT_BLOCKS_NUM
#define CBC_DECRYPT_BLOCKS_NUM 8
#endif

.macro  cbc_decrypt     first_key:req,blocks
    lsr     xlen_bytes,xlen_bytes,4
    cbz     xlen_bytes,10f
    push_stack
    aes_cbc_decrypt_blocks \first_key,\blocks
    pop_stack
10:
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
    declare_var_generic_reg len_quotient,4
    declare_var_generic_reg len_remainder,5
    declare_var_generic_reg tmp0        ,6
    declare_var_generic_reg tmp1        ,7
    declare_var_generic_reg len_quotient_in,6

.macro  define_aes_cbc_dec_func mode:req,blocks:req
    .global aes_cbc_dec_\mode\()_aes_\blocks
aes_cbc_dec_\mode\()_aes_\blocks:
    cbc_decrypt %((256-mode)/32),\blocks
    ret
    .size   aes_cbc_dec_\mode\()_aes_\blocks, . - aes_cbc_dec_\mode\()_aes_\blocks
.endm

.irp    blocks,1,2,3,4,5,6,7,8,9
    define_aes_cbc_dec_func 128,\blocks
    define_aes_cbc_dec_func 192,\blocks
    define_aes_cbc_dec_func 256,\blocks
.endr

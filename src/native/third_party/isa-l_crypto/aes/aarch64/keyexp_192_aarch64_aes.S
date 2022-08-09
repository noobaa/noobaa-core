/**********************************************************************
  Copyright(c) 2020 Arm Corporation All rights reserved.

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
/*
Macros
*/

.macro  declare_var_vector_reg name:req,reg:req
        q\name      .req        q\reg
        v\name      .req        v\reg
        s\name      .req        s\reg
.endm
.macro  round_192 off:req,rcon:req,export_dec_key
    .if   \off == 0
        ldp     w_tmp0,w_tmp1,[key]
        ldp     w_tmp2,w_tmp3,[key,8]
        ldp     w_tmp4,w_tmp5,[key,16]
        movi    vzero.4s,0
        dup     vsrc.4s,w_tmp5
        stp     w_tmp0,w_tmp1,[exp_key_enc]
        stp     w_tmp4,w_tmp5,[exp_key_enc,16]
        stp     w_tmp2,w_tmp3,[exp_key_enc,8]

        .ifnb   \export_dec_key
            stp     w_tmp4,w_tmp5,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN-8]
            stp     w_tmp0,w_tmp1,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN+8]
            stp     w_tmp2,w_tmp3,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN+16]
        .endif

    .endif
        mov     w0,\rcon
        mov     vdest.16b,vzero.16b
        aese    vdest.16b,vsrc.16b
        mov     w_tmp,vdest.s[0]
        eor     w_tmp0,w_tmp0,w0
        eor     w_tmp0,w_tmp0,w_tmp,ror 8
        eor     w_tmp1,w_tmp0,w_tmp1
        eor     w_tmp2,w_tmp1,w_tmp2
        eor     w_tmp3,w_tmp2,w_tmp3
    .if \off < 7
        eor     w_tmp4,w_tmp4,w_tmp3
        eor     w_tmp5,w_tmp5,w_tmp4
        dup     vsrc.4s,w_tmp5
        stp     w_tmp0,w_tmp1,[exp_key_enc,KEY_LEN*(\off+1)]
        stp     w_tmp2,w_tmp3,[exp_key_enc,KEY_LEN*(\off+1)+8]
        stp     w_tmp4,w_tmp5,[exp_key_enc,KEY_LEN*(\off+1)+16]
        .ifnb   \export_dec_key
            .if (\off & 1) == 0
                stp     w_tmp4,w_tmp5,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN*(\off+2)+8]
                stp     w_tmp0,w_tmp1,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN*(\off+2)+24]
                stp     w_tmp2,w_tmp3,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN*(\off+2)]
            .else
                stp     w_tmp4,w_tmp5,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN*(\off+2)-8]
                stp     w_tmp0,w_tmp1,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN*(\off+2)+8]
                stp     w_tmp2,w_tmp3,[exp_key_dec, KEY_BUF_SIZE-KEY_LEN*(\off+2)+16]
            .endif
        .endif
    .else
        stp     w_tmp0,w_tmp1,[exp_key_enc,KEY_LEN*(\off+1)]
        stp     w_tmp2,w_tmp3,[exp_key_enc,KEY_LEN*(\off+1)+8]
        .ifnb   \export_dec_key
            stp     w_tmp0,w_tmp1,[exp_key_dec]
            stp     w_tmp2,w_tmp3,[exp_key_dec,8]
        .endif
    .endif

.endm
/**
    void aes_keyexp_192_aes(const uint8_t * key,
        uint8_t * exp_key_enc, uint8_t * exp_key_dec)
*/
    key         .req    x0
    exp_key_enc .req    x1
    exp_key_dec .req    x2
    .equ        KEY_LEN,     (192/8)
    .equ        KEY_BUF_SIZE,((7+KEY_LEN/4)*16)
    w_tmp0      .req    w3
    w_tmp1      .req    w4
    w_tmp2      .req    w5
    w_tmp3      .req    w6
    w_tmp       .req    w7
    w_tmp4      .req    w9
    w_tmp5      .req    w10
    declare_var_vector_reg dest,0
    declare_var_vector_reg zero,1
    declare_var_vector_reg src, 2


    .global aes_keyexp_192_aes
    .type       aes_keyexp_192_aes, %function

aes_keyexp_192_aes:
    .set    rcon,1
    .set    off,0
    .rept   8
        round_192   off,rcon,1
        .set        off,off+1
        .set        rcon,(rcon << 1) ^ ((rcon >> 7) * 0x11b)
    .endr
    ret
    .size       aes_keyexp_192_aes, .-aes_keyexp_192_aes


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
#define KEY_LEN 128
#include "gcm_common.S"

#define KEY_REGS 0,1,2,3,4,5,6,7,8
.macro aes_encrypt_block    block:req
    aes_encrypt_round       \block,Key0
    aes_encrypt_round       \block,Key1
    aes_encrypt_round       \block,Key2
    aes_encrypt_round       \block,Key3
    aes_encrypt_round       \block,Key4
    aes_encrypt_round       \block,Key5
    aes_encrypt_round       \block,Key6
    aes_encrypt_round       \block,Key7
    aes_encrypt_round       \block,Key8
    aese    v\block\().16b,vKey9.16b
    eor     v\block\().16b,v\block\().16b,vKey10.16b
.endm

/*
    Load Aes Keys to [vKey0..vKey8,vKeyLast0,vKeyLast1]
 */
.macro load_aes_keys    key_addr:req
    ld1     {vKey0.4s- vKey3.4s},[\key_addr],64
    ld1     {vKey4.4s- vKey7.4s},[\key_addr],64
    ldp     qKey8,qKey9,[\key_addr],32
    ldr     qKey10,[\key_addr],15*16 - 128 - 32
.endm



/*
    [low,middle,tmp0,high] +=aadhash * [hashkey0,hashkey0_ext]
    dat=*dat_adr
    enc_dat=aes_encrypt(ctr)^dat
    aadhash=rbit(enc_dat)
    [hashkey0,hashkey0_ext] = *hashkey_adr
    dat_adr+=16
    hashkey_adr+=32
*/
.macro  aes_gcm_middle   is_enc:req,aadhash:req,dat_adr:req,hashkey_adr:req,    \
    hashkey0:req,hashkey0_ext:req,high:req,low:req,                             \
    ctr:req,enc_ctr:req,one:req,out_adr:req,                                    \
    tmp0:req,tmp1:req,left_count:req

    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey0\().2d
    pmull    v\tmp1\().1q,v\aadhash\().1d,v\hashkey0\().1d
    .if  \left_count > 1
        ldr      q\hashkey0,[\hashkey_adr],16
    .endif

    add      v\ctr\().4s,v\ctr\().4s,v\one\().4s    //increase ctr

    rev32    v\enc_ctr\().16b,v\ctr\().16b
    aes_encrypt_round   \enc_ctr,Key0
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    pmull    v\tmp0\().1q,v\aadhash\().1d,v\hashkey0_ext\().1d
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b
    pmull2   v\tmp1\().1q,v\aadhash\().2d,v\hashkey0_ext\().2d
    .if  \left_count > 1
        ldr      q\hashkey0_ext,[\hashkey_adr],16
    .endif
    eor     v\aadhash\().16b,v\aadhash\().16b,v\aadhash\().16b
    aes_encrypt_round   \enc_ctr,Key1
    aes_encrypt_round   \enc_ctr,Key2
    eor      v\tmp0\().16b,v\tmp1\().16b,v\tmp0\().16b
    aes_encrypt_round   \enc_ctr,Key3
    ext      v\tmp1\().16b,v\aadhash\().16b,v\tmp0\().16b,8
    ext      v\tmp0\().16b,v\tmp0\().16b,v\aadhash\().16b,8
    aes_encrypt_round   \enc_ctr,Key4
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    aes_encrypt_round   \enc_ctr,Key5
    ldr      q\aadhash,[\dat_adr],16
    aes_encrypt_round   \enc_ctr,Key6
    aes_encrypt_round   \enc_ctr,Key7
    aes_encrypt_round   \enc_ctr,Key8
    aese    v\enc_ctr\().16b,vKey9.16b
    eor     v\enc_ctr\().16b,v\enc_ctr\().16b,vKey10.16b
    eor     v\enc_ctr\().16b,v\enc_ctr\().16b,v\aadhash\().16b
    .ifc \is_enc, encrypt
        rbit    v\aadhash\().16b,v\enc_ctr\().16b
    .endif
    .ifc \is_enc , decrypt
        rbit    v\aadhash\().16b,v\aadhash\().16b
    .endif
    str     q\enc_ctr,[\out_adr],16
.endm

.macro  aes_gcm_init    is_enc:req,aadhash:req,dat_adr:req,hashkey_adr:req,     \
    hashkey0:req,hashkey0_ext:req, high:req,low:req,                            \
    ctr:req,enc_ctr:req,one:req,out_adr:req,                                    \
    tmp0:req,tmp1:req,left_count:req
    ldr     q\hashkey0,[\hashkey_adr],16
    add      v\ctr\().4s,v\ctr\().4s,v\one\().4s    //increase ctr
    rev32    v\enc_ctr\().16b,v\ctr\().16b
    aes_encrypt_round   \enc_ctr,Key0
    ldr     q\hashkey0_ext,[\hashkey_adr],16
    aes_encrypt_round   \enc_ctr,Key1
    pmull2   v\high\().1q,v\aadhash\().2d,v\hashkey0\().2d
    pmull    v\low\().1q,v\aadhash\().1d,v\hashkey0\().1d

    .if  \left_count > 1
        ldr      q\hashkey0,[\hashkey_adr],16
    .endif
    aes_encrypt_round   \enc_ctr,Key2
    pmull    v\tmp1\().1q,v\aadhash\().1d,v\hashkey0_ext\().1d
    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey0_ext\().2d
    eor      v\aadhash\().16b,v\aadhash\().16b,v\aadhash\().16b

    .if  \left_count > 1
        ldr      q\hashkey0_ext,[\hashkey_adr],16
    .endif
    aes_encrypt_round   \enc_ctr,Key3
    eor      v\tmp0\().16b,v\tmp1\().16b,v\tmp0\().16b

    aes_encrypt_round   \enc_ctr,Key4
    ext      v\tmp1\().16b,v\aadhash\().16b,v\tmp0\().16b,8 //low
    ext      v\tmp0\().16b,v\tmp0\().16b,v\aadhash\().16b,8 //high
    aes_encrypt_round   \enc_ctr,Key5
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    aes_encrypt_round   \enc_ctr,Key6
    ldr      q\aadhash,[\dat_adr],16
    aes_encrypt_round   \enc_ctr,Key7
    aes_encrypt_round   \enc_ctr,Key8
    aese    v\enc_ctr\().16b,vKey9.16b
    eor     v\enc_ctr\().16b,v\enc_ctr\().16b,vKey10.16b
    eor     v\enc_ctr\().16b,v\enc_ctr\().16b,v\aadhash\().16b
    .ifc \is_enc , encrypt
        rbit    v\aadhash\().16b,v\enc_ctr\().16b
    .endif
    .ifc \is_enc , decrypt
        rbit    v\aadhash\().16b,v\aadhash\().16b
    .endif
    str     q\enc_ctr,[\out_adr],16
.endm


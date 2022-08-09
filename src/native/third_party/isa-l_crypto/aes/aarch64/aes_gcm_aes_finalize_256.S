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

#include "gcm_common_256.S"
/*
    void gist_aes_gcm_enc_finalize_##mode(                              \
        const struct gcm_key_data *key_data,                            \
        struct gcm_context_data *context,                               \
        uint8_t *auth_tag,                                              \
        uint64_t auth_tag_len                                           \
    )
*/
    declare_var_generic_reg key_data            ,0
    declare_var_generic_reg context             ,1
    declare_var_generic_reg auth_tag            ,2
    declare_var_generic_reg auth_tag_len        ,3
    declare_var_generic_reg partial_block_len   ,4
    declare_var_generic_reg partial_block       ,1

    declare_var_generic_reg hashkey_addr        ,0
    declare_var_generic_reg temp0               ,6

    declare_var_vector_reg  OrigIV              ,0
    declare_var_vector_reg  AadHash             ,1
    declare_var_vector_reg  HashKey0            ,2
    declare_var_vector_reg  HashKey0Ext         ,3
    declare_var_vector_reg  High                ,4
    declare_var_vector_reg  Low                 ,5
    declare_var_vector_reg  Middle0             ,6
    declare_var_vector_reg  Len                 ,7
    declare_var_vector_reg  Tmp0                ,8
    declare_var_vector_reg  Tmp1                ,9
    declare_var_vector_reg  Zero                ,10
    declare_var_vector_reg  Poly                ,11
    declare_var_vector_reg  PartitialBlock      ,13

    declare_var_vector_reg  Tmp2                ,31
    declare_var_vector_reg  Tmp3                ,12

    .set        stack_size,48
    .macro  push_stack
        stp      d8, d9,[sp,-stack_size]!
        stp     d10,d11,[sp,16]
        stp     d12,d13,[sp,32]
    .endm
    .macro  pop_stack
        ldp     d10,d11,[sp,16]
        ldp     d12,d13,[sp,32]
        ldp     d8, d9, [sp], stack_size
    .endm

START_FUNC(enc,KEY_LEN,_finalize_)
START_FUNC(dec,KEY_LEN,_finalize_)
    ldr             partial_block_len,[context,PARTIAL_BLOCK_LENGTH_OFF]
    load_aes_keys   key_data
    push_stack

    ldr             qOrigIV,[context,ORIG_IV_OFF]                           /*  OrigIV */
    ldp             qAadHash,qLen,[context],PARTIAL_BLOCK_ENC_KEY_OFF       /*  Len  , context move to partial block*/
    /* Init Consts for ghash  */
    movi            vZero.4s,0
    mov             temp0,0x87
    dup             vPoly.2d,temp0
    /* complete part */
    cbnz         partial_block_len,10f
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr,(HASHKEY_TOTAL_NUM-2)*32]
    aes_encrypt_round   OrigIV,Key0
    pmull2      vHigh.1q,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   OrigIV,Key1
    pmull       vLow.1q ,vAadHash.1d,vHashKey0.1d
    shl         vLen.2d,vLen.2d,3                                   /*  Len  */
    aes_encrypt_round   OrigIV,Key2
    pmull       vMiddle0.1q,vAadHash.1d,vHashKey0Ext.1d
    rev64       vLen.16b,vLen.16b                                   /*  Len  */
    aes_encrypt_round   OrigIV,Key3
    pmull2      vTmp0.1q   ,vAadHash.2d,vHashKey0Ext.2d
    rbit        vAadHash.16b,vLen.16b                               /*  Len  */
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr,(HASHKEY_TOTAL_NUM-1)*32]
    aes_encrypt_round   OrigIV,Key4
    eor         vMiddle0.16b,vMiddle0.16b,vTmp0.16b
    aes_encrypt_round   OrigIV,Key5
    pmull2      vTmp0.1q ,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   OrigIV,Key6
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d
    aes_encrypt_round   OrigIV,Key7
    eor         vHigh.16b,vHigh.16b,vTmp0.16b
    eor         vLow.16b ,vLow.16b ,vTmp1.16b
    pmull2      vTmp2.1q ,vAadHash.2d,vHashKey0Ext.2d
    aes_encrypt_round   OrigIV,Key8
    pmull       vTmp3.1q ,vAadHash.1d,vHashKey0Ext.1d
    aes_encrypt_round   OrigIV,Key9
    aes_encrypt_round   OrigIV,Key10
    aes_encrypt_round   OrigIV,Key11
    aes_encrypt_round   OrigIV,Key12
    aese        vOrigIV.16b,vKey13.16b
    eor         vMiddle0.16b,vMiddle0.16b,vTmp2.16b
    eor         vOrigIV.16b,vOrigIV.16b,vKey14.16b
    rbit        vAadHash.16b,vOrigIV.16b
    eor         vMiddle0.16b,vMiddle0.16b,vTmp3.16b
    ghash_mult_final_round  AadHash,High,Low,Middle0,Tmp0,Zero,Poly

    rbit        vAadHash.16b,vAadHash.16b                           /* Aad */
    /* output auth_tag */
    cmp         auth_tag_len,16
    bne         1f
    /* most likely auth_tag_len=16 */
    str         qAadHash,[auth_tag]
    pop_stack
    ret
1:  /* auth_tag_len=12 */
    cmp         auth_tag_len,12
    bne         1f
    str         dAadHash,[auth_tag],8
    st1         {vAadHash.s}[2],[auth_tag]
    pop_stack
    ret
1:  /* auth_tag_len=8 */
    str         dAadHash,[auth_tag]
    pop_stack
    ret

10:  /* cbnz         partial_block_len,10f */
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr,(HASHKEY_TOTAL_NUM-3)*32]
    aes_encrypt_round   OrigIV,Key0
    read_small_data_start PartitialBlock,partial_block,partial_block_len,temp0,Tmp0
    pmull2      vHigh.1q,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   OrigIV,Key1
    pmull       vLow.1q ,vAadHash.1d,vHashKey0.1d
    aes_encrypt_round   OrigIV,Key2
    pmull       vMiddle0.1q,vAadHash.1d,vHashKey0Ext.1d
    aes_encrypt_round   OrigIV,Key3
    pmull2      vTmp0.1q   ,vAadHash.2d,vHashKey0Ext.2d
    aes_encrypt_round   OrigIV,Key4
    rbit        vAadHash.16b,vPartitialBlock.16b
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr,(HASHKEY_TOTAL_NUM-2)*32]
    aes_encrypt_round   OrigIV,Key5
    eor         vMiddle0.16b,vMiddle0.16b,vTmp0.16b
    pmull2      vTmp0.1q,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   OrigIV,Key6
    shl         vLen.2d,vLen.2d,3                                   /*  Len  */
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d
    eor         vHigh.16b,vHigh.16b,vTmp0.16b
    aes_encrypt_round   OrigIV,Key7
    eor         vLow.16b,vLow.16b,vTmp1.16b
    pmull2      vTmp0.1q   ,vAadHash.2d,vHashKey0Ext.2d
    rev64       vLen.16b,vLen.16b                                   /*  Len  */
    aes_encrypt_round   OrigIV,Key8
    eor         vMiddle0.16b,vMiddle0.16b,vTmp0.16b
    pmull       vTmp0.1q,vAadHash.1d,vHashKey0Ext.1d
    aes_encrypt_round   OrigIV,Key9
    rbit        vAadHash.16b,vLen.16b                               /*  Len  */
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr,(HASHKEY_TOTAL_NUM-1)*32]
    aes_encrypt_round   OrigIV,Key10
    eor         vMiddle0.16b,vMiddle0.16b,vTmp0.16b
    aes_encrypt_round   OrigIV,Key11
    pmull2      vTmp0.1q ,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   OrigIV,Key12
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d
    aese        vOrigIV.16b,vKey13.16b
    eor         vHigh.16b,vHigh.16b,vTmp0.16b
    eor         vLow.16b ,vLow.16b ,vTmp1.16b
    pmull2      vTmp2.1q ,vAadHash.2d,vHashKey0Ext.2d
    pmull       vTmp3.1q ,vAadHash.1d,vHashKey0Ext.1d
    eor         vMiddle0.16b,vMiddle0.16b,vTmp2.16b
    eor         vOrigIV.16b,vOrigIV.16b,vKey14.16b
    eor         vMiddle0.16b,vMiddle0.16b,vTmp3.16b
    rbit        vAadHash.16b,vOrigIV.16b
    ghash_mult_final_round  AadHash,High,Low,Middle0,Tmp0,Zero,Poly

    rbit        vAadHash.16b,vAadHash.16b                           /* Aad */
    /* output auth_tag */
    cmp         auth_tag_len,16
    bne         1f
    /* most likely auth_tag_len=16 */
    str         qAadHash,[auth_tag]
    pop_stack
    ret
1:  /* auth_tag_len=12 */
    cmp         auth_tag_len,12
    bne         1f
    str         dAadHash,[auth_tag],8
    st1         {vAadHash.s}[2],[auth_tag]
    pop_stack
    ret
1:  /* auth_tag_len=8 */
    str         dAadHash,[auth_tag]
    pop_stack
    ret

END_FUNC(enc,KEY_LEN,_finalize_)
END_FUNC(dec,KEY_LEN,_finalize_)




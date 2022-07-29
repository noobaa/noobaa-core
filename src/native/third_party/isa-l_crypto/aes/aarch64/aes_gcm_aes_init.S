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

#include "gcm_common.S"
/*
void gist_aes_gcm_init_##mode(
    const struct gcm_key_data *key_data,
    struct gcm_context_data *context,
    uint8_t *iv,
    uint8_t const *aad,
    uint64_t aad_len
    );
*/
    key_data        .req    x0
    context         .req    x1
    iv              .req    x2
    aad             .req    x3
    aad_len         .req    x4
    temp0           .req    x7
    wtemp0          .req    w7
    temp1           .req    x6
    left_len        .req    x5
    aad_left        .req    x2
    small_tbl_adr   .req    x6

    hashkey_base    .req    x0
    hashkey_addr    .req    x2

    declare_var_vector_reg  AadHash,0
    declare_var_vector_reg  Dat0,1
    declare_var_vector_reg  HashKey0,2
    declare_var_vector_reg  HashKey0Ext,3
    declare_var_vector_reg  High,4
    declare_var_vector_reg  Middle0,5
    declare_var_vector_reg  Low,6
    declare_var_vector_reg  LeftDat,7
    declare_var_vector_reg  Zero,16
    declare_var_vector_reg  Poly,17

    declare_var_vector_reg  Tmp0,18
    declare_var_vector_reg  Tmp1,19
    declare_var_vector_reg  Ctr,1


START_FUNC(init,128,_)
START_FUNC(init,192,_)
START_FUNC(init,256,_)
    stp             aad_len,xzr,[context,AAD_LEN_OFF]           //save in_length and aad_length
    str             xzr,[context,PARTIAL_BLOCK_LENGTH_OFF]      //clear partial_block_length
    add             hashkey_base,key_data,HASHKEY_BASE_OFF
    /* Init Consts for ghash  */
    movi            vZero.4s,0
    mov             temp0,0x87
    dup             vPoly.2d,temp0
    /* Set orig_IV */
    ldr             wtemp0,[iv,8]
    ldr             temp1,[iv]
    movk            temp0,0x100,lsl 48
    stp             temp1,temp0,[context,ORIG_IV_OFF]
    and             left_len,aad_len,15
    ldp             qHashKey0,qHashKey0Ext,[key_data,(HASHKEY_TOTAL_NUM-1)*32]
    /* Set current_counter, save as cpu order */
    ldr             qCtr,[context,ORIG_IV_OFF]
    rev32           vCtr.16b,vCtr.16b
    str             qCtr,[context,CTR_OFF]
    cbz             aad_len,init_zero_exit
    lsr             aad_len,aad_len,4
    /* Read small data */
    cbz             left_len,2f
    add             aad_left,aad,aad_len,lsl 4
    read_small_data_start   LeftDat,aad_left,left_len,small_tbl_adr,Tmp0
    cbz             aad_len,24f     //  aad_len less than 16
2:
    cbnz            left_len,1f
    /*left_len == 0 && aad_len !=0 */

    sub             aad_len,aad_len,1
    /*  leftDat = aad[-1] */
    ldr             qLeftDat,[aad,aad_len,lsl 4]
    cbz             aad_len,24f         /* aad_len == 16 */
1:
    /* aad_len > 16 */
    ldr             qAadHash,[aad],16
    rbit            vAadHash.16b,vAadHash.16b
    sub             aad_len,aad_len,1
1:
    /* loop ghash_block */
    cmp             aad_len,HASHKEY_TOTAL_NUM - 1
    bls             1f /* break loop */
    sub             aad_len,aad_len,HASHKEY_TOTAL_NUM
    ghash_block_n   HASHKEY_TOTAL_NUM,AadHash,Dat0,aad,hashkey_addr,hashkey_base,    \
        HashKey0,HashKey0Ext,High,Low,Middle0,Zero,Poly ,      \
        Tmp0,Tmp1
    b               1b /* back to loop start */
1:
    cbz             aad_len,23f     /* left aad_len == 0 */
    mov             temp0,HASHKEY_TOTAL_NUM - 1
    sub             temp0,temp0,aad_len
    add             hashkey_addr,hashkey_base,temp0,lsl 5
    sub             aad_len,aad_len,1


    ghash_mult_init_round   AadHash,aad,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Middle0,Tmp0,Dat0,2        /* load next hash */
1:
    cbz             aad_len,1f
    ghash_mult_round        AadHash,aad,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Middle0,Tmp0,Tmp1,Dat0, 2

    sub             aad_len,aad_len,1
    b               1b
1:
    ghash_mult_round_noload AadHash,HashKey0,HashKey0Ext,High,Low,Middle0,Tmp0,Tmp1
    rbit                    vAadHash.16b, vLeftDat.16b
    ghash_mult_final_round  AadHash,High,Low,Middle0,Tmp0,Zero,Poly
    str                     qAadHash,[context]
    ret

23:
    ghash_block_reg AadHash,LeftDat,               \
        HashKey0,HashKey0Ext,High,Low,Middle0,Zero,Poly ,       \
        Tmp0
    str             qAadHash,[context]
    ret
24: /* less or equal than 16 */
    rbit            vLeftDat.16b, vLeftDat.16b
    str             qLeftDat,[context]
    ret
init_zero_exit:
    stp             xzr,xzr,[context]
    ret
END_FUNC(init,128,_)
END_FUNC(init,192,_)
END_FUNC(init,256,_)


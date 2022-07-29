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
/*
void gist_aes_gcm_dec_update_##mode(                                \
    const struct gcm_key_data *key_data,                            \
    struct gcm_context_data *context,                               \
    uint8_t *out,                                                   \
    const uint8_t *in,                                              \
    uint64_t len                                                    \
    )
 */

    declare_var_generic_reg key_data    ,0
    declare_var_generic_reg context     ,1
    declare_var_generic_reg out         ,2
    declare_var_generic_reg in          ,3
    declare_var_generic_reg len         ,4
    declare_var_generic_reg partial_block_length,5
    declare_var_generic_reg blocks      ,5
    declare_var_generic_reg hashkey_base,0
    declare_var_generic_reg hashkey_addr,6
    declare_var_generic_reg temp0       ,14
    declare_var_generic_reg temp1       ,15
    declare_var_generic_reg temp2       ,13



    declare_var_vector_reg  Ctr,0
    declare_var_vector_reg  AadHash,1
    declare_var_vector_reg  HashKey0,2
    declare_var_vector_reg  HashKey0Ext,3
    declare_var_vector_reg  High,4
    declare_var_vector_reg  Low,5
    declare_var_vector_reg  EncCtr,6
    declare_var_vector_reg  Middle,7

    declare_var_vector_reg  Tmp0,8
    declare_var_vector_reg  Tmp1,9
    declare_var_vector_reg  Zero,10
    declare_var_vector_reg  Poly,11
    declare_var_vector_reg  PartialBlock ,12
    declare_var_vector_reg  One,31
    .set        stack_size,48
    .macro  push_stack
        stp     d8, d9, [sp,-stack_size]!
        stp     d10,d11,[sp,16]
        stp     d12,d13,[sp,32]

    .endm

    .macro  pop_stack
        ldp     d10,d11,[sp,16]
        ldp     d12,d13,[sp,32]
        ldp     d8, d9, [sp], stack_size
    .endm
/*
    20:exit_without_popstack
    21:start_of_mainloop
    22:exit_with_popstack
    23:partial_block_start
 */
START_FUNC(enc,KEY_LEN,_update_)
START_FUNC(enc,KEY_LEN,_update_nt_)
    ldr             temp0,[context,IN_LENGTH_OFF]             /*load in_length */
    ldr             partial_block_length,[context,PARTIAL_BLOCK_LENGTH_OFF]
    ldr             qAadHash,[context]
    cbz             len,20f /** if(len==0)return; exit_without_popstack*/
    push_stack
    add             temp0,temp0,len                           /* temp0=temp0+len */
    load_aes_keys   key_data
    str             temp0,[context,IN_LENGTH_OFF]             /* save in_length */
    /* Init Consts and IV */
    ldr             qCtr,[context,CTR_OFF]
    mov             wtemp1,1
    eor             vOne.16b,vOne.16b,vOne.16b
    mov             temp0,0x87
    eor             vZero.16b,vZero.16b,vZero.16b
    ins             vOne.s[3],wtemp1
    dup             vPoly.2d,temp0
    cbnz            partial_block_length,23f                  /* if(partial_block_length!=0) not normal case*/
21: /* start_of_mainloop */
    cbz             len,24f
    lsr             blocks,len,4
    cmp             blocks,HASHKEY_TOTAL_NUM - 1
    and             len,len,0xf
    /* loop aes gcm enc/dec loop */
    bls             2f /* skip loop */
1:
    sub             blocks,blocks,HASHKEY_TOTAL_NUM
    cmp             blocks,HASHKEY_TOTAL_NUM - 1
    aes_gcm_n_round   encrypt,HASHKEY_TOTAL_NUM,AadHash,in,hashkey_addr,hashkey_base,    \
        HashKey0,HashKey0Ext,High,Low,Poly,      \
        Ctr,EncCtr,One,out,Tmp0,Tmp1
    bhi             1b /* back to loop start */
2:
    cbz             blocks,4f     // left blocks == 0
    /* -(blocks - HASHKEY_TOTAL_NUM) */
    sub             temp0,blocks,HASHKEY_TOTAL_NUM
    neg             temp0,temp0
    sub             blocks,blocks,1
    add             hashkey_addr,hashkey_base,temp0,lsl 5

    aes_gcm_init    encrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    cbz             blocks,3f   /* origin_blocks == 1 */
    sub             blocks,blocks,1

    cbz             blocks,2f   /* origin_blocks == 2 */
1:
    sub             blocks,blocks,1
    aes_gcm_middle  encrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    cbnz            blocks,1b
2:
    aes_gcm_middle  encrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,1        /* not load next hash */
3:
    poly_mult_final_x2  AadHash,High,Low,Tmp0,Tmp1,Poly
4:
    str                 qAadHash,[context]
    str                 qCtr,[context,CTR_OFF]
    cbnz                len,24f
22: /* exit_with_popstack */
    pop_stack
20: /* exit_without_popstack */
    ret
23: /* partial_block_start */

    generic_partial_block_start    encrypt,len,in,out,context, \
        temp2,partial_block_length,temp0,temp1,hashkey_addr
    cbnz        partial_block_length,22b
    ldr         qHashKey0Ext,[hashkey_base,(HASHKEY_TOTAL_NUM-1)*32+16]
    ldr         qHashKey0   ,[hashkey_base,(HASHKEY_TOTAL_NUM-1)*32]
    ldr         qPartialBlock,[context,PARTIAL_BLOCK_ENC_KEY_OFF]
    ghash_block_reg AadHash,PartialBlock,HashKey0,HashKey0Ext, \
        High,Low,Middle,Zero,Poly,Tmp0
    str                 qAadHash,[context]
    cbz         len,4b
    cmp         len,15
    bhi         21b
24: /*partial_block_end */
    add         vCtr.4s,vCtr.4s,vOne.4s
    read_small_data_start   PartialBlock,in,len,temp0,Tmp0
    rev32       vEncCtr.16b,vCtr.16b
    str         qCtr,[context,CTR_OFF]
    aes_encrypt_block   EncCtr
    eor     vPartialBlock.16b,vPartialBlock.16b,vEncCtr.16b
    str     qPartialBlock,[context,PARTIAL_BLOCK_ENC_KEY_OFF]
    write_small_data_start  PartialBlock,out,len,temp0,Tmp0
    str                     len,[context,PARTIAL_BLOCK_LENGTH_OFF]
    pop_stack
    ret

END_FUNC(enc,KEY_LEN,_update_)
END_FUNC(enc,KEY_LEN,_update_nt_)


START_FUNC(dec,KEY_LEN,_update_)
START_FUNC(dec,KEY_LEN,_update_nt_)
    ldr             temp0,[context,IN_LENGTH_OFF]             /*load in_length */
    ldr             partial_block_length,[context,PARTIAL_BLOCK_LENGTH_OFF]
    ldr             qAadHash,[context]
    cbz             len,20f /** if(len==0)return; exit_without_popstack*/
    push_stack
    add             temp0,temp0,len                           /* temp0=temp0+len */
    load_aes_keys   key_data
    str             temp0,[context,IN_LENGTH_OFF]             /* save in_length */
    /* Init Consts and IV */
    ldr             qCtr,[context,CTR_OFF]
    mov             wtemp1,1
    eor             vOne.16b,vOne.16b,vOne.16b
    mov             temp0,0x87
    eor             vZero.16b,vZero.16b,vZero.16b
    ins             vOne.s[3],wtemp1
    dup             vPoly.2d,temp0
    cbnz            partial_block_length,23f                  /* if(partial_block_length!=0) not normal case*/
21: /* start_of_mainloop */
    cbz             len,24f
    lsr             blocks,len,4
    cmp             blocks,HASHKEY_TOTAL_NUM - 1
    and             len,len,0xf
    /** loop aes gcm enc/dec loop */
    bls             2f /* skip loop */
1:
    sub             blocks,blocks,HASHKEY_TOTAL_NUM
    cmp             blocks,HASHKEY_TOTAL_NUM - 1
    aes_gcm_n_round   decrypt,HASHKEY_TOTAL_NUM,AadHash,in,hashkey_addr,hashkey_base,    \
        HashKey0,HashKey0Ext,High,Low,Poly,      \
        Ctr,EncCtr,One,out,Tmp0,Tmp1
    bhi             1b /* back to loop start */
2:
    cbz             blocks,4f     /* left blocks == 0 */
    /* -(blocks - HASHKEY_TOTAL_NUM) */
    sub             temp0,blocks,HASHKEY_TOTAL_NUM
    neg             temp0,temp0
    sub             blocks,blocks,1
    add             hashkey_addr,hashkey_base,temp0,lsl 5

    aes_gcm_init    decrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        // load next hash
    cbz             blocks,3f   /* origin_blocks == 1 */
    sub             blocks,blocks,1

    cbz             blocks,2f   /* origin_blocks == 2 */
1:
    sub             blocks,blocks,1
    aes_gcm_middle  decrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    cbnz            blocks,1b
2:
    aes_gcm_middle  decrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,1        /* not load next hash */
3:
    poly_mult_final_x2  AadHash,High,Low,Tmp0,Tmp1,Poly
4:
    str                 qAadHash,[context]
    str                 qCtr,[context,CTR_OFF]
    cbnz                len,24f
22: /* exit_with_popstack */
    pop_stack
20: /* exit_without_popstack */
    ret
23: /* partial_block_start */

    generic_partial_block_start    decrypt,len,in,out,context, \
        temp2,partial_block_length,temp0,temp1,hashkey_addr
    cbnz        partial_block_length,22b
    ldr         qHashKey0Ext,[hashkey_base,(HASHKEY_TOTAL_NUM-1)*32+16]
    ldr         qHashKey0   ,[hashkey_base,(HASHKEY_TOTAL_NUM-1)*32]
    ldr         qPartialBlock,[context,PARTIAL_BLOCK_ENC_KEY_OFF]
    ghash_block_reg AadHash,PartialBlock,HashKey0,HashKey0Ext, \
        High,Low,Middle,Zero,Poly,Tmp0
    str                 qAadHash,[context]
    cbz         len,4b
    cmp         len,15
    bhi         21b
24: /* partial_block_end */
    add         vCtr.4s,vCtr.4s,vOne.4s
    read_small_data_start   PartialBlock,in,len,temp0,Tmp0
    rev32       vEncCtr.16b,vCtr.16b
    str         qCtr,[context,CTR_OFF]
    aes_encrypt_block   EncCtr
    eor     vEncCtr.16b,vPartialBlock.16b,vEncCtr.16b
    tbx_small_data_start    EncCtr,PartialBlock,len,temp0,Tmp0
    write_small_data_start  EncCtr,out,len,temp0,Tmp0
    str                     qPartialBlock,[context,PARTIAL_BLOCK_ENC_KEY_OFF]
    str                     len,[context,PARTIAL_BLOCK_LENGTH_OFF]
    pop_stack
    ret
END_FUNC(dec,KEY_LEN,_update_)
END_FUNC(dec,KEY_LEN,_update_nt_)

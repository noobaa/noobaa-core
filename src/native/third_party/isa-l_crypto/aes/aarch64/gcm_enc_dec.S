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
void gist_aes_gcm_dec_##mode(                                       \
    const struct gcm_key_data *key_data,                            \
    struct gcm_context_data *context,                               \
    uint8_t *out,                                                   \
    uint8_t const *in,                                              \
    uint64_t len,                                                   \
    uint8_t *iv,                                                    \
                                                                    \
    uint8_t const *aad,                                             \
    uint64_t aad_len,                                               \
    uint8_t *auth_tag,                                              \
    uint64_t auth_tag_len                                           \
                                                                    \
    )
 */

    declare_var_generic_reg key_data    ,0
    declare_var_generic_reg context     ,1
    declare_var_generic_reg out         ,2
    declare_var_generic_reg in          ,3
    declare_var_generic_reg len         ,4
    declare_var_generic_reg iv          ,5
    declare_var_generic_reg aad         ,6
    declare_var_generic_reg aad_len     ,7

    declare_var_generic_reg hashkey_base,0
    declare_var_generic_reg hashkey_addr,5
    declare_var_generic_reg left_len    ,12
    declare_var_generic_reg aad_left    ,13
    declare_var_generic_reg temp0       ,14
    declare_var_generic_reg temp1       ,15

    declare_var_generic_reg auth_tag    ,0 /* input param */
    declare_var_generic_reg auth_tag_len,1 /* input param */


    declare_var_vector_reg  Ctr,0
    declare_var_vector_reg  AadHash,1
    declare_var_vector_reg  HashKey0,2
    declare_var_vector_reg  HashKey0Ext,3
    declare_var_vector_reg  High,4
    declare_var_vector_reg  Low,5
    declare_var_vector_reg  EncCtr,6
    declare_var_vector_reg  Dat0,6
    declare_var_vector_reg  Middle0,7

    declare_var_vector_reg  Tmp0,8
    declare_var_vector_reg  Tmp1,9
    declare_var_vector_reg  Zero,10
    declare_var_vector_reg  Poly,11
    declare_var_vector_reg  LeftDat ,12
    declare_var_vector_reg  Len     ,13
    declare_var_vector_reg  Tmp2,14
    declare_var_vector_reg  Tmp3,15

    declare_var_vector_reg  One,31
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

START_FUNC(enc,KEY_LEN,_)
START_FUNC(enc,KEY_LEN,_nt_)
    push_stack
    /*save in_length and aad_length*/
    stp             aad_len,len,[context,AAD_LEN_OFF]
    load_aes_keys   key_data
    /* Init Consts and IV */
    mov             wtemp1,1
    eor             vOne.16b,vOne.16b,vOne.16b
    ld1             {vCtr.d}[0],[iv],8
    eor             vZero.16b,vZero.16b,vZero.16b
    ld1             {vCtr.s}[2],[iv]
    mov             temp0,0x87
    rev32           vCtr.16b,vCtr.16b /* to cpu order */
    ins             vOne.s[3],wtemp1
    mov             vAadHash.16b,vZero.16b
    dup             vPoly.2d,temp0
    ins             vCtr.s[3],wtemp1  /* Initial Ctr and Orig IV */


    and             left_len,aad_len,0xf
    cbz             aad_len,24f
    lsr             aad_len,aad_len,4
    /* Read small data */
    cbz             left_len,2f     /* aad_len >= 16,skip */
    add             aad_left,aad,aad_len,lsl 4
    read_small_data_start   LeftDat,aad_left,left_len,temp0,Tmp0
    cbnz            left_len,1f     /* aad_len & 0xf != 0 */
2:
    cbz             aad_len,1f      /* aad_len <16 skip*/
    /* left_len == 0 && aad_len !=0 */
    sub             aad_len,aad_len,1
    /*  leftDat = aad[-1] */
    ldr             qLeftDat,[aad,aad_len,lsl 4]
1:
    cbnz            aad_len,1f         /* aad_len >16,skip */
    rbit            vAadHash.16b,vLeftDat.16b
    b               24f                 /* aad_len <=16, skip aadhash caculate */
1:
    /* aad_len > 16 */
    ldr             qAadHash,[aad],16
    rbit            vAadHash.16b,vAadHash.16b
    sub             aad_len,aad_len,1

1:
    /* loop ghash_block */
    cmp             aad_len,HASHKEY_TOTAL_NUM - 1
    bls             1f // break loop
    sub             aad_len,aad_len,HASHKEY_TOTAL_NUM
    ghash_block_n   HASHKEY_TOTAL_NUM,AadHash,Dat0,aad,hashkey_addr,hashkey_base,   \
        HashKey0,HashKey0Ext,High,Low,Middle0,Zero,Poly ,                           \
        Tmp0,Tmp1
    b               1b /* back to loop start */
1:
    cbnz            aad_len,1f          /* left aad_len >32,skip */
    ldp             qHashKey0,qHashKey0Ext,[hashkey_base,(HASHKEY_TOTAL_NUM-1)*32]
    ghash_block_reg AadHash,LeftDat,                            \
        HashKey0,HashKey0Ext,High,Low,Middle0,Zero,Poly ,       \
        Tmp0
    b               24f                 /* left aad_len <=32,skip below check */
1:
    mov             temp0,HASHKEY_TOTAL_NUM - 1
    sub             temp0,temp0,aad_len
    add             hashkey_addr,hashkey_base,temp0,lsl 5

    ghash_mult_init_round   AadHash,aad,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Middle0,Tmp0,Dat0,2        /* load next hash */
    sub             aad_len,aad_len,1

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

24:

    /* Enc/Dec loop */
    and             left_len,len,15
    cbz             len,24f
    lsr             len,len,4
1:
    /* loop aes gcm enc/dec loop */
    cmp             len,HASHKEY_TOTAL_NUM - 1
    bls             1f // break loop
    sub             len,len,HASHKEY_TOTAL_NUM
    aes_gcm_n_round   encrypt,HASHKEY_TOTAL_NUM,AadHash,in,hashkey_addr,hashkey_base,    \
        HashKey0,HashKey0Ext,High,Low,Poly,      \
        Ctr,EncCtr,One,out,Tmp0,Tmp1
    b               1b /* back to loop start */
1:
    cbz             len,24f     /* left len == 0 */
    mov             temp0,HASHKEY_TOTAL_NUM
    sub             temp0,temp0,len
    add             hashkey_addr,hashkey_base,temp0,lsl 5

    sub             len,len,1
    aes_gcm_init    encrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    cbz             len,2f
    sub             len,len,1
1:

    cbz             len,1f
    aes_gcm_middle  encrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    sub             len,len,1
    b               1b
1:
    aes_gcm_middle  encrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,1        /* load next hash */
2:
    poly_mult_final_x2  AadHash,High,Low,Tmp0,Tmp1,Poly
24:
    /* complete part */
    cmp         left_len,0
    movi        vHigh.16b,0
    mov         temp0,HASHKEY_TOTAL_NUM-3
    movi        vLow.16b,0
    cinc        hashkey_addr,temp0,eq
    movi        vMiddle0.16b,0
    add         hashkey_addr,hashkey_base,hashkey_addr,lsl 5
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr],32
    beq         2f
    read_small_data_start LeftDat,in,left_len,temp0,Tmp0
    add         vCtr.4s,vCtr.4s,vOne.4s
    rev32       vEncCtr.16b,vCtr.16b
    aes_encrypt_round   EncCtr,Key0
    pmull2      vHigh.1q,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   EncCtr,Key1
    pmull       vLow.1q ,vAadHash.1d,vHashKey0.1d
    aes_encrypt_round   EncCtr,Key2
    ldr         qHashKey0,[hashkey_addr],16
    aes_encrypt_round   EncCtr,Key3
    pmull       vMiddle0.1q,vAadHash.1d,vHashKey0Ext.1d
    aes_encrypt_round   EncCtr,Key4
    pmull2      vTmp0.1q   ,vAadHash.2d,vHashKey0Ext.2d
    aes_encrypt_round   EncCtr,Key5
    ldr         qHashKey0Ext,[hashkey_addr],16
    aes_encrypt_round   EncCtr,Key6
    eor         vMiddle0.16b,vMiddle0.16b,vTmp0.16b
    aes_encrypt_round   EncCtr,Key7
    aes_encrypt_round   EncCtr,Key8
#if KEY_LEN==256
    aes_encrypt_round   EncCtr,Key9
    aes_encrypt_round   EncCtr,Key10
    aes_encrypt_round   EncCtr,Key11
    aes_encrypt_round   EncCtr,Key12
    aese    vEncCtr.16b,vKey13.16b
    eor     vEncCtr.16b,vEncCtr.16b,vKey14.16b
#else
    aese    vEncCtr.16b,vKey9.16b
    eor     vEncCtr.16b,vEncCtr.16b,vKey10.16b
#endif
    eor     vEncCtr.16b,vEncCtr.16b,vLeftDat.16b
    write_small_data_start  EncCtr,out,left_len,temp0,Tmp0
    clear_small_data        EncCtr,Zero,left_len,temp0,Tmp0
    rbit    vAadHash.16b,vEncCtr.16b
2:

    ldr         qLen,[context,AAD_LEN_OFF]                          /*  Len  */
    mov         wtemp0,1                                            /*  Ek */
    pmull2      vTmp0.1q ,vAadHash.2d,vHashKey0.2d                  /* auth_dat * HashKey[Total-2] */
    shl         vLen.2d,vLen.2d,3                                   /*  Len  */
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d                  /* auth_dat * HashKey[Total-2] */
    rev64       vLen.16b,vLen.16b                                   /*  Len  */
    ins         vCtr.4s[3],wtemp0                                   /*  Ek */
    ldr         qHashKey0,[hashkey_addr],16                         /* auth_dat * HashKey[Total-2] */
    pmull       vTmp2.1q,vAadHash.1d,vHashKey0Ext.1d                /* auth_dat * HashKey[Total-2] */
    rev32       vEncCtr.16b,vCtr.16b                                /*  Ek */
    eor         vHigh.16b,vHigh.16b,vTmp0.16b                       /* auth_dat * HashKey[Total-2] */
    pmull2      vTmp3.1q   ,vAadHash.2d,vHashKey0Ext.2d             /* auth_dat * HashKey[Total-2] */
    rbit        vAadHash.16b,vLen.16b                               /*  Len  */

    aes_encrypt_round       EncCtr,Key0                             /*  Ek */
    eor         vLow.16b,vLow.16b,vTmp1.16b                         /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key1                             /*  Ek */
    ldr         qHashKey0Ext,[hashkey_addr],16                      /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key2                             /*  Ek */
    eor         vMiddle0.16b,vMiddle0.16b,vTmp2.16b                 /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key3                             /*  Ek */
    eor         vMiddle0.16b,vMiddle0.16b,vTmp3.16b                 /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key4                             /*  Ek */

    pmull2      vTmp0.1q,vAadHash.2d,vHashKey0.2d                   /* Len * HashKey[Total-1] */
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d                  /* Len * HashKey[Total-1] */
    aes_encrypt_round       EncCtr,Key5                             /*  Ek */
    aes_encrypt_round       EncCtr,Key6                             /*  Ek */
    pmull       vTmp2.1q,vAadHash.1d,vHashKey0Ext.1d                /* Len * HashKey[Total-1] */
    aes_encrypt_round       EncCtr,Key7                             /*  Ek */
    eor         vHigh.16b,vHigh.16b,vTmp0.16b                       /* Len * HashKey[Total-1] */
    pmull2      vTmp3.1q   ,vAadHash.2d,vHashKey0Ext.2d             /* Len * HashKey[Total-1] */
    aes_encrypt_round       EncCtr,Key8                             /*  Ek */
    eor         vLow.16b,vLow.16b,vTmp1.16b                         /* Len * HashKey[Total-1] */
#if KEY_LEN==256
    aes_encrypt_round       EncCtr,Key9                             /*  Ek */
    aes_encrypt_round       EncCtr,Key10                            /*  Ek */
    aes_encrypt_round       EncCtr,Key11                            /*  Ek */
    aes_encrypt_round       EncCtr,Key12                            /*  Ek */
    aese        vEncCtr.16b,vKey13.16b                              /*  Ek */
    eor         vEncCtr.16b,vEncCtr.16b,vKey14.16b                  /*  Ek */
#else
    aese        vEncCtr.16b,vKey9.16b                               /*  Ek */
    eor         vEncCtr.16b,vEncCtr.16b,vKey10.16b                  /*  Ek */
#endif
    eor         vMiddle0.16b,vMiddle0.16b,vTmp2.16b                 /* Len * HashKey[Total-1] */
    eor         vMiddle0.16b,vMiddle0.16b,vTmp3.16b                 /* Len * HashKey[Total-1] */
    rbit        vAadHash.16b,vEncCtr.16b                            /* Aad */

    ghash_mult_final_round  AadHash,High,Low,Middle0,Tmp0,Zero,Poly

    ldp         auth_tag,auth_tag_len,[sp,stack_size]               /* Adjust here : TODO TBD */
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
END_FUNC(enc,KEY_LEN,_)
END_FUNC(enc,KEY_LEN,_nt_)


START_FUNC(dec,KEY_LEN,_)
START_FUNC(dec,KEY_LEN,_nt_)
    push_stack
    /* save in_length and aad_length */
    stp             aad_len,len,[context,AAD_LEN_OFF]
    load_aes_keys   key_data
    /* Init Consts and IV */
    mov             wtemp1,1
    eor             vOne.16b,vOne.16b,vOne.16b
    ld1             {vCtr.d}[0],[iv],8
    eor             vZero.16b,vZero.16b,vZero.16b
    ld1             {vCtr.s}[2],[iv]
    mov             temp0,0x87
    rev32           vCtr.16b,vCtr.16b /* to cpu order */
    mov             vAadHash.16b,vZero.16b
    ins             vOne.s[3],wtemp1
    dup             vPoly.2d,temp0
    ins             vCtr.s[3],wtemp1  /* Initial Ctr and Orig IV */

    ldp             qHashKey0,qHashKey0Ext,[hashkey_base]
    and             left_len,aad_len,0xf
    cbz             aad_len,24f
    lsr             aad_len,aad_len,4
    /* Read small data */
    cbz             left_len,2f     /* aad_len >= 16,skip */
    add             aad_left,aad,aad_len,lsl 4
    read_small_data_start   LeftDat,aad_left,left_len,temp0,Tmp0
    cbnz            left_len,1f     /* aad_len & 0xf != 0 */
2:
    cbz             aad_len,1f      /* aad_len <16 skip */
    /* left_len == 0 && aad_len !=0 */
    sub             aad_len,aad_len,1
    /*  leftDat = aad[-1] */
    ldr             qLeftDat,[aad,aad_len,lsl 4]
1:
    cbnz            aad_len,1f         /* aad_len >16,skip */
    rbit            vAadHash.16b,vLeftDat.16b
    b               24f                 /* aad_len <=16, skip aadhash caculate */
1:
    /* aad_len > 16 */
    ldr             qAadHash,[aad],16
    rbit            vAadHash.16b,vAadHash.16b
    sub             aad_len,aad_len,1

1:
    /** loop ghash_block */
    cmp             aad_len,HASHKEY_TOTAL_NUM - 1
    bls             1f /* break loop */
    sub             aad_len,aad_len,HASHKEY_TOTAL_NUM
    ghash_block_n   HASHKEY_TOTAL_NUM,AadHash,Dat0,aad,hashkey_addr,hashkey_base,    \
        HashKey0,HashKey0Ext,High,Low,Middle0,Zero,Poly ,      \
        Tmp0,Tmp1
    b               1b /* back to loop start */
1:
    cbnz            aad_len,1f          /* left aad_len >32,skip */
    ldp             qHashKey0,qHashKey0Ext,[hashkey_base,(HASHKEY_TOTAL_NUM-1)*32]
    ghash_block_reg AadHash,LeftDat,                            \
        HashKey0,HashKey0Ext,High,Low,Middle0,Zero,Poly ,       \
        Tmp0
    b               24f                 /* left aad_len <=32,skip below check */
1:
    mov             temp0,HASHKEY_TOTAL_NUM - 1
    sub             temp0,temp0,aad_len
    add             hashkey_addr,hashkey_base,temp0,lsl 5

    ghash_mult_init_round   AadHash,aad,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Middle0,Tmp0,Dat0,2        /* load next hash */
    sub             aad_len,aad_len,1

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

24:


    /* Enc/Dec loop */
    and             left_len,len,15
    cbz             len,24f
    lsr             len,len,4
1:
    /* loop aes gcm enc/dec loop */
    cmp             len,HASHKEY_TOTAL_NUM - 1
    bls             1f // break loop
    sub             len,len,HASHKEY_TOTAL_NUM
    aes_gcm_n_round   decrypt,HASHKEY_TOTAL_NUM,AadHash,in,hashkey_addr,hashkey_base,    \
        HashKey0,HashKey0Ext,High,Low,Poly,      \
        Ctr,EncCtr,One,out,Tmp0,Tmp1
    b               1b /* back to loop start */
1:
    cbz             len,24f     /* left len == 0 */
    mov             temp0,HASHKEY_TOTAL_NUM
    sub             temp0,temp0,len
    add             hashkey_addr,hashkey_base,temp0,lsl 5

    sub             len,len,1
    aes_gcm_init    decrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext,  \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    cbz             len,2f
    sub             len,len,1
1:

    cbz             len,1f
    aes_gcm_middle  decrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,2        /* load next hash */
    sub             len,len,1
    b               1b
1:
    aes_gcm_middle  decrypt,AadHash,in,hashkey_addr,HashKey0,HashKey0Ext, \
        High,Low,Ctr,EncCtr,One,out,Tmp0,Tmp1,1        /* load next hash */
2:
    poly_mult_final_x2  AadHash,High,Low,Tmp0,Tmp1,Poly
24:
    /* complete part */
    cmp         left_len,0
    movi        vHigh.16b,0
    mov         temp0,21
    movi        vLow.16b,0
    cinc       hashkey_addr,temp0,eq
    movi        vMiddle0.16b,0
    add         hashkey_addr,hashkey_base,hashkey_addr,lsl 5
    ldp         qHashKey0,qHashKey0Ext,[hashkey_addr],32
    beq         2f
    read_small_data_start LeftDat,in,left_len,temp0,Tmp0
    add         vCtr.4s,vCtr.4s,vOne.4s
    rev32       vEncCtr.16b,vCtr.16b
    aes_encrypt_round   EncCtr,Key0
    pmull2      vHigh.1q,vAadHash.2d,vHashKey0.2d
    aes_encrypt_round   EncCtr,Key1
    pmull       vLow.1q ,vAadHash.1d,vHashKey0.1d
    aes_encrypt_round   EncCtr,Key2
    ldr         qHashKey0,[hashkey_addr],16
    aes_encrypt_round   EncCtr,Key3
    pmull       vMiddle0.1q,vAadHash.1d,vHashKey0Ext.1d
    aes_encrypt_round   EncCtr,Key4
    pmull2      vTmp0.1q   ,vAadHash.2d,vHashKey0Ext.2d
    aes_encrypt_round   EncCtr,Key5
    ldr         qHashKey0Ext,[hashkey_addr],16
    aes_encrypt_round   EncCtr,Key6
    eor         vMiddle0.16b,vMiddle0.16b,vTmp0.16b
    aes_encrypt_round   EncCtr,Key7
    aes_encrypt_round   EncCtr,Key8
#if KEY_LEN==256
    aes_encrypt_round   EncCtr,Key9
    aes_encrypt_round   EncCtr,Key10
    aes_encrypt_round   EncCtr,Key11
    aes_encrypt_round   EncCtr,Key12
    aese    vEncCtr.16b,vKey13.16b
    eor     vEncCtr.16b,vEncCtr.16b,vKey14.16b
    eor     vEncCtr.16b,vEncCtr.16b,vLeftDat.16b
#endif
#if KEY_LEN==128
    aese    vEncCtr.16b,vKey9.16b
    eor     vEncCtr.16b,vEncCtr.16b,vKey10.16b
    eor     vEncCtr.16b,vEncCtr.16b,vLeftDat.16b
#endif
    write_small_data_start  EncCtr,out,left_len,temp0,Tmp0
    rbit    vAadHash.16b,vLeftDat.16b

2:

    ldr         qLen,[context,AAD_LEN_OFF]                          /*  Len  */
    mov         wtemp0,1                                            /*  Ek */
    pmull2      vTmp0.1q ,vAadHash.2d,vHashKey0.2d                  /* auth_dat * HashKey[Total-2] */
    shl         vLen.2d,vLen.2d,3                                   /*  Len  */
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d                  /* auth_dat * HashKey[Total-2] */
    rev64       vLen.16b,vLen.16b                                   /*  Len  */
    ins         vCtr.4s[3],wtemp0                                   /*  Ek */
    ldr         qHashKey0,[hashkey_addr],16                         /* auth_dat * HashKey[Total-2] */
    pmull       vTmp2.1q,vAadHash.1d,vHashKey0Ext.1d                /* auth_dat * HashKey[Total-2] */
    rev32       vEncCtr.16b,vCtr.16b                                /*  Ek */
    eor         vHigh.16b,vHigh.16b,vTmp0.16b                       /* auth_dat * HashKey[Total-2] */
    pmull2      vTmp3.1q   ,vAadHash.2d,vHashKey0Ext.2d             /* auth_dat * HashKey[Total-2] */
    rbit        vAadHash.16b,vLen.16b                               /*  Len  */

    aes_encrypt_round       EncCtr,Key0                             /*  Ek */
    eor         vLow.16b,vLow.16b,vTmp1.16b                         /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key1                             /*  Ek */
    ldr         qHashKey0Ext,[hashkey_addr],16                      /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key2                             /*  Ek */
    eor         vMiddle0.16b,vMiddle0.16b,vTmp2.16b                 /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key3                             /*  Ek */
    eor         vMiddle0.16b,vMiddle0.16b,vTmp3.16b                 /* auth_dat * HashKey[Total-2] */
    aes_encrypt_round       EncCtr,Key4                             /*  Ek */

    pmull2      vTmp0.1q,vAadHash.2d,vHashKey0.2d                   /* Len * HashKey[Total-1] */
    pmull       vTmp1.1q ,vAadHash.1d,vHashKey0.1d                  /* Len * HashKey[Total-1] */
    aes_encrypt_round       EncCtr,Key5                             /*  Ek */
    aes_encrypt_round       EncCtr,Key6                             /*  Ek */
    pmull       vTmp2.1q,vAadHash.1d,vHashKey0Ext.1d                /* Len * HashKey[Total-1] */
    aes_encrypt_round       EncCtr,Key7                             /*  Ek */
    eor         vHigh.16b,vHigh.16b,vTmp0.16b                       /* Len * HashKey[Total-1] */
    pmull2      vTmp3.1q   ,vAadHash.2d,vHashKey0Ext.2d             /* Len * HashKey[Total-1] */
    aes_encrypt_round       EncCtr,Key8                             /*  Ek */
    eor         vLow.16b,vLow.16b,vTmp1.16b                         /* Len * HashKey[Total-1] */
#if KEY_LEN==256
    aes_encrypt_round       EncCtr,Key9                             /*  Ek */
    aes_encrypt_round       EncCtr,Key10                            /*  Ek */
    aes_encrypt_round       EncCtr,Key11                            /*  Ek */
    aes_encrypt_round       EncCtr,Key12                            /*  Ek */
    aese        vEncCtr.16b,vKey13.16b                              /*  Ek */
    eor         vEncCtr.16b,vEncCtr.16b,vKey14.16b                  /*  Ek */
#else
    aese        vEncCtr.16b,vKey9.16b                               /*  Ek */
    eor         vEncCtr.16b,vEncCtr.16b,vKey10.16b                  /*  Ek */
#endif
    eor         vMiddle0.16b,vMiddle0.16b,vTmp2.16b                 /* Len * HashKey[Total-1] */
    eor         vMiddle0.16b,vMiddle0.16b,vTmp3.16b                 /* Len * HashKey[Total-1] */
    rbit        vAadHash.16b,vEncCtr.16b                            /* Aad */

    ghash_mult_final_round  AadHash,High,Low,Middle0,Tmp0,Zero,Poly

    ldp         auth_tag,auth_tag_len,[sp,stack_size]               /* Adjust here : TODO TBD */
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
END_FUNC(dec,KEY_LEN,_)
END_FUNC(dec,KEY_LEN,_nt_)

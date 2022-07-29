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
#define HASHKEY_TOTAL_NUM       (24)
#define HASHKEY_BASE_OFF        (15*16)
#define HASHKEY_OFF(n)          ((15*16)+n*32)
#define HASHKEY_EXT_OFF(n)      ((15*16)+n*32+16)
#ifndef KEY_LEN
#define KEY_LEN 128
#endif
#ifndef BLOCKS
#define BLOCKS 24
#endif
#define FN_NAME(fn,mode,post) aes_gcm_##fn##_##mode####post##aes
#define START_FUNC(fn,mode,post) .global FN_NAME(fn,mode,post); \
    .type   FN_NAME(fn,mode,post), %function; \
    FN_NAME(fn,mode,post):
#define END_FUNC(fn,mode,post)   .size  FN_NAME(fn,mode,post), .-FN_NAME(fn,mode,post)

#define AAD_LEN_OFF                 16
#define IN_LENGTH_OFF               24
#define PARTIAL_BLOCK_ENC_KEY_OFF   32
#define PARTIAL_BLOCK_LENGTH_OFF    80
#define CTR_OFF                     64
#define ORIG_IV_OFF                 48
/*
    [low,middle,tmp0,high] +=dat0 * [hashkey0,hashkey0_ext]
    ifnb dat1
        dat1=rbit(*dat_adr)
        [hashkey0,hashkey0_ext] = *hashkey_adr
        dat_adr+=16
        hashkey_adr+=32
*/

.macro  ghash_mult_round    aadhash:req,dat_adr:req,hashkey_adr:req,   \
    hashkey0:req,hashkey0_ext:req,high:req,low:req,middle:req,         \
    tmp0:req,tmp1:req,next_dat:req,left_count:req

    ldr      q\next_dat,[\dat_adr],16
    pmull    v\tmp0\().1q,v\aadhash\().1d,v\hashkey0_ext\().1d
    pmull2   v\tmp1\().1q,v\aadhash\().2d,v\hashkey0_ext\().2d
    .if  \left_count > 1
        ldr      q\hashkey0_ext,[\hashkey_adr,16]
    .endif
    eor      v\middle\().16b,v\middle\().16b,v\tmp0\().16b
    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey0\().2d
    eor      v\middle\().16b,v\middle\().16b,v\tmp1\().16b
    pmull    v\tmp1\().1q,v\aadhash\().1d,v\hashkey0\().1d
    .if  \left_count > 1
        ldr      q\hashkey0,[\hashkey_adr],32
    .endif
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b
    rbit     v\aadhash\().16b, v\next_dat\().16b
.endm

.macro  ghash_mult_init_round    aadhash:req,dat_adr:req,hashkey_adr:req,   \
    hashkey0:req,hashkey0_ext:req,                                          \
    high:req,low:req,middle:req,tmp0:req,next_dat:req,left_count:req
    ldp     q\hashkey0,q\hashkey0_ext,[\hashkey_adr],32
    ldr      q\next_dat,[\dat_adr],16
    pmull    v\middle\().1q,v\aadhash\().1d,v\hashkey0_ext\().1d
    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey0_ext\().2d
    .if  \left_count > 1
        ldr      q\hashkey0_ext,[\hashkey_adr,16]
    .endif
    pmull2   v\high\().1q,v\aadhash\().2d,v\hashkey0\().2d
    eor      v\middle\().16b,v\middle\().16b,v\tmp0\().16b

    pmull    v\low\().1q,v\aadhash\().1d,v\hashkey0\().1d
    .if  \left_count > 1
        ldr      q\hashkey0,[\hashkey_adr],32
    .endif
    rbit     v\aadhash\().16b, v\next_dat\().16b
.endm

/* aadhash=reduction(low,middle,high)+dat0 */
.macro  ghash_mult_final_round aadhash:req,     \
    high:req,low:req,middle:req,tmp0:req,       \
    zero:req,poly:req

    ext      v\tmp0\().16b,v\middle\().16b,v\zero\().16b,8      /*high*/
    ext      v\middle\().16b,v\zero\().16b,v\middle\().16b,8    /*low */
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    eor      v\low\().16b,v\low\().16b,v\middle\().16b

    pmull2   v\middle\().1q,v\high\().2d,v\poly\().2d

    ext      v\tmp0\().16b,v\middle\().16b,v\zero\().16b,8      /*high*/
    ext      v\middle\().16b,v\zero\().16b,v\middle\().16b,8    /*low*/
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    eor      v\low\().16b,v\low\().16b,v\middle\().16b
    pmull    v\middle\().1q,v\high\().1d,v\poly\().1d
    eor      v\tmp0\().16b, v\low\().16b, v\middle\().16b
    eor      v\aadhash\().16b, v\aadhash\().16b, v\tmp0\().16b
.endm
.macro  ghash_reset_hashkey_addr    hashkey_addr:req,hashkey_base:req,count:req
    add     \hashkey_addr,\hashkey_base,(24-\count)<<5
.endm


.macro ghash_block_n count:req,aadhash:req, dat:req,dat_addr:req, hashkey_addr:req, hashkey_base:req, \
    hashkey:req,hashkey_ext:req,high:req,low:req,middle:req, zero:req,poly:req, \
    tmp0:req,tmp1:req

    ghash_reset_hashkey_addr    \hashkey_addr,\hashkey_base,\count
    ghash_mult_init_round   \aadhash,\dat_addr,\hashkey_addr,\hashkey,\hashkey_ext, \
        \high,\low,\middle,\tmp0,\dat,\count
    .set left_count,\count - 1
    .rept left_count
        ghash_mult_round        \aadhash,\dat_addr,\hashkey_addr,\hashkey,\hashkey_ext, \
            \high,\low,\middle,\tmp0,\tmp1,\dat, left_count
        .set left_count,left_count - 1

    .endr
    ghash_mult_final_round  \aadhash,\high,\low,\middle,\tmp0,\zero,\poly
.endm

/*
    aadhash=aadhash*[hashkey,hashkey_ext] + rbit(dat)
*/
.macro ghash_block_reg aadhash:req, dat:req, \
    hashkey:req,hashkey_ext:req,high:req,low:req,middle:req, zero:req,poly:req, \
    tmp0:req
    pmull    v\middle\().1q,v\aadhash\().1d,v\hashkey_ext\().1d
    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey_ext\().2d
    pmull2   v\high\().1q,v\aadhash\().2d,v\hashkey\().2d
    eor      v\middle\().16b,v\middle\().16b,v\tmp0\().16b
    pmull    v\low\().1q,v\aadhash\().1d,v\hashkey\().1d
    rbit     v\aadhash\().16b, v\dat\().16b
    ghash_mult_final_round  \aadhash,\high,\low,\middle,\tmp0,\zero,\poly
.endm

.macro  ghash_mult_round_noload    aadhash:req,   \
    hashkey0:req,hashkey0_ext:req,high:req,low:req,middle:req,         \
    tmp0:req,tmp1:req

    pmull    v\tmp0\().1q,v\aadhash\().1d,v\hashkey0_ext\().1d
    pmull2   v\tmp1\().1q,v\aadhash\().2d,v\hashkey0_ext\().2d
    eor      v\middle\().16b,v\middle\().16b,v\tmp0\().16b
    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey0\().2d
    eor      v\middle\().16b,v\middle\().16b,v\tmp1\().16b
    pmull    v\tmp1\().1q,v\aadhash\().1d,v\hashkey0\().1d
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b

.endm

/* aadhash=reduction([low,high],poly)+dat0 */
.macro  poly_mult_final_x2 aadhash:req, \
    high:req,low:req,tmp0:req,tmp1:req,      \
    poly:req
    pmull2   v\tmp1\().1q,v\high\().2d,v\poly\().2d
    eor      v\low\().16b, v\aadhash\().16b, v\low\().16b
    eor      v\aadhash\().16b,v\aadhash\().16b,v\aadhash\().16b
    ext      v\tmp0\().16b,v\tmp1\().16b,v\aadhash\().16b,8 //high
    ext      v\tmp1\().16b,v\aadhash\().16b,v\tmp1\().16b,8 //low
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b
    pmull    v\tmp1\().1q,v\high\().1d,v\poly\().1d
    eor      v\aadhash\().16b, v\low\().16b, v\tmp1\().16b
.endm

.macro aes_encrypt_round    block,key
    aese    v\block\().16b,v\key\().16b
    aesmc   v\block\().16b,v\block\().16b
.endm

.macro  declare_var_vector_reg name:req,reg:req
    q\name      .req    q\reg
    v\name      .req    v\reg
    s\name      .req    s\reg
    d\name      .req    d\reg
.endm

.macro  declare_var_generic_reg name:req,reg:req
     \name      .req    x\reg
    x\name      .req    x\reg
    w\name      .req    w\reg
.endm

/*Read data less than 16 */
.macro read_small_data  dest:req,src:req,size:req,tbl_adr:req,tbl:req
    ldr     q\tbl,[\tbl_adr,\size,lsl 4]
    tbz     \size,3,1f
    ld1     {v\dest\().d}[0],[\src],8
1:
    tbz     \size,2,1f
    ld1     {v\dest\().s}[2],[\src],4
1:
    tbz     \size,1,1f
    ld1     {v\dest\().h}[6],[\src],2
1:
    tbz     \size,0,1f
    ld1     {v\dest\().b}[14],[\src],1
1:
    tbl     v\dest\().16b,{v\dest\().16b},v\tbl\().16b
.endm
.macro read_small_data_start  dest:req,src:req,size:req,tbl_adr:req,tbl:req
    adrp    \tbl_adr,:got:read_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:read_small_data_table]
    read_small_data \dest,\src,\size,\tbl_adr,\tbl
.endm

.macro read_small_data_end  dest:req,src:req,size:req,tbl_adr:req,tbl:req
    adrp    \tbl_adr,:got:read_end_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:read_end_small_data_table]
    read_small_data \dest,\src,\size,\tbl_adr,\tbl
.endm

.macro write_small_data  src:req,dest:req,size:req,tbl_adr:req,tmp1:req
    ldr     q\tmp1,[\tbl_adr,\size,lsl 4]
    tbl     v\tmp1\().16b,{v\src\().16b},v\tmp1\().16b
    tbz     \size,3,1f
    st1     {v\tmp1\().d}[0],[\dest],8
1:
    tbz     \size,2,1f
    st1     {v\tmp1\().s}[2],[\dest],4
1:
    tbz     \size,1,1f
    st1     {v\tmp1\().h}[6],[\dest],2
1:
    tbz     \size,0,1f
    st1     {v\tmp1\().b}[14],[\dest],1
1:
.endm
.macro write_small_data_start  src:req,dest:req,size:req,tbl_adr:req,tmp1:req
    adrp    \tbl_adr,:got:write_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:write_small_data_table]
    write_small_data \src,\dest,\size,\tbl_adr,\tmp1
.endm
.macro write_small_data_end  src:req,dest:req,size:req,tbl_adr:req,tmp1:req
    adrp    \tbl_adr,:got:write_end_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:write_end_small_data_table]
    write_small_data \src,\dest,\size,\tbl_adr,\tmp1
.endm

.macro tbx_small_data_end   src:req,dest:req,size:req,tbl_adr:req,tmp1:req
    adrp    \tbl_adr,:got:tbx_end_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:tbx_end_small_data_table]
    ldr     q\tmp1,[\tbl_adr,\size,lsl 4]
    tbx     v\dest\().16b,{v\src\().16b},v\tmp1\().16b
.endm

.macro tbx_small_data_start   src:req,dest:req,size:req,tbl_adr:req,tmp1:req
    adrp    \tbl_adr,:got:tbx_start_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:tbx_start_small_data_table]
    ldr     q\tmp1,[\tbl_adr,\size,lsl 4]
    tbx     v\dest\().16b,{v\src\().16b},v\tmp1\().16b
.endm


.macro clear_small_data   dest:req,zero:req,size:req,tbl_adr:req,tmp1:req
    adrp    \tbl_adr,:got:shift_small_data_table
    ldr     \tbl_adr,[\tbl_adr,#:got_lo12:shift_small_data_table]
    add     \tbl_adr,\tbl_adr,16
    sub     \tbl_adr,\tbl_adr,\size
    ldr     q\tmp1,[\tbl_adr]
    tbx     v\dest\().16b,{v\zero\().16b},v\tmp1\().16b
.endm


.macro aes_gcm_n_round is_enc:req,count:req,aadhash:req, dat_addr:req,  \
    hashkey_addr:req, hashkey_base:req,                                 \
    hashkey:req,hashkey_ext:req,high:req,low:req, poly:req,             \
    ctr:req,enc_ctr:req,one:req,out_adr:req,                            \
    tmp0:req,tmp1:req

    ghash_reset_hashkey_addr    \hashkey_addr,\hashkey_base,\count

    aes_gcm_init    \is_enc,\aadhash,\dat_addr,\hashkey_addr,           \
        \hashkey,\hashkey_ext, \high,\low,                              \
        \ctr,\enc_ctr,\one,\out_adr,                                    \
        \tmp0,\tmp1,\count

    .set left_count,\count - 1
    .rept left_count
        aes_gcm_middle        \is_enc,\aadhash,\dat_addr,\hashkey_addr, \
            \hashkey,\hashkey_ext, \high,\low,                          \
            \ctr,\enc_ctr,\one,\out_adr,                                \
            \tmp0,\tmp1, left_count
        .set left_count,left_count - 1
    .endr

    poly_mult_final_x2  \aadhash,\high,\low,\tmp0,\tmp1,\poly

.endm


/*
    aadhash=aadhash*[hashkey_base[(TOTAL_HASHKEY_NUM-2),(TOTAL_HASHKEY_NUM-1)]] + rbit(dat)
*/
.macro ghash_block_reg_x2 aadhash:req, dat:req, hashkey_base:req,       \
    hashkey:req,high:req,low:req,tmp0:req, tmp1:req,                    \
    tmp2:req,temp0:req
    ldr     q\hashkey,[\hashkey_base,(TOTAL_HASHKEY_NUM-1)*32+16]
    eor     v\tmp2\().16b,v\tmp2\().16b,v\tmp2\().16b,8 //zero
    pmull    v\tmp1\().1q,v\aadhash\().1d,v\hashkey\().1d
    pmull2   v\tmp0\().1q,v\aadhash\().2d,v\hashkey\().2d
    ldr     q\hashkey,[\hashkey_base,(TOTAL_HASHKEY_NUM-1)*32]
    eor      v\tmp0\().16b,v\tmp1\().16b,v\tmp0\().16b
    ext      v\tmp0\().16b,v\tmp0\().16b,v\tmp2\().16b,8 /*high*/
    ext      v\tmp1\().16b,v\tmp2\().16b,v\tmp0\().16b,8 /*low*/
    pmull2   v\high\().1q,v\aadhash\().2d,v\hashkey\().2d
    mov      temp0,0x87
    pmull    v\low\().1q,v\aadhash\().1d,v\hashkey\().1d
    dup      v\tmp2\().2d,x0
    eor      v\high\().16b,v\high\().16b,v\tmp0\().16b
    eor      v\low\().16b,v\low\().16b,v\tmp1\().16b
    rbit     v\aadhash\().16b, v\dat\().16b
    poly_mult_final_x2  \aadhash,\high,\low,\tmp0,\tmp1,\tmp2
.endm

.macro __generic_load_small_data  is_enc:req,len_bit:req,small_read_len:req,  \
        in_adr:req,out_adr:req,partial_block:req,temp0:req,temp1:req,r:req,p
    tbz         \small_read_len,\len_bit,1f
    ldr\p       \r\()\temp0,[\in_adr],1<<\len_bit           /*in */
    ldr\p       \r\()\temp1,[\partial_block]                /* partial*/
    eor         \r\()\temp1,\r\()\temp0,\r\()\temp1
    .ifc \is_enc ,decrypt
        str\p   \r\()\temp0,[\partial_block],1<<\len_bit
    .endif
    .ifc \is_enc, encrypt
        str\p   \r\()\temp1,[\partial_block],1<<\len_bit
    .endif
    str\p   \r\()\temp1,[\out_adr],1<<\len_bit
1:
.endm
.macro  generic_load_partial_block is_enc:req,small_read_len:req,in_adr:req,out_adr:req, \
    partial_block:req,temp0:req,temp1:req
    __generic_load_small_data \is_enc,3,\small_read_len,\in_adr,\out_adr,\partial_block,\temp0,\temp1,x     /*  small_read_len >=8 */
    __generic_load_small_data \is_enc,2,\small_read_len,\in_adr,\out_adr,\partial_block,\temp0,\temp1,w     /*  small_read_len >=4 */
    __generic_load_small_data \is_enc,1,\small_read_len,\in_adr,\out_adr,\partial_block,\temp0,\temp1,w,h   /*  small_read_len >=2 */
    __generic_load_small_data \is_enc,0,\small_read_len,\in_adr,\out_adr,\partial_block,\temp0,\temp1,w,b   /*  small_read_len >=1 */
.endm
/* without Neon read version */
.macro  generic_partial_block_start    is_enc:req,in_len:req,in_adr:req,out_adr:req,context:req,   \
        partial_block:req,partial_block_len:req,small_read_len:req,left_partial_block_len:req,     \
        temp0:req
    mov         \left_partial_block_len,16
    add         \partial_block,\context,PARTIAL_BLOCK_ENC_KEY_OFF
    sub         \left_partial_block_len,\left_partial_block_len,\partial_block_len
    add         \partial_block,\partial_block,\partial_block_len
    cmp         \in_len,\left_partial_block_len
    csel        \small_read_len,\in_len,\left_partial_block_len, ls
    add         \partial_block_len,\partial_block_len,\small_read_len
    sub         \in_len,\in_len,\small_read_len
    and         \partial_block_len,\partial_block_len,0xf
    str         \partial_block_len,[\context,PARTIAL_BLOCK_LENGTH_OFF]
    generic_load_partial_block \is_enc,\small_read_len,\in_adr,\out_adr,\partial_block, \
        \left_partial_block_len,\temp0     /*  small_read_len >=8 */
.endm
.macro  generic_paritial_block_end    is_enc:req,in_len:req,in_adr:req,out_adr:req,context:req,   \
        partial_block:req,temp0:req,temp1:req
    str         \in_len,[\context,PARTIAL_BLOCK_LENGTH_OFF]
    add         \partial_block,\context,PARTIAL_BLOCK_ENC_KEY_OFF
    generic_load_partial_block \is_enc,\in_len,\in_adr,\out_adr,\partial_block,\temp0,\temp1     /*  small_read_len >=8 */
.endm
/*partial_block_len+in_len < 16,partial_block_len=0,in_len>0 */
.macro  paritial_block_small_length is_enc:req,context:req,in_len:req,in_adr:req,out_adr:req,temp0:req,temp1:req,Ctr:req

    cbz     1f
    ldr     \temp0,[\context,PARTIAL_BLOCK_LENGTH_OFF]
    add     \temp1,\temp0,\in_len
    str     \temp1,[\context,PARTIAL_BLOCK_LENGTH_OFF]
    add     \context,\temp0,PARTIAL_BLOCK_ENC_KEY_OFF
2:/* loop start */
    sub     \in_len,\in_len,1
    ldrb    w\temp0,[\in_adr],1
    ldrb    w\temp1,[\context]
    eor     w\temp1,w\temp1,w\temp0
    strb    w\temp1,[\out_adr],1
.ifc \is_enc , encrypt
    strb    w\temp1,[\context],1
.endif
.ifc \is_enc,decrypt
    strb    w\temp0,[\context],1
.endif
    cbnz     \in_len,2b
1:/* loop end */
.endm

/* 0<in_len < 16,partial_block_len=0 */
.macro  paritial_block_end  is_enc:req,context:req,in_len:req,in_adr:req,out_adr:req,   \
    temp0:req,partial_block_len:req    \
    PartialBlock:req,ctr:req,one:req,Tmp2:req,Tmp3:req,Tmp4:req
    add         v\ctr\().4s,v\ctr\().4s,v\one\().4s    //increase ctr
    str         q\ctr,[context,CTR_OFF]
    read_small_data_start   \PartialBlock,\in_adr,\in_len,\tbl_adr,\Tmp0
    aes_encrypt_block   \ctr

.endm
        declare_var_vector_reg  Key0 ,16
        declare_var_vector_reg  Key1 ,17
        declare_var_vector_reg  Key2 ,18
        declare_var_vector_reg  Key3 ,19
        declare_var_vector_reg  Key4 ,20
        declare_var_vector_reg  Key5 ,21
        declare_var_vector_reg  Key6 ,22
        declare_var_vector_reg  Key7 ,23
        declare_var_vector_reg  Key8 ,24
        declare_var_vector_reg  Key9 ,25
        declare_var_vector_reg  Key10,26

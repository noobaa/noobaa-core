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
void aes_gcm_precomp(struct gcm_key_data *key_data);
*/
    declare_var_generic_reg key_data    ,0
    declare_var_generic_reg temp0       ,1
    declare_var_generic_reg hashkey_base,0
    declare_var_generic_reg hashkey_addr,1

    declare_var_vector_reg  Low         ,0
    declare_var_vector_reg  Middle0     ,1
    declare_var_vector_reg  Middle1     ,2
    declare_var_vector_reg  High        ,3
    declare_var_vector_reg  HashKeyIter ,4
    declare_var_vector_reg  HashKey     ,5
    declare_var_vector_reg  HashKeyExt  ,6
    declare_var_vector_reg  Poly        ,7
    declare_var_vector_reg  Zero        ,31

START_FUNC(precomp,KEY_LEN,_)
    load_aes_keys   key_data
    mov             temp0,0x87
    eor             vZero.16b,vZero.16b,vZero.16b
    eor             vHashKey.16b,vHashKey.16b,vHashKey.16b
    dup             vPoly.2d,temp0
    aes_encrypt_block   HashKey
    add             hashkey_addr,hashkey_base,(HASHKEY_TOTAL_NUM-1)*32
    rbit            vHashKey.16b,vHashKey.16b
    ext             vHashKeyExt.16b,vHashKey.16b,vHashKey.16b,8
    mov             vHashKeyIter.16b,vHashKey.16b
    stp             qHashKey,qHashKeyExt,[hashkey_addr],-32

1:
    pmull           vMiddle0.1q,vHashKeyIter.1d,vHashKeyExt.1d
    pmull2          vMiddle1.1q,vHashKeyIter.2d,vHashKeyExt.2d
    pmull           vLow.1q    ,vHashKeyIter.1d,vHashKey.1d
    eor             vMiddle0.16b,vMiddle0.16b,vMiddle1.16b
    pmull2          vHigh.1q   ,vHashKeyIter.2d,vHashKey.2d
    ext             vMiddle1.16b,vMiddle0.16b,vZero.16b,8 //high
    ext             vMiddle0.16b,vZero.16b,vMiddle0.16b,8 //low
    eor             vHigh.16b   ,vHigh.16b,vMiddle1.16b
    eor             vLow.16b    ,vLow.16b ,vMiddle0.16b
    pmull2          vMiddle0.1q ,vHigh.2d ,vPoly.2d
    ext             vMiddle1.16b,vMiddle0.16b,vZero.16b,8 //high
    ext             vMiddle0.16b,vZero.16b,vMiddle0.16b,8 //low
    eor             vHigh.16b   ,vHigh.16b,vMiddle1.16b
    eor             vLow.16b    ,vLow.16b ,vMiddle0.16b
    pmull           vMiddle0.1q ,vHigh.1d ,vPoly.1d
    eor             vHashKeyIter.16b,vLow.16b,vMiddle0.16b
    ext             vLow.16b,vHashKeyIter.16b,vHashKeyIter.16b,8
    stp             qHashKeyIter,qLow,[hashkey_addr],-32
    cmp             hashkey_addr,hashkey_base
    bcs             1b

    ret
END_FUNC(precomp,KEY_LEN,_)

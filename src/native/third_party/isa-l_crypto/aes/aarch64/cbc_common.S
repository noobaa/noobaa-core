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

#define FN_NAME(fn,mode,post) aes_cbc_##fn##_##mode##_##post
#define LABEL_NAME(fn,mode,post) .L##fn##_##mode##_##post
#define START_FUNC(fn,mode,post) .global FN_NAME(fn,mode,post); \
    .type   FN_NAME(fn,mode,post), %function; \
    FN_NAME(fn,mode,post):
#define END_FUNC(fn,mode,post)   .size  FN_NAME(fn,mode,post), .-FN_NAME(fn,mode,post)
.macro  declare_var_vector_reg name:req,reg:req
.ifdef q\name
    .unreq  q\name
    .unreq  v\name
    .unreq  s\name
    .unreq  d\name
.endif
    .set q\name , \reg
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
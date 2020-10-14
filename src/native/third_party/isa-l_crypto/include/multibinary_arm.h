/**********************************************************************
  Copyright(c) 2019 Arm Corporation All rights reserved.

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
#ifndef _MULTIBINARY_ARM_h
#define _MULTIBINARY_ARM_h
#ifdef __ASSEMBLY__
/**
 * This Maco is different with ISA-L lib
 * To use it . we should define a c function \name\()_dispatch_init
 * the prototype must same with the interface .
 * and the dispatch_init function should modify \name\()_dispatched
 **/
.macro mbin_dispatch name:req
	.extern	\name\()_dispatch_init
	.section	.data
	.balign 8
	.global \name\()_dispatched
	.type 	\name\()_dispatched,%object
	.size 	\name\()_dispatched,8
	\name\()_dispatched:
		.quad	\name\()_dispatch_init
	.text
	.global \name
	.type \name,%function
	.align	2
	\name\():
		adrp	x10, :got:\name\()_dispatched
		ldr	x10, [x10, #:got_lo12:\name\()_dispatched]
		ldr	x10,[x10]
		br	x10
		nop
	.size \name,. - \name

.endm


#endif /* __ASSEMBLY__ */

#endif /* _MULTIBINARY_ARM_h */


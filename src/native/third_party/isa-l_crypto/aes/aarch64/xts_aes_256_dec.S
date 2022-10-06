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

#include "xts_aes_256_common.S"
#include "xts_aes_common.S"

.macro vswap vec1:req,vec2:req
	mov	vtmp.16b,\vec1\().16b
	mov	\vec1\().16b,\vec2\().16b
	mov	\vec2\().16b,vtmp.16b
.endm

/* encrypt the tweak by tweak key (k2), and at the same time
 * to expand encryption key (k1)
 * even though two sets of keys share the same set of registers
 * they never overlap at any given time (k2 is used only once and discarded)
 */
.macro keyexp_and_encrypt_tweak iv:req,k2:req,k1:req
	aes_key_expand	0,\k2
	aes_enc_round	\iv,0
	aes_enc_round	\iv,1
	aes_key_expand	2
	aes_key_expand	0,\k1,rcon2
	aes_enc_round	\iv,2
	aes_enc_round	\iv,3
	aes_key_expand	4
	aes_key_expand	2,rcon2
	aes_enc_round	\iv,4
	aes_enc_round	\iv,5
	aes_key_expand	6
	aes_key_expand	4,rcon2
	aes_enc_round	\iv,6
	aes_enc_round	\iv,7
	aes_key_expand	8
	aes_key_expand	6,rcon2
	aes_enc_round	\iv,8
	aes_enc_round	\iv,9
	aes_key_expand	10
	aes_key_expand	8,rcon2
	aes_enc_round	\iv,10
	aes_enc_round	\iv,11
	aes_key_expand	12
	aes_key_expand	10,rcon2
	aes_enc_round	\iv,12
	aes_enc_round	\iv,13
	aes_key_expand	14
	aes_key_expand	12,rcon2
	aes_enc_round	\iv,14
	aes_key_expand	14,rcon2

	// transform encryption key into decrption key
	aesimc	vKey1.16b,vKey1.16b
	vswap	vKey0,vKey14
	aesimc	vKey13.16b,vKey13.16b
	aesimc	vKey2.16b,vKey2.16b
	vswap	vKey1,vKey13
	aesimc	vKey12.16b,vKey12.16b
	aesimc	vKey3.16b,vKey3.16b
	vswap	vKey2,vKey12
	aesimc	vKey11.16b,vKey11.16b
	aesimc	vKey4.16b,vKey4.16b
	vswap	vKey3,vKey11
	aesimc	vKey10.16b,vKey10.16b
	aesimc	vKey5.16b,vKey5.16b
	vswap	vKey4,vKey10
	aesimc	vKey9.16b,vKey9.16b
	aesimc	vKey6.16b,vKey6.16b
	vswap	vKey5,vKey9
	aesimc	vKey8.16b,vKey8.16b
	aesimc	vKey7.16b,vKey7.16b
	vswap	vKey6,vKey8
.endm

/*
 * void XTS_AES_256_dec_ce(
 *   uint8_t *k2,    //!<  key used for tweaking, 32 bytes
 *   uint8_t *k1,    //!<  key used for decryption of tweaked ciphertext, 32 bytes
 *   uint8_t *TW_initial,    //!<  initial tweak value, 16 bytes
 *   uint64_t N, //!<  sector size, in bytes
 *   const uint8_t *ct,  //!<  ciphertext sector input data
 *   uint8_t *pt //!<  plaintext sector output data
 *   );
*/
	.global XTS_AES_256_dec_ce
        .type XTS_AES_256_dec_ce, %function
XTS_AES_256_dec_ce:
	xts_aes_crypt 1,keyexp_and_encrypt_tweak vIV0,key2,key1
	.size   XTS_AES_256_dec_ce, .-XTS_AES_256_dec_ce

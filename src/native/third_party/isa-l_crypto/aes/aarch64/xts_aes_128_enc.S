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

#include "xts_aes_128_common.S"
#include "xts_aes_common.S"

/* encrypt the tweak by tweak key (k2), and at the same time
 * to expand encryption key (k1)
 * even though two sets of keys share the same set of registers
 * they never overlap at any given time (k2 is used once and discarded)
 */
.macro keyexp_and_encrypt_tweak iv:req,k2:req,k1:req
	aes_key_expand	0,\k2
	aes_enc_round	\iv,0
	aes_key_expand	1
	aes_enc_round	\iv,1
	aes_key_expand	0,\k1,rcon2
	aes_key_expand	2
	aes_enc_round	\iv,2
	aes_key_expand	1,rcon2
	aes_key_expand	3
	aes_enc_round	\iv,3
	aes_key_expand	2,rcon2
	aes_key_expand	4
	aes_enc_round	\iv,4
	aes_key_expand	3,rcon2
	aes_key_expand	5
	aes_enc_round	\iv,5
	aes_key_expand	4,rcon2
	aes_key_expand	6
	aes_enc_round	\iv,6
	aes_key_expand	5,rcon2
	aes_key_expand	7
	aes_enc_round	\iv,7
	aes_key_expand	6,rcon2
	aes_key_expand	8
	aes_enc_round	\iv,8
	aes_key_expand	7,rcon2
	aes_key_expand	9
	aes_enc_round	\iv,9
	aes_key_expand	8,rcon2
	aes_key_expand	10
	aes_enc_round	\iv,10
	aes_key_expand	9,rcon2
	aes_key_expand	10,rcon2
.endm


/*
 * void XTS_AES_128_enc_ce(
 *   uint8_t *k2,    //!<  key used for tweaking, 16 bytes
 *   uint8_t *k1,    //!<  key used for decryption of tweaked ciphertext, 16 bytes
 *   uint8_t *TW_initial,    //!<  initial tweak value, 16 bytes
 *   uint64_t N, //!<  sector size, in bytes
 *   const uint8_t *pt,  //!<  cleartext sector input data
 *   uint8_t *ct //!<  ciphertext sector output data
 *   );
 */
	.global XTS_AES_128_enc_ce
        .type XTS_AES_128_enc_ce, %function
XTS_AES_128_enc_ce:
	xts_aes_crypt 0,keyexp_and_encrypt_tweak vIV0,key2,key1
	.size   XTS_AES_128_enc_ce, .-XTS_AES_128_enc_ce

/**********************************************************************
  Copyright(c) 2011-2016 Intel Corporation All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in
      the documentation and/or other materials provided with the
      distribution.
    * Neither the name of Intel Corporation nor the names of its
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

#include <aes_gcm.h>
#include <aes_keyexp.h>

void aes_keyexp_128_enc(const void *, uint8_t *);
void aes_gcm_precomp_128(struct gcm_key_data *key_data);
void aes_gcm_precomp_256(struct gcm_key_data *key_data);

void aes_gcm_pre_128(const void *key, struct gcm_key_data *key_data)
{
	aes_keyexp_128_enc(key, key_data->expanded_keys);
	aes_gcm_precomp_128(key_data);
}

void aes_gcm_pre_256(const void *key, struct gcm_key_data *key_data)
{
	uint8_t tmp_exp_key[GCM_ENC_KEY_LEN * GCM_KEY_SETS];
	aes_keyexp_256((const uint8_t *)key, (uint8_t *) key_data->expanded_keys, tmp_exp_key);
	aes_gcm_precomp_256(key_data);
}

/*
 * Old interface pre functions
 */

void aesni_gcm128_pre(uint8_t * key, struct gcm_data *gdata)
{
	//////
	// Prefill the key values for each round of encrypting/decrypting
	// Prefill the Sub Hash key values for encoding the tag
	//////
	aes_keyexp_128_enc(key, (uint8_t *) gdata->expanded_keys);
	aes_gcm_precomp_128((struct gcm_key_data *)gdata);
}

void aesni_gcm256_pre(uint8_t * key, struct gcm_data *gdata)
{
	struct gcm_data tmp;
	//////
	// Prefill the key values for each round of encrypting/decrypting
	// Prefill the Sub Hash key values for encoding the tag
	//////
	aes_keyexp_256(key, gdata->expanded_keys, tmp.expanded_keys);
	aes_gcm_precomp_256((struct gcm_key_data *)gdata);

}

/*
 * GCM compatibility layer for old interface
 */

void aesni_gcm128_enc(struct gcm_data *my_ctx_data,
		      uint8_t * out,
		      uint8_t const *in,
		      uint64_t plaintext_len,
		      uint8_t * iv,
		      uint8_t const *aad,
		      uint64_t aad_len, uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_enc_128((struct gcm_key_data *)my_ctx_data,
			(struct gcm_context_data *)&(my_ctx_data->aad_hash),
			out, in, plaintext_len, iv, aad, aad_len, auth_tag, auth_tag_len);

	return;
}

void aesni_gcm256_enc(struct gcm_data *my_ctx_data,
		      uint8_t * out,
		      uint8_t const *in,
		      uint64_t plaintext_len,
		      uint8_t * iv,
		      uint8_t const *aad,
		      uint64_t aad_len, uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_enc_256((struct gcm_key_data *)my_ctx_data,
			(struct gcm_context_data *)&(my_ctx_data->aad_hash),
			out, in, plaintext_len, iv, aad, aad_len, auth_tag, auth_tag_len);

	return;
}

void aesni_gcm128_dec(struct gcm_data *my_ctx_data,
		      uint8_t * out,
		      uint8_t const *in,
		      uint64_t plaintext_len,
		      uint8_t * iv,
		      uint8_t const *aad,
		      uint64_t aad_len, uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_dec_128((struct gcm_key_data *)my_ctx_data,
			(struct gcm_context_data *)&(my_ctx_data->aad_hash),
			out, in, plaintext_len, iv, aad, aad_len, auth_tag, auth_tag_len);
	return;
}

void aesni_gcm256_dec(struct gcm_data *my_ctx_data,
		      uint8_t * out,
		      uint8_t const *in,
		      uint64_t plaintext_len,
		      uint8_t * iv,
		      uint8_t const *aad,
		      uint64_t aad_len, uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_dec_256((struct gcm_key_data *)my_ctx_data,
			(struct gcm_context_data *)&(my_ctx_data->aad_hash),
			out, in, plaintext_len, iv, aad, aad_len, auth_tag, auth_tag_len);
	return;
}

void aesni_gcm128_init(struct gcm_data *my_ctx_data,
		       uint8_t * iv, uint8_t const *aad, uint64_t aad_len)
{

	aes_gcm_init_128((struct gcm_key_data *)my_ctx_data,
			 (struct gcm_context_data *)&(my_ctx_data->aad_hash),
			 iv, aad, aad_len);
	return;
}

void aesni_gcm256_init(struct gcm_data *my_ctx_data,
		       uint8_t * iv, uint8_t const *aad, uint64_t aad_len)
{

	aes_gcm_init_256((struct gcm_key_data *)my_ctx_data,
			 (struct gcm_context_data *)&(my_ctx_data->aad_hash),
			 iv, aad, aad_len);
	return;
}

void aesni_gcm128_enc_update(struct gcm_data *my_ctx_data,
			     uint8_t * out, const uint8_t * in, uint64_t len)
{
	aes_gcm_enc_128_update((struct gcm_key_data *)my_ctx_data,
			       (struct gcm_context_data *)&(my_ctx_data->aad_hash),
			       out, in, len);
	return;
}

void aesni_gcm256_enc_update(struct gcm_data *my_ctx_data,
			     uint8_t * out, const uint8_t * in, uint64_t len)
{
	aes_gcm_enc_256_update((struct gcm_key_data *)my_ctx_data,
			       (struct gcm_context_data *)&(my_ctx_data->aad_hash),
			       out, in, len);
	return;
}

void aesni_gcm128_dec_update(struct gcm_data *my_ctx_data,
			     uint8_t * out, const uint8_t * in, uint64_t len)
{
	aes_gcm_dec_128_update((struct gcm_key_data *)my_ctx_data,
			       (struct gcm_context_data *)&(my_ctx_data->aad_hash),
			       out, in, len);
	return;
}

void aesni_gcm256_dec_update(struct gcm_data *my_ctx_data,
			     uint8_t * out, const uint8_t * in, uint64_t len)
{
	aes_gcm_dec_256_update((struct gcm_key_data *)my_ctx_data,
			       (struct gcm_context_data *)&(my_ctx_data->aad_hash),
			       out, in, len);
	return;
}

void aesni_gcm128_enc_finalize(struct gcm_data *my_ctx_data,
			       uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_enc_128_finalize((struct gcm_key_data *)my_ctx_data,
				 (struct gcm_context_data *)&(my_ctx_data->aad_hash),
				 auth_tag, auth_tag_len);
	return;
}

void aesni_gcm256_enc_finalize(struct gcm_data *my_ctx_data,
			       uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_enc_256_finalize((struct gcm_key_data *)my_ctx_data,
				 (struct gcm_context_data *)&(my_ctx_data->aad_hash),
				 auth_tag, auth_tag_len);
	return;
}

void aesni_gcm128_dec_finalize(struct gcm_data *my_ctx_data,
			       uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_dec_128_finalize((struct gcm_key_data *)my_ctx_data,
				 (struct gcm_context_data *)&(my_ctx_data->aad_hash),
				 auth_tag, auth_tag_len);
	return;
}

void aesni_gcm256_dec_finalize(struct gcm_data *my_ctx_data,
			       uint8_t * auth_tag, uint64_t auth_tag_len)
{
	aes_gcm_dec_256_finalize((struct gcm_key_data *)my_ctx_data,
				 (struct gcm_context_data *)&(my_ctx_data->aad_hash),
				 auth_tag, auth_tag_len);
	return;
}

struct slver {
	uint16_t snum;
	uint8_t ver;
	uint8_t core;
};

// Version info
struct slver aes_gcm_pre_128_slver_000002c7;
struct slver aes_gcm_pre_128_slver = { 0x02c7, 0x00, 0x00 };

struct slver aes_gcm_pre_256_slver_000002d7;
struct slver aes_gcm_pre_256_slver = { 0x02d7, 0x00, 0x00 };

struct slver aesni_gcm128_pre_slver_00000287;
struct slver aesni_gcm128_pre_slver = { 0x0287, 0x00, 0x00 };

struct slver aesni_gcm256_pre_slver_0000028f;
struct slver aesni_gcm256_pre_slver = { 0x028f, 0x00, 0x00 };

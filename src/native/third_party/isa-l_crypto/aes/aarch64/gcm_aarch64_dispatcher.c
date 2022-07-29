/**********************************************************************
  Copyright(c) 2020 Arm Corporation All rights reserved.

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
#include <aarch64_multibinary.h>

#undef PROVIDER_BASIC
#define PROVIDER_BASIC(a) (void*)0

static unsigned long is_crypto_available(void)
{
	unsigned long auxval = getauxval(AT_HWCAP);
	return (auxval & (HWCAP_ASIMD | HWCAP_AES | HWCAP_PMULL)) ==
	    (HWCAP_ASIMD | HWCAP_AES | HWCAP_PMULL);
}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_128)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_128_aes);

	return PROVIDER_BASIC(aes_gcm_enc_128);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_128)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_128_aes);

	return PROVIDER_BASIC(aes_gcm_dec_128);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_precomp_128)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_precomp_128_aes);

	return PROVIDER_BASIC(aes_gcm_precomp_128);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_256)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_256_aes);

	return PROVIDER_BASIC(aes_gcm_enc_256);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_256)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_256_aes);

	return PROVIDER_BASIC(aes_gcm_dec_256);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_precomp_256)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_precomp_256_aes);

	return PROVIDER_BASIC(aes_gcm_precomp_256);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_128_update)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_128_update_aes);

	return PROVIDER_BASIC(aes_gcm_enc_128_update);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_128_finalize)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_128_finalize_aes);

	return PROVIDER_BASIC(aes_gcm_enc_128_finalize);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_128_update)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_128_update_aes);

	return PROVIDER_BASIC(aes_gcm_dec_128_update);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_128_finalize)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_128_finalize_aes);

	return PROVIDER_BASIC(aes_gcm_dec_128_finalize);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_256_update)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_256_update_aes);

	return PROVIDER_BASIC(aes_gcm_enc_256_update);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_256_finalize)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_256_finalize_aes);

	return PROVIDER_BASIC(aes_gcm_enc_256_finalize);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_256_update)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_256_update_aes);

	return PROVIDER_BASIC(aes_gcm_dec_256_update);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_256_finalize)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_256_finalize_aes);

	return PROVIDER_BASIC(aes_gcm_dec_256_finalize);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_init_256)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_init_256_aes);

	return PROVIDER_BASIC(aes_gcm_init_256);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_init_128)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_init_128_aes);

	return PROVIDER_BASIC(aes_gcm_init_128);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_128_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_128_nt_aes);

	return PROVIDER_BASIC(aes_gcm_enc_128_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_128_update_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_128_update_nt_aes);

	return PROVIDER_BASIC(aes_gcm_enc_128_update_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_128_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_128_nt_aes);

	return PROVIDER_BASIC(aes_gcm_dec_128_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_128_update_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_128_update_nt_aes);

	return PROVIDER_BASIC(aes_gcm_dec_128_update_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_256_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_256_nt_aes);

	return PROVIDER_BASIC(aes_gcm_enc_256_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_enc_256_update_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_enc_256_update_nt_aes);

	return PROVIDER_BASIC(aes_gcm_enc_256_update_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_256_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_256_nt_aes);

	return PROVIDER_BASIC(aes_gcm_dec_256_nt);

}

DEFINE_INTERFACE_DISPATCHER(aes_gcm_dec_256_update_nt)
{
	if (is_crypto_available())
		return PROVIDER_INFO(aes_gcm_dec_256_update_nt_aes);

	return PROVIDER_BASIC(aes_gcm_dec_256_update_nt);

}

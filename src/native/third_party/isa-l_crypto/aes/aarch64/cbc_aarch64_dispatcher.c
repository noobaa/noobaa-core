/**********************************************************************
  Copyright(c) 2020-2021 Arm Corporation All rights reserved.

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
	return (auxval & (HWCAP_ASIMD | HWCAP_AES)) == (HWCAP_ASIMD | HWCAP_AES);
}

#define DEFINE_CBC_INTERFACE_DISPATCHER(func,mode,suffix)               \
    DEFINE_INTERFACE_DISPATCHER(aes_cbc_##func##_##mode)                \
    {                                                                   \
        if (is_crypto_available())                                      \
            return PROVIDER_INFO(aes_cbc_##func##_##mode##_##suffix);   \
        return PROVIDER_BASIC(aes_cbc_##func##_##mode);                 \
    }

DEFINE_CBC_INTERFACE_DISPATCHER(enc, 128, aes);
DEFINE_CBC_INTERFACE_DISPATCHER(enc, 192, aes);
DEFINE_CBC_INTERFACE_DISPATCHER(enc, 256, aes);

/*
 * AES-CBC decryption can be parallelised according to algorithm. Decryption
 * flow is to do decrypt and then EOR previous input data or IV(first).
 * So, decryption can be parallelised and EOR all data as output data.
 *
 * The unroll factor depends on micro architecture. The factors of N1, A57 and A72
 * are based on optimization guide and test results. Other platforms are based on
 * ThunderX2  test results.
 *
 */
DEFINE_INTERFACE_DISPATCHER(aes_cbc_dec_128)
{
	if (is_crypto_available()) {
		switch (get_micro_arch_id()) {
		case MICRO_ARCH_ID(ARM, NEOVERSE_N1):
			return PROVIDER_INFO(aes_cbc_dec_128_aes_1);
		case MICRO_ARCH_ID(ARM, CORTEX_A57):
			return PROVIDER_INFO(aes_cbc_dec_128_aes_4);
		case MICRO_ARCH_ID(ARM, CORTEX_A72):
			return PROVIDER_INFO(aes_cbc_dec_128_aes_6);
		}
		return PROVIDER_INFO(aes_cbc_dec_128_aes_5);
	}
	return PROVIDER_BASIC(aes_cbc_dec_128);
}

DEFINE_INTERFACE_DISPATCHER(aes_cbc_dec_192)
{
	if (is_crypto_available()) {
		switch (get_micro_arch_id()) {
		case MICRO_ARCH_ID(ARM, NEOVERSE_N1):
			return PROVIDER_INFO(aes_cbc_dec_192_aes_1);
		case MICRO_ARCH_ID(ARM, CORTEX_A57):
			return PROVIDER_INFO(aes_cbc_dec_192_aes_5);
		case MICRO_ARCH_ID(ARM, CORTEX_A72):
			return PROVIDER_INFO(aes_cbc_dec_192_aes_4);
		}
		return PROVIDER_INFO(aes_cbc_dec_192_aes_5);
	}
	return PROVIDER_BASIC(aes_cbc_dec_192);
}

DEFINE_INTERFACE_DISPATCHER(aes_cbc_dec_256)
{
	if (is_crypto_available()) {
		switch (get_micro_arch_id()) {
		case MICRO_ARCH_ID(ARM, NEOVERSE_N1):
			return PROVIDER_INFO(aes_cbc_dec_256_aes_1);
		case MICRO_ARCH_ID(ARM, CORTEX_A57):
			return PROVIDER_INFO(aes_cbc_dec_256_aes_5);
		case MICRO_ARCH_ID(ARM, CORTEX_A72):
			return PROVIDER_INFO(aes_cbc_dec_256_aes_6);
		}
		return PROVIDER_INFO(aes_cbc_dec_256_aes_5);
	}
	return PROVIDER_BASIC(aes_cbc_dec_256);
}

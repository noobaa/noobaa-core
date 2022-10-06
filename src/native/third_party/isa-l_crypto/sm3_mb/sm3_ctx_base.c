/**********************************************************************
  Copyright(c) 2011-2019 Intel Corporation All rights reserved.

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

#include <string.h>
#include "sm3_mb.h"
#include "memcpy_inline.h"
#include "endian_helper.h"

#ifdef _MSC_VER
#include <intrin.h>
#define inline __inline
#endif

#if (__GNUC__ >= 11)
# define OPT_FIX __attribute__ ((noipa))
#else
# define OPT_FIX
#endif

#define rol32(x, r) (((x)<<(r)) | ((x)>>(32-(r))))

static void sm3_init(SM3_HASH_CTX * ctx, const void *buffer, uint32_t len);
static void OPT_FIX sm3_update(SM3_HASH_CTX * ctx, const void *buffer, uint32_t len);
static void OPT_FIX sm3_final(SM3_HASH_CTX * ctx);
static void OPT_FIX sm3_single(const volatile void *data, uint32_t digest[]);
static inline void hash_init_digest(SM3_WORD_T * digest);

static inline uint32_t P0(uint32_t X)
{
	return (X ^ (rol32(X, 9)) ^ (rol32(X, 17)));
}

static inline uint32_t P1(uint32_t X)
{
	return (X ^ (rol32(X, 15)) ^ (rol32(X, 23)));
}

static inline uint32_t sm3_ff(int j, uint32_t x, uint32_t y, uint32_t z)
{
	return j < 16 ? (x ^ y ^ z) : ((x & y) | (x & z) | (y & z));
}

static inline uint32_t sm3_gg(int j, uint32_t x, uint32_t y, uint32_t z)
{
	return j < 16 ? (x ^ y ^ z) : ((x & y) | ((~x) & z));
}

static inline void sm3_message_schedule(uint32_t bi[], volatile uint32_t W[],
					volatile uint32_t W_B[])
{
	int j;
	volatile uint32_t tmp;

	for (j = 0; j <= 15; j++) {
		W[j] = to_be32(bi[j]);
	}

	for (; j <= 67; j++) {
		tmp = W[j - 16] ^ W[j - 9] ^ rol32(W[j - 3], 15);
		W[j] = P1(tmp) ^ (rol32(W[j - 13], 7)) ^ W[j - 6];
	}

	for (j = 0; j < 64; j++) {
		W_B[j] = W[j] ^ W[j + 4];
	}

	tmp = 0;
}

static inline void sm3_compress_step_func(int j, volatile uint32_t * a_p,
					  volatile uint32_t * b_p, volatile uint32_t * c_p,
					  volatile uint32_t * d_p, volatile uint32_t * e_p,
					  volatile uint32_t * f_p, volatile uint32_t * g_p,
					  volatile uint32_t * h_p, volatile uint32_t W[],
					  volatile uint32_t W_B[])
{
	volatile uint32_t SS1, SS2, TT1, TT2;
	uint32_t T = j < 16 ? 0x79cc4519 : 0x7a879d8a;

	SS1 = rol32(rol32(*a_p, 12) + *e_p + rol32(T, (j % 32)), 7);
	SS2 = SS1 ^ rol32(*a_p, 12);
	TT1 = sm3_ff(j, *a_p, *b_p, *c_p) + *d_p + SS2 + W_B[j];
	TT2 = sm3_gg(j, *e_p, *f_p, *g_p) + *h_p + SS1 + W[j];
	*d_p = *c_p;
	*c_p = rol32(*b_p, 9);
	*b_p = *a_p;
	*a_p = TT1;
	*h_p = *g_p;
	*g_p = rol32(*f_p, 19);
	*f_p = *e_p;
	*e_p = P0(TT2);

	SS1 = 0;
	SS2 = 0;
	TT1 = 0;
	TT2 = 0;
}

void sm3_ctx_mgr_init_base(SM3_HASH_CTX_MGR * mgr)
{
}

SM3_HASH_CTX *sm3_ctx_mgr_submit_base(SM3_HASH_CTX_MGR * mgr, SM3_HASH_CTX * ctx,
				      const void *buffer, uint32_t len, HASH_CTX_FLAG flags)
{

	if (flags & (~HASH_ENTIRE)) {
		// User should not pass anything other than FIRST, UPDATE, or LAST
		ctx->error = HASH_CTX_ERROR_INVALID_FLAGS;
		return ctx;
	}

	if ((ctx->status & HASH_CTX_STS_PROCESSING) && (flags == HASH_ENTIRE)) {
		// Cannot submit a new entire job to a currently processing job.
		ctx->error = HASH_CTX_ERROR_ALREADY_PROCESSING;
		return ctx;
	}

	if ((ctx->status & HASH_CTX_STS_COMPLETE) && !(flags & HASH_FIRST)) {
		// Cannot update a finished job.
		ctx->error = HASH_CTX_ERROR_ALREADY_COMPLETED;
		return ctx;
	}

	if (flags == HASH_FIRST) {
		sm3_init(ctx, buffer, len);
		sm3_update(ctx, buffer, len);
	}

	if (flags == HASH_UPDATE) {
		sm3_update(ctx, buffer, len);
	}

	if (flags == HASH_LAST) {
		sm3_update(ctx, buffer, len);
		sm3_final(ctx);
	}

	if (flags == HASH_ENTIRE) {
		sm3_init(ctx, buffer, len);
		sm3_update(ctx, buffer, len);
		sm3_final(ctx);
	}

	return ctx;
}

SM3_HASH_CTX *sm3_ctx_mgr_flush_base(SM3_HASH_CTX_MGR * mgr)
{
	return NULL;
}

static void sm3_init(SM3_HASH_CTX * ctx, const void *buffer, uint32_t len)
{
	// Init digest
	hash_init_digest(ctx->job.result_digest);

	// Reset byte counter
	ctx->total_length = 0;

	// Clear extra blocks
	ctx->partial_block_buffer_length = 0;

	// If we made it here, there were no errors during this call to submit
	ctx->error = HASH_CTX_ERROR_NONE;

	// Mark it as processing
	ctx->status = HASH_CTX_STS_PROCESSING;
}

static void sm3_update(SM3_HASH_CTX * ctx, const void *buffer, uint32_t len)
{
	uint32_t remain_len = len;
	uint32_t *digest = ctx->job.result_digest;

	// Advance byte counter
	ctx->total_length += len;

	// If there is anything currently buffered in the extra blocks, append to it until it contains a whole block.
	// Or if the user's buffer contains less than a whole block, append as much as possible to the extra block.
	if ((ctx->partial_block_buffer_length) | (remain_len < SM3_BLOCK_SIZE)) {
		// Compute how many bytes to copy from user buffer into extra block
		uint32_t copy_len = SM3_BLOCK_SIZE - ctx->partial_block_buffer_length;
		if (remain_len < copy_len) {
			copy_len = remain_len;
		}

		if (copy_len) {
			// Copy and update relevant pointers and counters
			memcpy_fixedlen(&ctx->partial_block_buffer
					[ctx->partial_block_buffer_length], buffer, copy_len);

			ctx->partial_block_buffer_length += copy_len;
			remain_len -= copy_len;
			buffer = (void *)((uint8_t *) buffer + copy_len);
		}
		// The extra block should never contain more than 1 block here
		assert(ctx->partial_block_buffer_length <= SM3_BLOCK_SIZE);

		// If the extra block buffer contains exactly 1 block, it can be hashed.
		if (ctx->partial_block_buffer_length >= SM3_BLOCK_SIZE) {
			ctx->partial_block_buffer_length = 0;
			sm3_single(ctx->partial_block_buffer, digest);
		}
	}
	// If the extra blocks are empty, begin hashing what remains in the user's buffer.
	if (ctx->partial_block_buffer_length == 0) {
		while (remain_len >= SM3_BLOCK_SIZE) {
			sm3_single(buffer, digest);
			buffer = (void *)((uint8_t *) buffer + SM3_BLOCK_SIZE);
			remain_len -= SM3_BLOCK_SIZE;
		}

	}

	if (remain_len > 0) {
		memcpy_fixedlen(&ctx->partial_block_buffer, buffer, remain_len);
		ctx->partial_block_buffer_length = remain_len;
	}

	ctx->status = HASH_CTX_STS_IDLE;
	return;
}

static void sm3_final(SM3_HASH_CTX * ctx)
{
	const void *buffer = ctx->partial_block_buffer;
	uint32_t i = ctx->partial_block_buffer_length;
	uint8_t buf[2 * SM3_BLOCK_SIZE];
	uint32_t *digest = ctx->job.result_digest;
	uint32_t j;

	memcpy(buf, buffer, i);
	buf[i++] = 0x80;
	for (j = i; j < (2 * SM3_BLOCK_SIZE); j++) {
		buf[j] = 0;
	}

	if (i > SM3_BLOCK_SIZE - SM3_PADLENGTHFIELD_SIZE) {
		i = 2 * SM3_BLOCK_SIZE;
	} else {
		i = SM3_BLOCK_SIZE;
	}

	*(uint64_t *) (buf + i - 8) = to_be64((uint64_t) ctx->total_length * 8);

	sm3_single(buf, digest);
	if (i == 2 * SM3_BLOCK_SIZE) {
		sm3_single(buf + SM3_BLOCK_SIZE, digest);
	}

	/* convert to small-endian for words */
	for (j = 0; j < SM3_DIGEST_NWORDS; j++) {
		digest[j] = byteswap32(digest[j]);
	}
	ctx->status = HASH_CTX_STS_COMPLETE;
}

static void sm3_single(const volatile void *data, uint32_t digest[])
{
	volatile uint32_t a, b, c, d, e, f, g, h;
	volatile uint32_t W[68], W_bar[64];
	int j;

	a = digest[0];
	b = digest[1];
	c = digest[2];
	d = digest[3];
	e = digest[4];
	f = digest[5];
	g = digest[6];
	h = digest[7];

	sm3_message_schedule((uint32_t *) data, W, W_bar);
	for (j = 0; j < 64; j++) {
		sm3_compress_step_func(j, &a, &b, &c, &d, &e, &f, &g, &h, W, W_bar);
	}

	digest[0] ^= a;
	digest[1] ^= b;
	digest[2] ^= c;
	digest[3] ^= d;
	digest[4] ^= e;
	digest[5] ^= f;
	digest[6] ^= g;
	digest[7] ^= h;

	memset((void *)W, 0, sizeof(W));
	memset((void *)W_bar, 0, sizeof(W_bar));

	a = 0;
	b = 0;
	c = 0;
	d = 0;
	e = 0;
	f = 0;
	g = 0;
	h = 0;
}

static inline void hash_init_digest(SM3_WORD_T * digest)
{
	static const SM3_WORD_T hash_initial_digest[SM3_DIGEST_NWORDS] =
	    { SM3_INITIAL_DIGEST };
	memcpy_fixedlen(digest, hash_initial_digest, sizeof(hash_initial_digest));
}

struct slver {
	uint16_t snum;
	uint8_t ver;
	uint8_t core;
};
struct slver sm3_ctx_mgr_init_base_slver_0000;
struct slver sm3_ctx_mgr_init_base_slver = { 0x2303, 0x00, 0x00 };

struct slver sm3_ctx_mgr_submit_base_slver_0000;
struct slver sm3_ctx_mgr_submit_base_slver = { 0x2304, 0x00, 0x00 };

struct slver sm3_ctx_mgr_flush_base_slver_0000;
struct slver sm3_ctx_mgr_flush_base_slver = { 0x2305, 0x00, 0x00 };

/*
	Copyright (c) 2015 Christopher A. Taylor.  All rights reserved.

	Redistribution and use in source and binary forms, with or without
	modification, are permitted provided that the following conditions are met:

	* Redistributions of source code must retain the above copyright notice,
	  this list of conditions and the following disclaimer.
	* Redistributions in binary form must reproduce the above copyright notice,
	  this list of conditions and the following disclaimer in the documentation
	  and/or other materials provided with the distribution.
	* Neither the name of CM256 nor the names of its contributors may be
	  used to endorse or promote products derived from this software without
	  specific prior written permission.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
	AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
	IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
	ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
	LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
	CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
	SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
	INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
	CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
	ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
	POSSIBILITY OF SUCH DAMAGE.
*/

#ifndef GF256_H
#define GF256_H

#include <stdint.h> // uint32_t etc
#include <string.h> // memcpy, memset

// Library version
#define GF256_VERSION 2

// TBD: Fix the polynomial at one value and use precomputed tables here to
// simplify the API for GF256.h version 2.  Avoids user data alignment issues.


//-----------------------------------------------------------------------------
// Platform-Specific Definitions
//
// Edit these to port to your architecture

#ifdef _MSC_VER

    // Compiler-specific 128-bit SIMD register keyword
    #define GF256_M128 __m128i

    // Compiler-specific C++11 restrict keyword
    #define GF256_RESTRICT __restrict

    // Compiler-specific force inline keyword
    #define GF256_FORCE_INLINE __forceinline

    // Compiler-specific alignment keyword
    #define GF256_ALIGNED __declspec(align(16))

    // Compiler-specific SSE headers
    #include <tmmintrin.h> // SSE3: _mm_shuffle_epi8
    #include <emmintrin.h> // SSE2

#else

    // Compiler-specific 128-bit SIMD register keyword
    #define GF256_M128 __m128i

    // Compiler-specific C++11 restrict keyword
    #define GF256_RESTRICT __restrict

    // Compiler-specific force inline keyword
    #define GF256_FORCE_INLINE __attribute__((always_inline))

    // Compiler-specific alignment keyword
    #define GF256_ALIGNED __attribute__((aligned(16)))

    #include <emmintrin.h> // SSE2
    #include <tmmintrin.h> // SSE3: _mm_shuffle_epi8

#endif


#ifdef __cplusplus
extern "C" {
#endif


//-----------------------------------------------------------------------------
// GF(256) Context
//
// The context object stores tables required to perform library calculations.
//
// Usage Notes:
// This struct should be aligned in memory, meaning that a pointer to it should
// have the low 4 bits cleared.  To achieve this simply tag the gf256_ctx object
// with the GF256_ALIGNED macro provided above.

#ifdef _MSC_VER
    #pragma warning(push)
    #pragma warning(disable: 4324) // warning C4324: 'gf256_ctx' : structure was padded due to __declspec(align())
#endif

struct gf256_ctx // 141,072 bytes
{
    // Polynomial used
    unsigned Polynomial;

    // Log/Exp tables
    uint16_t GF256_LOG_TABLE[256];
    uint8_t GF256_EXP_TABLE[512 * 2 + 1];

    // Mul/Div/Inv tables
    uint8_t GF256_MUL_TABLE[256 * 256];
    uint8_t GF256_DIV_TABLE[256 * 256];
    uint8_t GF256_INV_TABLE[256];

    // Muladd_mem tables
    // We require memory to be aligned since the SIMD instructions benefit from
    // aligned accesses to the MM256_* table data.
    GF256_M128 MM256_TABLE_LO_Y[256];
    GF256_M128 MM256_TABLE_HI_Y[256];
};

#ifdef _MSC_VER
    #pragma warning(pop)
#endif

extern struct gf256_ctx GF256Ctx;


//-----------------------------------------------------------------------------
// Initialization
//
// Initialize a context, filling in the tables.
//
// Thread-safety / Usage Notes:
//
// It is perfectly safe and encouraged to use a gf256_ctx object from multiple
// threads.  The gf256_init() is relatively expensive and should only be done
// once, though it will take less than a millisecond.
//
// The gf256_ctx object must be aligned to 16 byte boundary.
// Simply tag the object with GF256_ALIGNED to achieve this.
//
// Example:
//    static GF256_ALIGNED gf256_ctx TheGF256Context;
//    gf256_init(&TheGF256Context, 0);
//
// Returns 0 on success and other values on failure.

extern int gf256_init_(int version);
#define gf256_init() gf256_init_(GF256_VERSION)


//-----------------------------------------------------------------------------
// Math Operations

// return x + y
static GF256_FORCE_INLINE uint8_t gf256_add(uint8_t x, uint8_t y)
{
    return x ^ y;
}

// return x * y
// For repeated multiplication by a constant, it is faster to put the constant in y.
static GF256_FORCE_INLINE uint8_t gf256_mul(uint8_t x, uint8_t y)
{
    return GF256Ctx.GF256_MUL_TABLE[((unsigned)y << 8) + x];
}

// return x / y
// Memory-access optimized for constant divisors in y.
static GF256_FORCE_INLINE uint8_t gf256_div(uint8_t x, uint8_t y)
{
    return GF256Ctx.GF256_DIV_TABLE[((unsigned)y << 8) + x];
}

// return 1 / x
static GF256_FORCE_INLINE uint8_t gf256_inv(uint8_t x)
{
    return GF256Ctx.GF256_INV_TABLE[x];
}

// Performs "x[] += y[]" bulk memory XOR operation
extern void gf256_add_mem(void * GF256_RESTRICT vx,
                          const void * GF256_RESTRICT vy, int bytes);

// Performs "z[] += x[] + y[]" bulk memory operation
extern void gf256_add2_mem(void * GF256_RESTRICT vz, const void * GF256_RESTRICT vx,
                           const void * GF256_RESTRICT vy, int bytes);

// Performs "z[] = x[] + y[]" bulk memory operation
extern void gf256_addset_mem(void * GF256_RESTRICT vz, const void * GF256_RESTRICT vx,
                             const void * GF256_RESTRICT vy, int bytes);

// Performs "z[] += x[] * y" bulk memory operation
extern void gf256_muladd_mem(void * GF256_RESTRICT vz, uint8_t y,
                             const void * GF256_RESTRICT vx, int bytes);

// Performs "z[] = x[] * y" bulk memory operation
extern void gf256_mul_mem(void * GF256_RESTRICT vz,
                          const void * GF256_RESTRICT vx, uint8_t y, int bytes);

// Performs "x[] /= y" bulk memory operation
static GF256_FORCE_INLINE void gf256_div_mem(void * GF256_RESTRICT vz,
                                             const void * GF256_RESTRICT vx, uint8_t y, int bytes)
{
    // Multiply by inverse
    gf256_mul_mem(vz, vx, GF256Ctx.GF256_INV_TABLE[y], bytes);
}


//-----------------------------------------------------------------------------
// Misc Operations

// Swap two memory buffers in-place
extern void gf256_memswap(void * GF256_RESTRICT vx, void * GF256_RESTRICT vy, int bytes);


#ifdef __cplusplus
}
#endif


#endif // GF256_H

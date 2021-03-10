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

#ifndef _ENDIAN_HELPER_H_
#define _ENDIAN_HELPER_H_

/**
 *  @file  endian_helper.h
 *  @brief Byte order helper routines
 *
 */

#ifdef __cplusplus
extern "C" {
#endif

#if defined (__ICC)
# define byteswap32(x) _bswap(x)
# define byteswap64(x) _bswap64(x)
#elif defined (__GNUC__) && (__GNUC__ > 4 || (__GNUC__ == 4 && __GNUC_MINOR__ >= 3))
# define byteswap32(x) __builtin_bswap32(x)
# define byteswap64(x) __builtin_bswap64(x)
#else
# define byteswap32(x) (  ((x) << 24) \
                        | (((x) & 0xff00) << 8) \
                        | (((x) & 0xff0000) >> 8) \
                        | ((x)>>24))
# define byteswap64(x) (  (((x) & (0xffull << 0)) << 56) \
                        | (((x) & (0xffull << 8)) << 40) \
                        | (((x) & (0xffull << 16)) << 24) \
                        | (((x) & (0xffull << 24)) << 8) \
                        | (((x) & (0xffull << 32)) >> 8) \
                        | (((x) & (0xffull << 40)) >> 24) \
                        | (((x) & (0xffull << 48)) >> 40) \
                        | (((x) & (0xffull << 56)) >> 56))
#endif

// This check works when using GCC (or LLVM).  Assume little-endian
// if any other compiler is being used.
#if defined(__BYTE_ORDER__) && defined(__ORDER_BIG_ENDIAN__) \
    && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
#define to_le32(x) byteswap32(x)
#define to_le64(x) byteswap64(x)
#define to_be32(x) (x)
#define to_be64(x) (x)
#else
#define to_le32(x) (x)
#define to_le64(x) (x)
#define to_be32(x) byteswap32(x)
#define to_be64(x) byteswap64(x)
#endif

#ifdef __cplusplus
}
#endif

#endif // _ISA_HELPER_H_

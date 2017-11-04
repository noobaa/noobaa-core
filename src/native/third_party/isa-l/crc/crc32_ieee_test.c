/**********************************************************************
  Copyright(c) 2011-2015 Intel Corporation All rights reserved.

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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "crc.h"
#include "types.h"

#ifndef TEST_SEED
# define TEST_SEED 0x1234
#endif

#define MAX_BUF   512
#define TEST_SIZE  20

typedef uint64_t u64;
typedef uint32_t u32;
typedef uint16_t u16;
typedef uint8_t u8;

// Generates pseudo-random data

void rand_buffer(unsigned char *buf, long buffer_size)
{
	long i;
	for (i = 0; i < buffer_size; i++)
		buf[i] = rand();
}

int main(int argc, char *argv[])
{
	int fail = 0;
	u32 r;
	int verbose = argc - 1;
	int i, s, ret;
	void *buf_alloc;
	unsigned char *buf;

	printf("Test crc32_ieee ");

	// Align to MAX_BUF boundary
	ret = posix_memalign(&buf_alloc, MAX_BUF, MAX_BUF * TEST_SIZE);
	if (ret) {
		printf("alloc error: Fail");
		return -1;
	}
	buf = (unsigned char *)buf_alloc;

	srand(TEST_SEED);

	// Test of all zeros
	memset(buf, 0, MAX_BUF * 10);
	u32 crc = crc32_ieee(TEST_SEED, buf, MAX_BUF);
	u32 crc_ref = crc32_ieee_base(TEST_SEED, buf, MAX_BUF);
	if (crc != crc_ref) {
		fail++;
		printf("\n		   opt   ref\n");
		printf("		 ------ ------\n");
		printf("crc	zero = 0x%8x 0x%8x \n", crc, crc_ref);
	} else
		printf(".");

	// Another simple test pattern
	memset(buf, 0x8a, MAX_BUF);
	crc = crc32_ieee(TEST_SEED, buf, MAX_BUF);
	crc_ref = crc32_ieee_base(TEST_SEED, buf, MAX_BUF);
	if (crc != crc_ref)
		fail++;
	if (verbose)
		printf("crc  all 8a = 0x%8x 0x%8x\n", crc, crc_ref);
	else
		printf(".");

	// Do a few random tests
	r = rand();
	rand_buffer(buf, MAX_BUF * TEST_SIZE);

	for (i = 0; i < TEST_SIZE; i++) {
		crc = crc32_ieee(r, buf, MAX_BUF);
		crc_ref = crc32_ieee_base(r, buf, MAX_BUF);
		if (crc != crc_ref)
			fail++;
		if (verbose)
			printf("crc rand%3d = 0x%8x 0x%8x\n", i, crc, crc_ref);
		else
			printf(".");
		buf += MAX_BUF;
	}

	// Do a few random sizes
	buf = (unsigned char *)buf_alloc;	//reset buf
	r = rand();

	for (i = MAX_BUF; i >= 0; i--) {
		crc = crc32_ieee(r, buf, i);
		crc_ref = crc32_ieee_base(r, buf, i);
		if (crc != crc_ref) {
			fail++;
			printf("fail random size%i 0x%8x 0x%8x\n", i, crc, crc_ref);
		} else
			printf(".");
	}

	// Try different seeds
	for (s = 0; s < 20; s++) {
		buf = (unsigned char *)buf_alloc;	//reset buf

		r = rand();	// just to get a new seed
		rand_buffer(buf, MAX_BUF * TEST_SIZE);	// new pseudo-rand data

		if (verbose)
			printf("seed = 0x%x\n", r);

		for (i = 0; i < TEST_SIZE; i++) {
			crc = crc32_ieee(r, buf, MAX_BUF);
			crc_ref = crc32_ieee_base(r, buf, MAX_BUF);
			if (crc != crc_ref)
				fail++;
			if (verbose)
				printf("crc rand%3d = 0x%8x 0x%8x\n", i, crc, crc_ref);
			else
				printf(".");
			buf += MAX_BUF;
		}
	}

	// Run tests at end of buffer
	buf = (unsigned char *)buf_alloc;	//reset buf
	buf = buf + ((MAX_BUF - 1) * TEST_SIZE);	//Line up TEST_SIZE from end
	for (i = 0; i < TEST_SIZE; i++) {
		crc = crc32_ieee(TEST_SEED, buf + i, TEST_SIZE - i);
		crc_ref = crc32_ieee_base(TEST_SEED, buf + i, TEST_SIZE - i);
		if (crc != crc_ref)
			fail++;
		if (verbose)
			printf("crc eob rand%3d = 0x%4x 0x%4x\n", i, crc, crc_ref);
		else
			printf(".");
	}

	printf("Test done: %s\n", fail ? "Fail" : "Pass");
	if (fail)
		printf("\nFailed %d tests\n", fail);

	return fail;
}

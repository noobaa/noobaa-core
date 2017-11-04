/**********************************************************************
  Copyright(c) 2011-2017 Intel Corporation All rights reserved.

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
#include "md5_mb.h"
#include <openssl/md5.h>
#define TEST_LEN  		(1024*1024ull)	//1M
#define TEST_BUFS 		MD5_MIN_LANES
#define ROTATION_TIMES 		10000	//total length processing = TEST_LEN * ROTATION_TIMES
#define UPDATE_SIZE		(13*MD5_BLOCK_SIZE)

/* Reference digest global to reduce stack usage */
static uint8_t digest_ref_upd[4 * MD5_DIGEST_NWORDS];

int main(void)
{
	MD5_CTX o_ctx;		//openSSL
	MD5_HASH_CTX_MGR *mgr = NULL;
	MD5_HASH_CTX ctxpool[TEST_BUFS], *ctx = NULL;
	uint32_t i, j, k, fail = 0;
	long long len_done, len_rem;
	unsigned char *bufs[TEST_BUFS];
	unsigned char *buf_ptr[TEST_BUFS];
	unsigned char *buf_ref_upd;

	posix_memalign((void *)&mgr, 16, sizeof(MD5_HASH_CTX_MGR));
	md5_ctx_mgr_init(mgr);

	printf("\n");

	// Init ctx contents
	MD5_Init(&o_ctx);
	for (i = 0; i < TEST_BUFS; i++) {
		bufs[i] = (unsigned char *)calloc((size_t) TEST_LEN, 1);
		if (bufs[i] == NULL) {
			printf("malloc failed test aborted\n");
			return 1;
		}
		hash_ctx_init(&ctxpool[i]);
		ctxpool[i].user_data = (void *)((uint64_t) i);
	}

	//Openssl MD5 update test
	buf_ref_upd = (unsigned char *)calloc((size_t) (TEST_LEN), 1);
	for (k = 0; k < ROTATION_TIMES; k++) {
		MD5_Update(&o_ctx, buf_ref_upd, TEST_LEN);
	}

	MD5_Final(digest_ref_upd, &o_ctx);

	//Multi-buffer hashing
	for (k = 0; k < ROTATION_TIMES;) {
		for (i = 0; i < TEST_BUFS;) {
			buf_ptr[i] = bufs[i];
			len_done = 0;
			len_rem = (long long)TEST_LEN;
			if (len_done == 0 && k == 0) {
				ctx = md5_ctx_mgr_submit(mgr,
							 &ctxpool[i], buf_ptr[i], UPDATE_SIZE,
							 HASH_FIRST);
			}

			else if (len_rem <= UPDATE_SIZE) {
				if (k == ROTATION_TIMES - 1) {
					ctx = md5_ctx_mgr_submit(mgr,
								 &ctxpool[i], buf_ptr[i],
								 len_rem, HASH_LAST);
					ctx = md5_ctx_mgr_flush(mgr);

				} else {
					ctx = md5_ctx_mgr_submit(mgr,
								 &ctxpool[i],
								 buf_ptr[i], len_rem,
								 HASH_UPDATE);
					if ((ctx == NULL) || hash_ctx_complete(ctx)) {
						i++;
						continue;
					}

					ctx = md5_ctx_mgr_flush(mgr);
					if (ctx == NULL) {
						k++;
						continue;
					}
				}
			}

			else {
				ctx = md5_ctx_mgr_flush(mgr);
				ctx = md5_ctx_mgr_submit(mgr,
							 &ctxpool[i], buf_ptr[i], UPDATE_SIZE,
							 HASH_UPDATE);
			}

			if ((ctx == NULL) || hash_ctx_complete(ctx)) {
				i++;
				continue;
			}

			i = (unsigned long)(ctx->user_data);
			buf_ptr[i] += UPDATE_SIZE;
		}		//end for i < test_bufs

		ctx = md5_ctx_mgr_flush(mgr);
		while (ctx) {
			if (hash_ctx_complete(ctx)) {
				ctx = md5_ctx_mgr_flush(mgr);
				continue;
			}
			i = (unsigned long)(ctx->user_data);
			buf_ptr[i] += UPDATE_SIZE;
			len_done =
			    (long long)((unsigned long)buf_ptr[i] - (unsigned long)bufs[i]);
			len_rem = (long long)TEST_LEN - len_done;
			if (len_rem <= UPDATE_SIZE) {
				if (k == ROTATION_TIMES - 1) {
					ctx = md5_ctx_mgr_submit(mgr,
								 &ctxpool[i], buf_ptr[i],
								 len_rem, HASH_LAST);
				} else {
					ctx = md5_ctx_mgr_submit(mgr,
								 &ctxpool[i],
								 buf_ptr[i], len_rem,
								 HASH_UPDATE);
					if (ctx == NULL && i == TEST_BUFS - 1)	//all test bufs are finished
					{
						if (k >= ROTATION_TIMES - 1)
							break;
						else
							continue;
					}
				}
			} else {
				ctx = md5_ctx_mgr_submit(mgr,
							 &ctxpool[i],
							 buf_ptr[i], UPDATE_SIZE, HASH_UPDATE);
			}
			if (ctx == NULL) {
				ctx = md5_ctx_mgr_flush(mgr);
			}
		}		//end while

		if (ctx == NULL)
			k++;
	}

	printf("multibuffer md5 digest: \n");
	for (i = 0; i < TEST_BUFS; i++) {
		printf("Total processing size of buf[%d] is %ld \n", i,
		       ctxpool[i].total_length);
		for (j = 0; j < MD5_DIGEST_NWORDS; j++) {
			printf("digest%d : %08X\n", j, ctxpool[i].job.result_digest[j]);
		}
	}
	printf("\n");

	printf("openssl md5 update digest: \n");
	for (i = 0; i < MD5_DIGEST_NWORDS; i++)
		printf("%08X - ", ((uint32_t *) digest_ref_upd)[i]);
	printf("\n");

	for (i = 0; i < TEST_BUFS; i++) {
		for (j = 0; j < MD5_DIGEST_NWORDS; j++) {
			if (ctxpool[i].job.result_digest[j] !=
			    ((uint32_t *) digest_ref_upd)[j]) {
				fail++;
			}
		}
	}

	if (fail)
		printf("Test failed md5 hash large file check %d\n", fail);
	else
		printf(" md5_hash_large_test: Pass\n");
	return fail;
}

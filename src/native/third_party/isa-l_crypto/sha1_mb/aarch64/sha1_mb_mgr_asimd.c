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
#include <stddef.h>
#include <sha1_mb.h>
#include <assert.h>
#include "endian_helper.h"

extern void sha1_aarch64_x1(const uint8_t * data, int num_blocks, uint32_t digest[]);
static inline void sha1_job_x1(SHA1_JOB * job, int blocks)
{
	sha1_aarch64_x1(job->buffer, blocks, job->result_digest);
}

#ifndef min
#define min(a,b)            (((a) < (b)) ? (a) : (b))
#endif

#define SHA1_MB_ASIMD_MAX_LANES	4
void sha1_mb_asimd_x4(SHA1_JOB *, SHA1_JOB *, SHA1_JOB *, SHA1_JOB *, int);

#define LANE_IS_NOT_FINISHED(state,i)  	\
	(((state->lens[i]&(~0xf))!=0) && state->ldata[i].job_in_lane!=NULL)
#define LANE_IS_FINISHED(state,i)  	\
	(((state->lens[i]&(~0xf))==0) && state->ldata[i].job_in_lane!=NULL)
#define	LANE_IS_FREE(state,i)		\
	(((state->lens[i]&(~0xf))==0) && state->ldata[i].job_in_lane==NULL)
#define LANE_IS_INVALID(state,i)	\
	(((state->lens[i]&(~0xf))!=0) && state->ldata[i].job_in_lane==NULL)

void sha1_mb_mgr_init_asimd(SHA1_MB_JOB_MGR * state)
{
	unsigned int i;

	state->unused_lanes = 0xf;
	state->num_lanes_inuse = 0;
	for (i = 0; i < SHA1_MB_ASIMD_MAX_LANES; i++) {
		state->unused_lanes <<= 4;
		state->unused_lanes |= SHA1_MB_ASIMD_MAX_LANES - 1 - i;
		state->lens[i] = i;
		state->ldata[i].job_in_lane = 0;
	}

	// lanes > SHA1_MB_ASIMD_MAX_LANES is invalid lane
	for (; i < SHA1_MAX_LANES; i++) {
		state->lens[i] = 0xf;
		state->ldata[i].job_in_lane = 0;
	}
}

static int sha1_mb_mgr_do_jobs(SHA1_MB_JOB_MGR * state)
{
	int lane_idx, len, i, lanes, blocks;
	int lane_idx_array[SHA1_MAX_LANES];

	if (state->num_lanes_inuse == 0) {
		return -1;
	}
	lanes = 0, len = 0;
	for (i = 0; i < SHA1_MAX_LANES && lanes < state->num_lanes_inuse; i++) {
		if (LANE_IS_NOT_FINISHED(state, i)) {
			if (lanes)
				len = min(len, state->lens[i]);
			else
				len = state->lens[i];
			lane_idx_array[lanes] = i;
			lanes++;
		}
	}

	if (lanes == 0)
		return -1;
	lane_idx = len & 0xf;
	len = len & (~0xf);
	blocks = len >> 4;

	/* for less-than-3-lane job, ASIMD really does not have much advantage
	 * compared to scalar due to wasted >= 50% capacity
	 * therefore we only run ASIMD for 3/4 lanes of data
	 */
	if (lanes == SHA1_MB_ASIMD_MAX_LANES) {
		sha1_mb_asimd_x4(state->ldata[lane_idx_array[0]].job_in_lane,
				 state->ldata[lane_idx_array[1]].job_in_lane,
				 state->ldata[lane_idx_array[2]].job_in_lane,
				 state->ldata[lane_idx_array[3]].job_in_lane, blocks);
	} else if (lanes == 3) {
		/* in case of 3 lanes, apparently ASIMD will still operate as if
		 * there were four lanes of data in processing (waste 25% capacity)
		 * theoretically we can let ASIMD implementation know the number of lanes
		 * so that it could "at least" save some memory loading time
		 * but in practice, we can just pass lane 0 as dummy for similar
		 * cache performance
		 */
		SHA1_JOB dummy;
		dummy.buffer = state->ldata[lane_idx_array[0]].job_in_lane->buffer;
		dummy.len = state->ldata[lane_idx_array[0]].job_in_lane->len;
		sha1_mb_asimd_x4(state->ldata[lane_idx_array[0]].job_in_lane,
				 &dummy,
				 state->ldata[lane_idx_array[1]].job_in_lane,
				 state->ldata[lane_idx_array[2]].job_in_lane, blocks);
	} else {
		sha1_job_x1(state->ldata[lane_idx_array[0]].job_in_lane, blocks);
		if (lanes >= 2) {
			sha1_job_x1(state->ldata[lane_idx_array[1]].job_in_lane, blocks);
		}
	}

	// only return the min length job
	for (i = 0; i < SHA1_MAX_LANES; i++) {
		if (LANE_IS_NOT_FINISHED(state, i)) {
			state->lens[i] -= len;
			state->ldata[i].job_in_lane->len -= len;
			state->ldata[i].job_in_lane->buffer += len << 2;
		}
	}
	return lane_idx;

}

static SHA1_JOB *sha1_mb_mgr_free_lane(SHA1_MB_JOB_MGR * state)
{
	int i;
	SHA1_JOB *ret = NULL;

	for (i = 0; i < SHA1_MB_ASIMD_MAX_LANES; i++) {
		if (LANE_IS_FINISHED(state, i)) {
			state->unused_lanes <<= 4;
			state->unused_lanes |= i;
			state->num_lanes_inuse--;
			ret = state->ldata[i].job_in_lane;
			ret->status = STS_COMPLETED;
			state->ldata[i].job_in_lane = NULL;
			break;
		}
	}
	return ret;
}

static void sha1_mb_mgr_insert_job(SHA1_MB_JOB_MGR * state, SHA1_JOB * job)
{
	int lane_idx;
	// add job into lanes
	lane_idx = state->unused_lanes & 0xf;
	// fatal error
	assert(lane_idx < SHA1_MB_ASIMD_MAX_LANES);
	state->lens[lane_idx] = (job->len << 4) | lane_idx;
	state->ldata[lane_idx].job_in_lane = job;
	state->unused_lanes >>= 4;
	state->num_lanes_inuse++;
}

SHA1_JOB *sha1_mb_mgr_submit_asimd(SHA1_MB_JOB_MGR * state, SHA1_JOB * job)
{
#ifndef NDEBUG
	int lane_idx;
#endif
	SHA1_JOB *ret;

	// add job into lanes
	sha1_mb_mgr_insert_job(state, job);

	ret = sha1_mb_mgr_free_lane(state);
	if (ret != NULL) {
		return ret;
	}
	// submit will wait all lane has data
	if (state->num_lanes_inuse < SHA1_MB_ASIMD_MAX_LANES)
		return NULL;
#ifndef NDEBUG
	lane_idx = sha1_mb_mgr_do_jobs(state);
	assert(lane_idx != -1);
#else
	sha1_mb_mgr_do_jobs(state);
#endif

	// ~ i = lane_idx;
	ret = sha1_mb_mgr_free_lane(state);
	return ret;
}

SHA1_JOB *sha1_mb_mgr_flush_asimd(SHA1_MB_JOB_MGR * state)
{
	SHA1_JOB *ret;
	ret = sha1_mb_mgr_free_lane(state);
	if (ret) {
		return ret;
	}

	sha1_mb_mgr_do_jobs(state);
	return sha1_mb_mgr_free_lane(state);

}

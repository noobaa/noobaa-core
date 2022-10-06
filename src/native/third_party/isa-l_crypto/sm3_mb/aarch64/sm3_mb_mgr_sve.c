/**********************************************************************
  Copyright(c) 2022 Arm Corporation All rights reserved.

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
#include <sm3_mb.h>
#include <assert.h>

#ifndef max
#define max(a,b)            (((a) > (b)) ? (a) : (b))
#endif

#ifndef min
#define min(a,b)            (((a) < (b)) ? (a) : (b))
#endif

extern void sm3_mb_sve(int blocks, int total_lanes, SM3_JOB **);
extern void sm3_mb_asimd_x4(SM3_JOB *, SM3_JOB *, SM3_JOB *, SM3_JOB *, int);
extern void sm3_mb_asimd_x1(SM3_JOB *, int);
extern int sm3_mb_sve_max_lanes(void);

#define LANE_IS_NOT_FINISHED(state,i)  	\
	(((state->lens[i]&(~0xf))!=0) && state->ldata[i].job_in_lane!=NULL)
#define LANE_IS_FINISHED(state,i)  	\
	(((state->lens[i]&(~0xf))==0) && state->ldata[i].job_in_lane!=NULL)
#define	LANE_IS_FREE(state,i)		\
	(((state->lens[i]&(~0xf))==0) && state->ldata[i].job_in_lane==NULL)
#define LANE_IS_INVALID(state,i)	\
	(((state->lens[i]&(~0xf))!=0) && state->ldata[i].job_in_lane==NULL)
void sm3_mb_mgr_init_sve(SM3_MB_JOB_MGR * state)
{
	unsigned int i;
	int maxjobs = sm3_mb_sve_max_lanes();

	if (maxjobs > SM3_MAX_LANES)
		maxjobs = SM3_MAX_LANES;
	state->unused_lanes = 0xf;
	state->num_lanes_inuse = 0;

	for (i = 0; i < maxjobs; i++) {
		state->unused_lanes <<= 4;
		state->unused_lanes |= maxjobs - 1 - i;
		state->lens[i] = i;
		state->ldata[i].job_in_lane = 0;
	}

	for (; i < SM3_MAX_LANES; i++) {
		state->lens[i] = 0xf;
		state->ldata[i].job_in_lane = 0;
	}
}

static int sm3_mb_mgr_do_jobs(SM3_MB_JOB_MGR * state)
{
	int lane_idx, len, i, lanes, blocks;
	SM3_JOB *job_vecs[SM3_MAX_LANES];
	int maxjobs;

	if (state->num_lanes_inuse == 0) {
		return -1;
	}

	maxjobs = sm3_mb_sve_max_lanes();
	if (maxjobs > SM3_MAX_LANES)
		maxjobs = SM3_MAX_LANES;

	lanes = 0;
	len = 0;
	for (i = 0; i < SM3_MAX_LANES && lanes < state->num_lanes_inuse; i++) {
		if (LANE_IS_NOT_FINISHED(state, i)) {
			if (lanes)
				len = min(len, state->lens[i]);
			else
				len = state->lens[i];
			job_vecs[lanes++] = state->ldata[i].job_in_lane;
		}
	}

	if (lanes == 0)
		return -1;
	lane_idx = len & 0xf;
	len &= ~0xf;
	blocks = len >> 4;

	if (lanes >= maxjobs - 2) {
		sm3_mb_sve(blocks, lanes, job_vecs);
	} else {
		i = 0;
		while (i + 3 < lanes) {
			sm3_mb_asimd_x4(job_vecs[i], job_vecs[i + 1],
					job_vecs[i + 2], job_vecs[i + 3], blocks);
			i += 4;
		}

		while (i < lanes) {
			sm3_mb_asimd_x1(job_vecs[i++], blocks);
		}
	}
	for (i = 0; i < SM3_MAX_LANES; i++) {
		if (LANE_IS_NOT_FINISHED(state, i)) {
			state->lens[i] -= len;
			state->ldata[i].job_in_lane->len -= len;
			state->ldata[i].job_in_lane->buffer += len << 2;
		}
	}

	return lane_idx;
}

static SM3_JOB *sm3_mb_mgr_free_lane(SM3_MB_JOB_MGR * state)
{
	int i;
	SM3_JOB *ret = NULL;

	for (i = 0; i < SM3_MAX_LANES; i++) {
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

static void sm3_mb_mgr_insert_job(SM3_MB_JOB_MGR * state, SM3_JOB * job)
{
	int lane_idx;

	//add job into lanes
	lane_idx = state->unused_lanes & 0xf;
	state->lens[lane_idx] = (job->len << 4) | lane_idx;
	state->ldata[lane_idx].job_in_lane = job;
	state->unused_lanes >>= 4;
	state->num_lanes_inuse++;
}

SM3_JOB *sm3_mb_mgr_submit_sve(SM3_MB_JOB_MGR * state, SM3_JOB * job)
{
#ifndef NDEBUG
	int lane_idx;
#endif
	SM3_JOB *ret;
	int maxjobs = sm3_mb_sve_max_lanes();

	if (maxjobs > SM3_MAX_LANES)
		maxjobs = SM3_MAX_LANES;

	//add job into lanes
	sm3_mb_mgr_insert_job(state, job);

	ret = sm3_mb_mgr_free_lane(state);
	if (ret != NULL) {
		return ret;
	}
	//submit will wait all lane has data
	if (state->num_lanes_inuse < maxjobs)
		return NULL;
#ifndef NDEBUG
	lane_idx = sm3_mb_mgr_do_jobs(state);
	assert(lane_idx != -1);
#else
	sm3_mb_mgr_do_jobs(state);
#endif

	//~ i = lane_idx;
	ret = sm3_mb_mgr_free_lane(state);
	return ret;
}

SM3_JOB *sm3_mb_mgr_flush_sve(SM3_MB_JOB_MGR * state)
{
	SM3_JOB *ret;

	ret = sm3_mb_mgr_free_lane(state);
	if (ret) {
		return ret;
	}

	sm3_mb_mgr_do_jobs(state);
	return sm3_mb_mgr_free_lane(state);
}

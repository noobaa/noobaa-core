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
#include <md5_mb.h>
#include <assert.h>

#ifndef min
#define min(a,b)            (((a) < (b)) ? (a) : (b))
#endif

extern void md5_mb_sve2(int blocks, int total_lanes, MD5_JOB **);
extern void md5_mb_asimd_x4(MD5_JOB *, MD5_JOB *, MD5_JOB *, MD5_JOB *, int);
extern void md5_mb_asimd_x1(MD5_JOB *, int);
extern int md5_mb_sve_max_lanes(void);

#define LANE_IS_NOT_FINISHED(state,i)  	\
	(((state->lens[i]&(~0xff))!=0) && state->ldata[i].job_in_lane!=NULL)
#define LANE_IS_FINISHED(state,i)  	\
	(((state->lens[i]&(~0xff))==0) && state->ldata[i].job_in_lane!=NULL)
#define	LANE_IS_FREE(state,i)		\
	(((state->lens[i]&(~0xff))==0) && state->ldata[i].job_in_lane==NULL)
#define LANE_IS_INVALID(state,i)	\
	(((state->lens[i]&(~0xff))!=0) && state->ldata[i].job_in_lane==NULL)
void md5_mb_mgr_init_sve2(MD5_MB_JOB_MGR * state)
{
	unsigned int j;
	state->unused_lanes[0] = 0x0706050403020100;
	state->unused_lanes[1] = 0x0f0e0d0c0b0a0908;
	state->unused_lanes[2] = 0x1716151413121110;
	state->unused_lanes[3] = 0x1f1e1d1c1b1a1918;
	state->num_lanes_inuse = 0;
	for (j = 0; j < MD5_MAX_LANES; j++) {
		state->lens[j] = j;
		state->ldata[j].job_in_lane = 0;
	}
}

static int md5_mb_mgr_do_jobs(MD5_MB_JOB_MGR * state)
{
	int lane_idx, len, i, lanes, blocks;
	MD5_JOB *job_vecs[MD5_MAX_LANES];
	int maxjobs;

	if (state->num_lanes_inuse == 0) {
		return -1;
	}

	maxjobs = md5_mb_sve_max_lanes();
	if (maxjobs > MD5_MAX_LANES)
		maxjobs = MD5_MAX_LANES;

	lanes = 0;
	len = 0;
	for (i = 0; i < MD5_MAX_LANES && lanes < state->num_lanes_inuse; i++) {
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
	lane_idx = len & 0xff;
	len &= ~0xff;
	blocks = len >> 8;

	// current SVE implementation leverage double pipeline in parallel
	// based on current V1 micro-architecture test, it is found SVE
	// do not perform well (that is, better than neon) if the number
	// lanes is less than single vector capacity minus 2
	// Things might change for future micro-architecture
	if (lanes >= 4 && lanes >= maxjobs / 2 - 2) {
		md5_mb_sve2(blocks, lanes, job_vecs);
	} else {
		i = 0;
		while (i + 3 < lanes) {
			md5_mb_asimd_x4(job_vecs[i], job_vecs[i + 1],
					job_vecs[i + 2], job_vecs[i + 3], blocks);
			i += 4;
		}

		while (i < lanes) {
			md5_mb_asimd_x1(job_vecs[i++], blocks);
		}
	}

	for (i = 0; i < MD5_MAX_LANES; i++) {
		if (LANE_IS_NOT_FINISHED(state, i)) {
			state->lens[i] -= len;
			state->ldata[i].job_in_lane->len -= (blocks << 6);
			state->ldata[i].job_in_lane->buffer += (blocks << 6);
		}
	}

	return lane_idx;
}

static MD5_JOB *md5_mb_mgr_free_lane(MD5_MB_JOB_MGR * state)
{
	int i;
	MD5_JOB *ret = NULL;

	for (i = 0; i < MD5_MAX_LANES; i++) {
		if (LANE_IS_FINISHED(state, i)) {
			int grp = i / 8;
			state->unused_lanes[grp] <<= 8;
			state->unused_lanes[grp] |= i;
			state->num_lanes_inuse--;
			ret = state->ldata[i].job_in_lane;
			ret->status = STS_COMPLETED;
			state->ldata[i].job_in_lane = NULL;
			break;
		}
	}
	return ret;
}

static void md5_mb_mgr_insert_job(MD5_MB_JOB_MGR * state, MD5_JOB * job)
{
	int grp = 0;
	int lane_idx;

	for (int i = 0; i < MD5_MAX_LANES; i++) {
		if (LANE_IS_FREE(state, i)) {
			grp = i / 8;
			break;
		}
	}

	//add job into lanes
	lane_idx = state->unused_lanes[grp] & 0xff;

	//fatal error
	assert(lane_idx < MD5_MAX_LANES);
	state->lens[lane_idx] = (job->len << 8) | lane_idx;
	state->ldata[lane_idx].job_in_lane = job;
	state->unused_lanes[grp] >>= 8;
	state->num_lanes_inuse++;
}

MD5_JOB *md5_mb_mgr_submit_sve2(MD5_MB_JOB_MGR * state, MD5_JOB * job)
{
#ifndef NDEBUG
	int lane_idx;
#endif
	MD5_JOB *ret;
	int maxjobs = md5_mb_sve_max_lanes();

	if (maxjobs > MD5_MAX_LANES)
		maxjobs = MD5_MAX_LANES;

	//add job into lanes
	md5_mb_mgr_insert_job(state, job);

	ret = md5_mb_mgr_free_lane(state);
	if (ret != NULL) {
		return ret;
	}
	//submit will wait all lane has data
	if (state->num_lanes_inuse < maxjobs)
		return NULL;
#ifndef NDEBUG
	lane_idx = md5_mb_mgr_do_jobs(state);
	assert(lane_idx != -1);
#else
	md5_mb_mgr_do_jobs(state);
#endif

	ret = md5_mb_mgr_free_lane(state);
	return ret;
}

MD5_JOB *md5_mb_mgr_flush_sve2(MD5_MB_JOB_MGR * state)
{
	MD5_JOB *ret;

	ret = md5_mb_mgr_free_lane(state);
	if (ret) {
		return ret;
	}

	md5_mb_mgr_do_jobs(state);
	return md5_mb_mgr_free_lane(state);
}

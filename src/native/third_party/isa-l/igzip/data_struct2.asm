;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;  Copyright(c) 2011-2016 Intel Corporation All rights reserved.
;
;  Redistribution and use in source and binary forms, with or without
;  modification, are permitted provided that the following conditions
;  are met:
;    * Redistributions of source code must retain the above copyright
;      notice, this list of conditions and the following disclaimer.
;    * Redistributions in binary form must reproduce the above copyright
;      notice, this list of conditions and the following disclaimer in
;      the documentation and/or other materials provided with the
;      distribution.
;    * Neither the name of Intel Corporation nor the names of its
;      contributors may be used to endorse or promote products derived
;      from this software without specific prior written permission.
;
;  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
;  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
;  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
;  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
;  OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
;  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
;  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
;  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
;  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
;  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
;  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; START_FIELDS
%macro START_FIELDS 0
%assign _FIELD_OFFSET 0
%assign _STRUCT_ALIGN 0
%endm

;; FIELD name size align
%macro FIELD 3
%define %%name  %1
%define %%size  %2
%define %%align %3

%assign _FIELD_OFFSET (_FIELD_OFFSET + (%%align) - 1) & (~ ((%%align)-1))
%%name	equ	_FIELD_OFFSET
%assign _FIELD_OFFSET _FIELD_OFFSET + (%%size)
%if (%%align > _STRUCT_ALIGN)
%assign _STRUCT_ALIGN %%align
%endif
%endm

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

START_FIELDS	;; BitBuf2

;;      name		size    align
FIELD	_m_bits,	8,	8
FIELD	_m_bit_count,	4,	4
FIELD	_m_out_buf,	8,	8
FIELD	_m_out_end,	8,	8
FIELD	_m_out_start,	8,	8

%assign _BitBuf2_size	_FIELD_OFFSET
%assign _BitBuf2_align	_STRUCT_ALIGN

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
%define HIST_ELEM_SIZE 4

START_FIELDS	;; isal_mod_hist

;;      name		size    align
FIELD	_d_hist,	30*HIST_ELEM_SIZE,	HIST_ELEM_SIZE
FIELD	_ll_hist,	513*HIST_ELEM_SIZE,	HIST_ELEM_SIZE

%assign _isal_mod_hist_size	_FIELD_OFFSET
%assign _isal_mod_hist_align	_STRUCT_ALIGN

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%define HUFF_CODE_SIZE 4

START_FIELDS	;; hufftables_icf

;;      name		size    align
FIELD	_dist_table,	31 * HUFF_CODE_SIZE,	HUFF_CODE_SIZE
FIELD	_lit_len_table,	513 * HUFF_CODE_SIZE,	HUFF_CODE_SIZE

%assign _hufftables_icf_size	_FIELD_OFFSET
%assign _hufftables_icf_align	_STRUCT_ALIGN

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

%define DEF_MAX_HDR_SIZE 328
START_FIELDS	;; level_2_buf

;;      name		size    align
FIELD	_encode_tables,		_hufftables_icf_size,	_hufftables_icf_align
FIELD	_deflate_hdr_buf_used,	8,	8
FIELD	_deflate_hdr_buf,	DEF_MAX_HDR_SIZE,	1
FIELD	_block_start_index,	4,	4
FIELD	_block_in_length,	4,	4
FIELD	_icf_buf_next,		8,	8
FIELD	_icf_buf_avail_out,	8,	8
FIELD	_icf_buf_start,		0,	0

%assign _level_2_buf_size	_FIELD_OFFSET
%assign _level_2_buf_align	_STRUCT_ALIGN

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

START_FIELDS	;; isal_zstate

;;      name		size    align
FIELD	_file_start,	8,	8
FIELD	_bitbuf,	_BitBuf2_size,	_BitBuf2_align
FIELD	_crc,		4,	4
FIELD	_state,		4,	4
FIELD	_has_wrap_hdr,	2,	2
FIELD	_has_eob_hdr,	2,	2
FIELD	_has_eob,	2,	2
FIELD	_has_hist,	2,	2
FIELD	_hist,		_isal_mod_hist_size, _isal_mod_hist_align
FIELD	_count,		4,	4
FIELD   _tmp_out_buff,	16,	1
FIELD   _tmp_out_start,	4,	4
FIELD	_tmp_out_end,	4,	4
FIELD	_b_bytes_valid,	4,	4
FIELD	_b_bytes_processed,	4,	4
FIELD	_buffer,	BSIZE,	1
FIELD	_head,		IGZIP_HASH_SIZE*2,	2

%assign _isal_zstate_size	_FIELD_OFFSET
%assign _isal_zstate_align	_STRUCT_ALIGN

_bitbuf_m_bits		equ	_bitbuf+_m_bits
_bitbuf_m_bit_count	equ	_bitbuf+_m_bit_count
_bitbuf_m_out_buf	equ	_bitbuf+_m_out_buf
_bitbuf_m_out_end	equ	_bitbuf+_m_out_end
_bitbuf_m_out_start	equ	_bitbuf+_m_out_start

_hist_lit_len		equ	_hist+_ll_hist
_hist_dist		equ	_hist+_d_hist
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

START_FIELDS	;; isal_zstream

;;      name		size    align
FIELD	_next_in,	8,	8
FIELD	_avail_in,	4,	4
FIELD	_total_in,	4,	4
FIELD	_next_out,	8,	8
FIELD	_avail_out,	4,	4
FIELD	_total_out,	4,	4
FIELD	_hufftables,	8,	8
FIELD	_level,		4,	4
FIELD	_level_buf_size,	4,	4
FIELD	_level_buf,	8,	8
FIELD	_end_of_stream,	2,	2
FIELD   _flush,		2,	2
FIELD	_gzip_flag,	4,	4
FIELD	_internal_state,	_isal_zstate_size,	_isal_zstate_align

%assign _isal_zstream_size	_FIELD_OFFSET
%assign _isal_zstream_align	_STRUCT_ALIGN

_internal_state_b_bytes_valid		  equ   _internal_state+_b_bytes_valid
_internal_state_b_bytes_processed	 equ   _internal_state+_b_bytes_processed
_internal_state_file_start		  equ   _internal_state+_file_start
_internal_state_crc			  equ   _internal_state+_crc
_internal_state_bitbuf			  equ   _internal_state+_bitbuf
_internal_state_state			  equ   _internal_state+_state
_internal_state_count			  equ   _internal_state+_count
_internal_state_tmp_out_buff		  equ   _internal_state+_tmp_out_buff
_internal_state_tmp_out_start		  equ   _internal_state+_tmp_out_start
_internal_state_tmp_out_end		  equ   _internal_state+_tmp_out_end
_internal_state_has_wrap_hdr		  equ   _internal_state+_has_wrap_hdr
_internal_state_has_eob		  equ   _internal_state+_has_eob
_internal_state_has_eob_hdr		  equ   _internal_state+_has_eob_hdr
_internal_state_has_hist		  equ   _internal_state+_has_hist
_internal_state_buffer			  equ   _internal_state+_buffer
_internal_state_head			  equ   _internal_state+_head
_internal_state_bitbuf_m_bits		  equ   _internal_state+_bitbuf_m_bits
_internal_state_bitbuf_m_bit_count	equ   _internal_state+_bitbuf_m_bit_count
_internal_state_bitbuf_m_out_buf	  equ   _internal_state+_bitbuf_m_out_buf
_internal_state_bitbuf_m_out_end	  equ   _internal_state+_bitbuf_m_out_end
_internal_state_bitbuf_m_out_start	equ   _internal_state+_bitbuf_m_out_start
_internal_state_hist_lit_len		equ	_internal_state+_hist_lit_len
_internal_state_hist_dist		equ	_internal_state+_hist_dist

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Internal States
ZSTATE_NEW_HDR			equ	0
ZSTATE_HDR			equ	(ZSTATE_NEW_HDR + 1)
ZSTATE_CREATE_HDR		equ	(ZSTATE_HDR + 1)
ZSTATE_BODY			equ	(ZSTATE_CREATE_HDR + 1)
ZSTATE_FLUSH_READ_BUFFER	equ	(ZSTATE_BODY + 1)
ZSTATE_FLUSH_ICF_BUFFER		equ	(ZSTATE_FLUSH_READ_BUFFER + 1)
ZSTATE_TYPE0_HDR		equ	(ZSTATE_FLUSH_ICF_BUFFER + 1)
ZSTATE_TYPE0_BODY		equ	(ZSTATE_TYPE0_HDR + 1)
ZSTATE_SYNC_FLUSH		equ	(ZSTATE_TYPE0_BODY + 1)
ZSTATE_FLUSH_WRITE_BUFFER	equ	(ZSTATE_SYNC_FLUSH + 1)
ZSTATE_TRL			equ	(ZSTATE_FLUSH_WRITE_BUFFER + 1)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
_NO_FLUSH		equ 0
_SYNC_FLUSH		equ 1
_FULL_FLUSH		equ 2
_STORED_BLK		equ 0
%assign _STORED_BLK_END 65535
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
IGZIP_NO_HIST		equ 0
IGZIP_HIST		equ 1
IGZIP_DICT_HIST		equ 2

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

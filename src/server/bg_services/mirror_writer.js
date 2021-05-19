/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const _ = require('lodash');
const { ObjectId } = require('mongodb');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const auth_server = require('../common_services/auth_server');
const { MultiMarker } = require('../../util/multi_marker');
const { MDStore } = require('../object_services/md_store');
const { BucketChunksBuilder } = require('./bucket_chunks_builder');


class MirrorWriter {

    constructor({ name, client }) {
        this.name = name;
        // main scanner with node end_marker (never stops)
        // start from the given marker and iterates over chunks of given buckets
        this.mirror_scanner = null;
        // scanner to retries building of errors from previous scans
        this.retry_scanner = null;
        // start\end marker which tracks errored ranges
        this.client = client;
        this.markers_stored = Date.now();
        this.initialized = false;
    }

    async run_batch() {
        if (!this._can_run()) return;

        // mirror_scanner is created here and not the constrctor so that _get_bucket_chunks_builder
        // can be mocked in the unit tests
        if (!this.initialized) {
            this._init();
        }

        const mirrored_buckets = this._get_mirrored_buckets();
        if (!mirrored_buckets || !mirrored_buckets.length) {
            dbg.log0('no buckets with mirror policy. nothing to do');
            return config.MIRROR_WRITER_EMPTY_DELAY;
        }
        dbg.log2(`starting run batch. `);
        dbg.log2(`scan range = `, this.mirror_scanner.get_chunks_range());
        dbg.log2(`retry range = `, this.retry_scanner ? this.retry_scanner.get_chunks_range() : 'none');
        dbg.log2(`errors marker = `, this.errors_marker ? this.errors_marker.get_total_range() : 'none');
        dbg.log1('found these buckets with mirror policy:', util.inspect(mirrored_buckets));

        let scan_had_errors = false; // main scan had errors
        let retry_had_errors = false; // retry scan had errors
        let empty_scan_batch = false; // emtpy main batch
        let empty_retry_batch = false; // empty retry batch

        const bucket_ids = mirrored_buckets.map(bucket => bucket._id);

        try {
            const [scan_res, retry_res] = [await this.mirror_scanner.run_batch(bucket_ids), await this._retry_mirror(bucket_ids)];

            dbg.log1('got results: scan_res  = ', util.inspect(scan_res));
            dbg.log1('got results: retry_res = ', util.inspect(retry_res));

            // push errors to retry_errors_marker
            if (scan_res.successful) {
                // if no chunk_ids were processed, and there is no retry scanner (done on previous cycle) set empty_batch
                if (!scan_res.chunk_ids.length) empty_scan_batch = true;
            } else {
                dbg.warn('had errors on chunk_ids:', scan_res.chunk_ids);
                scan_had_errors = true;
                this._handle_build_errors(scan_res.chunk_ids);
            }

            if (retry_res.successful) {
                if (retry_res.done) {
                    empty_retry_batch = true;
                    this.retry_scanner = null;
                }
            } else {
                retry_had_errors = true;
                dbg.warn('had errors on chunk_ids:', scan_res.chunk_ids);
                this._handle_build_errors(retry_res.chunk_ids);
            }

            await this._store_markers();

            if (scan_had_errors) {
                // if main scan had errors return error delay
                return config.MIRROR_WRITER_ERROR_DELAY;
            } else if (empty_scan_batch) {
                // successful empty main batch
                if (retry_had_errors) {
                    // if main batch is empty and retry had errors, return errors
                    return config.MIRROR_WRITER_ERROR_DELAY;
                } else if (empty_retry_batch) {
                    // if both batches are empty return empty delay
                    return config.MIRROR_WRITER_EMPTY_DELAY;
                }
            }

            // return default delay
            return config.MIRROR_WRITER_BATCH_DELAY;

        } catch (err) {
            dbg.error('got error on mirror writer run_batch:', err);
            return config.MIRROR_WRITER_ERROR_DELAY;
        }


    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('MirrorWriter: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    _init() {
        // read previous markers from system store
        const start_marker = _.get(system_store.data, 'systems.0.bg_workers_info.mirror_writer_info.start_marker');
        const retry_range = _.get(system_store.data, 'systems.0.bg_workers_info.mirror_writer_info.retry_range');
        dbg.log0('starting mirror writer with start_marker = ', start_marker, 'retry_range = ', retry_range);

        // initialize the errors marker with range of previously failed chunks
        this.errors_marker = new MultiMarker(_.mapValues(retry_range, id => String(id)));

        // initialize the main scanner to start from previously stored marker
        this.mirror_scanner = this._get_bucket_chunks_builder({
            start_marker
        });

        this.initialized = true;
    }



    _iterate_chunks(start_marker, end_marker, buckets) {
        return MDStore.instance().iterate_all_chunks_in_buckets(start_marker, end_marker, buckets, config.MIRROR_WRITER_BATCH_SIZE);
    }

    _build_chunks(chunk_ids) {
        return this.client.scrubber.build_chunks({ chunk_ids }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_store.data.systems[0]._id,
                role: 'admin'
            })
        });
    }

    _retry_mirror(buckets) {
        if (!this.retry_scanner) {
            // if there isn't a retry_scanner create one if needed
            const error_range = this.errors_marker.pop_range();

            if (error_range) {
                this.retry_scanner = this._get_bucket_chunks_builder({
                    start_marker: new ObjectId(error_range.start),
                    end_marker: new ObjectId(error_range.end)
                });
            } else {
                return { successful: true, chunk_ids: [], done: true };
            }

        }
        return this.retry_scanner.run_batch(buckets);
    }


    _get_mirrored_buckets() {
        // return buckets that has at least one tier with more than 1 mirror set
        return system_store.data.buckets
            .filter(bucket =>
                _.isUndefined(bucket.deleting) &&
                bucket.tiering && bucket.tiering.tiers.some(tier => tier.tier.mirrors.length > 1))
            .map(bucket => ({
                name: bucket.name,
                _id: MDStore.instance().make_md_id(bucket._id),
            }));
    }

    _handle_build_errors(chunk_ids) {
        if (chunk_ids && chunk_ids.length) {
            const range = {
                start: String(chunk_ids[0]),
                end: String(chunk_ids[chunk_ids.length - 1])
            };
            this.errors_marker.push_range(range);
        }
    }

    _get_bucket_chunks_builder({ start_marker, end_marker }) {
        return new BucketChunksBuilder({
            iterate_chunks_func: this._iterate_chunks.bind(this),
            build_chunks_func: this._build_chunks.bind(this),
            start_marker,
            end_marker
        });
    }

    async _store_markers() {
        const now = Date.now();
        if (this._should_store_markers(now)) {
            this.markers_stored = now;
            // store current markers in system_store so we can start again later where we left 
            const retry_range_marker = new MultiMarker();
            if (this.errors_marker) {
                retry_range_marker.push_range(this.errors_marker.get_total_range());
            }
            if (this.retry_scanner) {
                retry_range_marker.push_range(this.retry_scanner.get_chunks_range());
            }

            const retry_range_str = retry_range_marker.get_total_range();

            const mirror_writer_info = _.omitBy({
                start_marker: new ObjectId(this.mirror_scanner.get_start_marker()),
                retry_range: retry_range_str && _.mapValues(retry_range_str, marker => new ObjectId(marker))
            }, _.isUndefined);
            dbg.log0(`writing markers to system store:`, mirror_writer_info);
            await this._update_markers_in_system_store(mirror_writer_info);
        }
    }

    _should_store_markers(now) {
        return now > this.markers_stored + config.MIRROR_WRITER_MARKER_STORE_PERIOD;
    }

    _update_markers_in_system_store(mirror_writer_info) {
        return system_store.make_changes({
            update: {
                systems: [{
                    _id: system_store.data.systems[0]._id,
                    'bg_workers_info.mirror_writer_info': mirror_writer_info
                }]
            }
        });
    }

}



exports.MirrorWriter = MirrorWriter;

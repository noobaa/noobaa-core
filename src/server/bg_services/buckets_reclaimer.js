/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const P = require('../../util/promise');
const auth_server = require('../common_services/auth_server');
const tier_server = require('../system_services/tier_server');

class BucketsReclaimer {

    constructor({ name, client }) {
        this.name = name;
        this.client = client;
    }

    async run_batch() {
        if (!this._can_run()) return;

        const system = system_store.data.systems[0];
        const deleting_buckets = this._get_deleting_buckets();
        if (!deleting_buckets || !deleting_buckets.length) {
            dbg.log0('no buckets in "deleting" state. nothing to do');
            return config.BUCKET_RECLAIMER_EMPTY_DELAY;
        }

        let has_errors = false;
        this._reset_delete_lists();
        dbg.log0('bucket_reclaimer: starting batch work on buckets: ', deleting_buckets.map(b => b.name).join(', '));
        await P.all(deleting_buckets.map(async bucket => {
            try {
                dbg.log0(`emptying bucket ${bucket.name}. deleting next ${config.BUCKET_RECLAIMER_BATCH_SIZE} objects`);
                const { is_empty } = await this.client.object.delete_multiple_objects_unordered({
                    bucket: bucket.name,
                    limit: config.BUCKET_RECLAIMER_BATCH_SIZE
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system._id,
                        account_id: system.owner._id,
                        role: 'admin'
                    })
                });
                if (is_empty) {
                    dbg.log0(`bucket ${bucket.name} is empty. calling delete_bucket`);
                    this._add_bucket_to_delete_lists(bucket);
                } else {
                    dbg.log0(`bucket ${bucket.name} is not empty yet`);
                }
            } catch (err) {
                dbg.error(`got error when trying to empty and delete bucket ${bucket.name} :`, err);
                has_errors = true;
            }
        }));
        if (this.buckets_to_delete.length > 0) {
            const changes = {
                remove: {
                    buckets: this.buckets_to_delete,
                    tieringpolicies: this.tiering_to_delete,
                    tiers: this.tiers_to_delete,
                },
            };
            if (this.account_updates.length > 0) {
                changes.update = {
                    accounts: this.account_updates,
                };
            }
            try {
                await system_store.make_changes(changes);
            } catch (err) {
                dbg.error(`got error when trying to update DB :`, err);
                has_errors = true;
            }
        }

        if (has_errors) {
            return config.BUCKET_RECLAIMER_ERROR_DELAY;
        }
        return config.BUCKET_RECLAIMER_BATCH_DELAY;

    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('BucketsReclaimer: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    _get_deleting_buckets() {
        // return buckets that has the deleting flag set
        return system_store.data.buckets.filter(bucket => Boolean(bucket.deleting));
    }

    _add_bucket_to_delete_lists(bucket) {
        this.buckets_to_delete.push(bucket._id);
        const tiering_policy = bucket.tiering;
        const deleting_buckets = this.buckets_to_delete.map(bucket_id => String(bucket_id));
        const associated_buckets = tier_server.get_associated_buckets(tiering_policy)
            .filter(bucket_id => !deleting_buckets.includes(String(bucket_id)));
        if (associated_buckets.length === 0) {
            this.tiering_to_delete.push(tiering_policy._id);
            this.tiers_to_delete.push(...tiering_policy.tiers.map(t => t.tier._id));
        }
        system_store.data.accounts.forEach(account => {
            if (!account.allowed_buckets || (account.allowed_buckets && account.allowed_buckets.full_permission)) return;
            if (!account.allowed_buckets.permission_list.includes(bucket)) return;
            this.account_updates.push({
                _id: account._id,
                $pullAll: {
                    'allowed_buckets.permission_list': [bucket._id]
                }
            });
        });
    }

    _reset_delete_lists() {
        this.buckets_to_delete = [];
        this.tiering_to_delete = [];
        this.tiers_to_delete = [];
        this.account_updates = [];
    }

}


exports.BucketsReclaimer = BucketsReclaimer;

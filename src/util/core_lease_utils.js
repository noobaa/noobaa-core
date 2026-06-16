/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const { EventEmitter } = require('events');
const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const { make_https_request } = require('./http_utils');
const { read_stream_join } = require('./buffer_utils');

const LEASE_API = 'coordination.k8s.io/v1';

const {
    KUBERNETES_SERVICE_HOST,
    KUBERNETES_SERVICE_PORT,
} = process.env;

/**
 * @param {string|undefined} iso_string
 * @returns {number}
 */
function parse_lease_time(iso_string) {
    if (!iso_string) return 0;
    const ms = Date.parse(iso_string);
    return Number.isFinite(ms) ? ms : 0;
}

/**
 * Formats a Date for Kubernetes Lease spec acquireTime/renewTime (metav1.MicroTime).
 * JavaScript toISOString() uses millisecond precision, the API expects microseconds.
 * @param {Date} [date]
 * @returns {string}
 */
function format_lease_time(date = new Date()) {
    return date.toISOString().replace(/\.(\d{3})Z$/, (_, ms) => `.${ms}000Z`);
}

/**
 * Returns true if the lease record has no valid holder (expired or empty renew time).
 * @param {{ spec?: { holderIdentity?: string, renewTime?: string, leaseDurationSeconds?: number } }} lease
 * @returns {boolean}
 */
function is_lease_expired(lease) {
    const spec = lease?.spec || {};
    const renew_ms = parse_lease_time(spec.renewTime);
    if (!renew_ms || !spec.leaseDurationSeconds) return true;
    return Date.now() >= renew_ms + (spec.leaseDurationSeconds * 1000);
}

/**
 * Returns true if the given holder may acquire or renew this lease according to spec.
 * @param {{ spec?: { holderIdentity?: string, renewTime?: string, leaseDurationSeconds?: number } }} lease
 * @param {string} holder
 * @returns {boolean}
 */
function is_lease_takeable(lease, holder) {
    const spec = lease?.spec || {};
    const current_holder = spec.holderIdentity;
    if (!current_holder) return true;
    if (current_holder === holder) return true;
    return is_lease_expired(lease);
}

/**
 * Returns true if the lease is currently held by the given holder identity.
 * @param {{ spec?: { holderIdentity?: string } }} lease
 * @param {string} holder
 * @returns {boolean}
 */
function is_lease_held_by(lease, holder) {
    return lease?.spec?.holderIdentity === holder;
}

/**
 * Kubernetes client for coordination.k8s.io/v1 Lease objects used by core HA.
 * Emits 'lost_leadership' when the lease is lost or the renew deadline is exceeded.
 */
class CoreLeaseClient extends EventEmitter {
    /**
     * @param {{ lease_name: string, holder: string }} options
     */
    constructor({ lease_name, holder }) {
        super();
        if (!KUBERNETES_SERVICE_HOST || !KUBERNETES_SERVICE_PORT) {
            throw new Error('CoreLeaseClient requires in-cluster Kubernetes environment variables');
        }
        this._lease_name = lease_name;
        this._holder = holder;
        this._service_host = KUBERNETES_SERVICE_HOST;
        this._service_port = KUBERNETES_SERVICE_PORT;
        this._initialized = false;
        this._stop_renew = false;
        /** @type {Promise<void>|null} */
        this._renew_loop_promise = null;
        /** @type {NodeJS.Timeout|null} */
        this._sleep_timer = null;
        /** @type {(() => void)|null} */
        this._wake_sleep = null;
    }

    async _init() {
        if (this._initialized) return;
        const token_buf = await fs.promises.readFile(config.KUBE_SA_TOKEN_FILE);
        this._sa_token = token_buf.toString('utf8').trim();
        const ns_buf = await fs.promises.readFile(config.KUBE_NAMESPACE_FILE);
        this._namespace = ns_buf.toString('utf8').trim();
        this._initialized = true;
    }

    _lease_path() {
        return `/apis/${LEASE_API}/namespaces/${this._namespace}/leases/${this._lease_name}`;
    }

    /**
     * @param {string} method
     * @param {object} [body]
     * @returns {Promise<{ status_code: number, body: object }>}
     */
    async _request(method, body) {
        await this._init();
        const response = await make_https_request({
            method,
            hostname: this._service_host,
            port: this._service_port,
            path: this._lease_path(),
            rejectUnauthorized: false,
            signal: AbortSignal.timeout(config.CORE_LEASE_REQUEST_TIMEOUT_MS),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${this._sa_token}`,
            },
        }, body && JSON.stringify(body), 'utf8');
        const buffer = await read_stream_join(response);
        const res_body = buffer.length ? JSON.parse(buffer.toString('utf8')) : {};
        return { status_code: response.statusCode, body: res_body };
    }

    /**
     * GET the lease object from the API.
     * @returns {Promise<object|null>}
     */
    async read_lease() {
        const { status_code, body } = await this._request('GET');
        if (status_code === 200) return body;
        if (status_code === 404) return null;
        throw new Error(`read lease failed status=${status_code} body=${JSON.stringify(body)}`);
    }

    /**
     * GET the lease and evaluate whether this holder may take or renew it.
     * @returns {Promise<{ lease: object|null, can_take: boolean }>}
     */
    async read_lease_state() {
        const lease = await this.read_lease();
        return {
            lease,
            can_take: Boolean(lease && is_lease_takeable(lease, this._holder)),
        };
    }

    /**
     * PUT Update the lease to take or renew it. Caller must pass the lease from read_lease_state.
     * Uses metadata.resourceVersion for optimistic concurrency.
     * @param {object} lease
     * @param {boolean} is_acquire
     * @returns {Promise<number>}
     */
    async update_lease(lease, is_acquire) {
        const duration = lease.spec?.leaseDurationSeconds;
        if (!duration) {
            throw new Error(`lease ${this._lease_name} is missing spec.leaseDurationSeconds`);
        }
        const now = format_lease_time();
        const updated = {
            ...lease,
            spec: {
                ...lease.spec,
                holderIdentity: this._holder,
                leaseDurationSeconds: duration,
                renewTime: now,
                acquireTime: (is_acquire || !lease.spec?.acquireTime) ? now : lease.spec.acquireTime,
            },
        };
        const { status_code, body } = await this._request('PUT', updated);
        if (status_code !== 200) {
            dbg.warn('lease PUT failed', this._lease_name, status_code, body);
        }
        return status_code;
    }

    /**
     * Blocks until this holder owns the lease.
     */
    async acquire_lease() {
        dbg.log0('acquiring core lease', this._lease_name, 'holder', this._holder);
        for (;;) {
            try {
                const { lease, can_take } = await this.read_lease_state();
                if (!lease) {
                    // Lease object not found — operator may not have created it yet, retry.
                    dbg.warn('core lease not found, retrying', this._lease_name);
                } else if (can_take) {
                    const status_code = await this.update_lease(lease, true);
                    if (status_code === 200) {
                        dbg.log0('acquired core lease', this._lease_name);
                        return;
                    }
                }
            } catch (err) {
                dbg.warn('acquire_lease transient error, retrying', this._lease_name, err.message);
            }
            await sleep(config.CORE_LEASE_ACQUIRE_RETRY_MS);
        }
    }

    /**
     * PUT the lease with an empty holderIdentity. Caller must pass the lease from read_lease.
     * Uses metadata.resourceVersion for optimistic concurrency.
     * @param {object} lease
     * @returns {Promise<number>}
     */
    async _put_release_lease(lease) {
        const updated = {
            ...lease,
            spec: {
                ...lease.spec,
                holderIdentity: '',
            },
        };
        const { status_code, body } = await this._request('PUT', updated);
        if (status_code !== 200) {
            dbg.warn('lease release PUT failed', this._lease_name, status_code, body);
        }
        return status_code;
    }

    /**
     * Clears this holder from the lease so another pod may acquire immediately.
     * No-op when the lease is held by another identity or is already vacant.
     */
    async release_lease() {
        dbg.log0('releasing core lease', this._lease_name, 'holder', this._holder);
        for (;;) {
            const lease = await this.read_lease();
            if (!lease) {
                throw new Error(`lease ${this._lease_name} not found in namespace ${this._namespace}`);
            }
            if (!is_lease_held_by(lease, this._holder)) {
                dbg.log0('core lease not held by us, skipping release',
                    'holder', lease.spec?.holderIdentity, 'we are', this._holder);
                return;
            }
            const status_code = await this._put_release_lease(lease);
            if (status_code === 200) {
                dbg.log0('released core lease', this._lease_name);
                return;
            }
            // Renew loop or another pod may have updated the lease between read and PUT,
            // re-read and retry.
            if (status_code === 409) {
                continue;
            }
            throw new Error(`release lease failed status=${status_code}`);
        }
    }

    /**
     * Stops the renew loop. Waits until the loop exits.
     * @returns {Promise<void>}
     */
    async stop_renew_loop() {
        if (!this._renew_loop_promise) {
            return;
        }
        this._stop_renew = true;
        this._wake_interruptible_sleep();
        await this._renew_loop_promise;
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    _interruptible_sleep(ms) {
        return new Promise(resolve => {
            this._wake_sleep = resolve;
            this._sleep_timer = setTimeout(resolve, ms);
        });
    }

    /**
     * Ends an in-progress _interruptible_sleep.
     */
    _wake_interruptible_sleep() {
        if (this._sleep_timer) {
            clearTimeout(this._sleep_timer);
            this._sleep_timer = null;
        }
        if (this._wake_sleep) {
            this._wake_sleep();
            this._wake_sleep = null;
        }
    }

    /**
     * Handles a 409 conflict after a PUT by re-reading the lease.
     * Returns true (and emits lost_leadership) if we no longer hold the lease.
     * @returns {Promise<boolean>}
     */
    async _handle_put_conflict() {
        dbg.warn('lease PUT conflict, re-reading lease', this._lease_name);
        const state = await this.read_lease_state();
        if (!state.can_take) {
            dbg.error('lost core lease after PUT conflict', this._lease_name, 'holder', state.lease?.spec?.holderIdentity, 'we are', this._holder);
            this.emit('lost_leadership');
            return true;
        }
        return false;
    }

    /**
     * Renews until stop_renew_loop is called or leadership is lost.
     * Emits 'lost_leadership' when the lease is taken by another pod or the renew deadline is exceeded.
     */
    async renew_lease_loop() {
        this._stop_renew = false;
        /** @type {(value?: void) => void} */
        let loop_done;
        this._renew_loop_promise = new Promise(resolve => {
            loop_done = resolve;
        });

        try {
            dbg.log0('starting core lease renew loop', this._lease_name);
            let last_successful_renew_ms = Date.now();
            while (!this._stop_renew) {
                // lease is about to expire, step down
                if (this._is_renew_deadline_exceeded(last_successful_renew_ms)) {
                    dbg.error('renew deadline exceeded, shutting down pod', this._lease_name);
                    this.emit('lost_leadership');
                    return;
                }
                let sleep_ms = config.CORE_LEASE_RENEW_ERROR_SLEEP_MS;
                try {
                    const { lease, can_take } = await this.read_lease_state();
                    if (!lease || !can_take) {
                        // another pod acquired the lease or lease was deleted, step down
                        dbg.error('lost core lease, shutting down pod', this._lease_name, 'holder', lease?.spec?.holderIdentity, 'we are', this._holder);
                        this.emit('lost_leadership');
                        return;
                    }
                    const status_code = await this.update_lease(lease, false);
                    if (status_code === 200) {
                        last_successful_renew_ms = Date.now();
                        sleep_ms = config.CORE_LEASE_ACQUIRE_RETRY_MS;
                    } else if (status_code === 409) {
                        if (await this._handle_put_conflict()) return;
                    } else {
                        dbg.warn('lease PUT failed, retrying', this._lease_name, status_code);
                    }
                } catch (err) {
                    dbg.warn('renew_lease_loop transient error, retrying', this._lease_name, err.message);
                }
                if (this._stop_renew) {
                    break;
                }
                await this._interruptible_sleep(sleep_ms);
            }
        } finally {
            this._wake_interruptible_sleep();
            loop_done();
            this._renew_loop_promise = null;
        }
    }

    /**
     * Returns true when too long has passed since the last successful renew.
     * Step down in this case to avoid split brain if we can no longer refresh the lease.
     * @param {number} last_successful_renew_ms
     * @returns {boolean}
     */
    _is_renew_deadline_exceeded(last_successful_renew_ms) {
        return Date.now() - last_successful_renew_ms > config.CORE_LEASE_RENEW_DEADLINE_MS;
    }

}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @returns {boolean}
 */
function is_core_lease_enabled() {
    return Boolean(process.env.NOOBAA_CORE_LEASE_NAME);
}

/**
 * @returns {CoreLeaseClient}
 */
function create_client_from_env() {
    const lease_name = process.env.NOOBAA_CORE_LEASE_NAME;
    if (!lease_name) {
        throw new Error('NOOBAA_CORE_LEASE_NAME is not set');
    }
    const holder = process.env.HOSTNAME;
    if (!holder) {
        throw new Error('HOSTNAME is required for core lease holder identity');
    }
    return new CoreLeaseClient({ lease_name, holder });
}

// export classes and functions for use in other modules
exports.CoreLeaseClient = CoreLeaseClient;
exports.create_client_from_env = create_client_from_env;
exports.is_core_lease_enabled = is_core_lease_enabled;

// export helper functions for testing only
exports.parse_lease_time = parse_lease_time;
exports.format_lease_time = format_lease_time;
exports.is_lease_expired = is_lease_expired;
exports.is_lease_takeable = is_lease_takeable;
exports.is_lease_held_by = is_lease_held_by;

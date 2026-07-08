/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const { EventEmitter } = require('events');
const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const { make_https_request } = require('./http_utils');
const { read_stream_join } = require('./buffer_utils');
const { randomUUID } = require('crypto');

const LEASE_API = 'coordination.k8s.io/v1';

const {
    KUBERNETES_SERVICE_HOST,
    KUBERNETES_SERVICE_PORT,
} = process.env;

/**
 * Named events emitted by LeaderElector.
 */
const EVENTS = {
    LEADERSHIP_ACQUIRED: 'leadership_acquired',
    LEADERSHIP_LOST: 'leadership_lost',
};

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
 * @param {number} [observed_change_ms] local clock time when we last saw the lease record change.
 *   Falls back to spec.renewTime when not provided.
 * @returns {boolean}
 */
function is_lease_expired(lease, observed_change_ms = 0) {
    const spec = lease?.spec || {};
    if (!spec.leaseDurationSeconds) return true;
    const reference_ms = observed_change_ms || parse_lease_time(spec.renewTime);
    if (!reference_ms) return true;
    return Date.now() >= reference_ms + (spec.leaseDurationSeconds * 1000);
}

/**
 * Returns true if the given holder may acquire or renew this lease according to spec.
 * @param {{ spec?: { holderIdentity?: string, renewTime?: string, leaseDurationSeconds?: number } }} lease
 * @param {string} holder
 * @param {number} [observed_change_ms] local clock time when we last saw the lease record change (clock-skew-safe)
 * @returns {boolean}
 */
function is_lease_takeable(lease, holder, observed_change_ms = 0) {
    const spec = lease?.spec || {};
    const current_holder = spec.holderIdentity;
    if (!current_holder) return true;
    if (current_holder === holder) return true;
    return is_lease_expired(lease, observed_change_ms);
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
 * Leader elector backed by a Kubernetes coordination.k8s.io/v1 Lease.
 * Emits EVENTS.LEADERSHIP_ACQUIRED when the lease is acquired and
 * EVENTS.LEADERSHIP_LOST when the lease is lost or the renew deadline is exceeded.
 * LeaderElector instances configured with the same lease name form a coordination group
 * in which one, and only one, instance can be considered the leader at a time.
 */
class LeaderElector extends EventEmitter {
    /**
     * @param {{ lease_name: string, holder: string }} options
     */
    constructor({ lease_name, holder }) {
        super();
        if (!KUBERNETES_SERVICE_HOST || !KUBERNETES_SERVICE_PORT) {
            throw new Error('LeaderElector requires in-cluster Kubernetes environment variables');
        }
        this._lease_name = lease_name;
        this._holder = holder;
        this._service_host = KUBERNETES_SERVICE_HOST;
        this._service_port = KUBERNETES_SERVICE_PORT;
        this._initialized = false;
        this._stop_requested = false;
        /** @type {number} lease duration in ms, set from the live lease spec at acquire time */
        this._lease_duration_ms = 0;
        /** @type {string|null} last resourceVersion we observed from the API */
        this._observed_resource_version = null;
        /** @type {number} local clock ms when we last saw the lease record change (clock-skew protection) */
        this._observed_change_ms = 0;
        /** @type {Promise<void>|null} */
        this._running_promise = null;
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
        if (status_code === 200) {
            const resource_version = body.metadata?.resourceVersion;
            if (resource_version !== this._observed_resource_version) {
                // Pod clocks can differ, so takeover uses our local observation time as the expiry baseline.
                // This may delay takeover slightly, but avoids taking the lease too early.
                // Renew uses last_successful_renew_ms instead.
                this._observed_resource_version = resource_version;
                this._observed_change_ms = Date.now();
            }
            return body;
        }
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
            can_take: Boolean(lease && is_lease_takeable(lease, this._holder, this._observed_change_ms)),
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
     * Acquires the lease, emits EVENTS.LEADERSHIP_ACQUIRED, then starts the renew loop in the background.
     * Emits EVENTS.LEADERSHIP_LOST if the lease is lost during the renew loop.
     * Call stop() to release the lease and stop any active phase cleanly.
     */
    async start() {
        this._stop_requested = false;
        await this.acquire_lease();
        if (this._stop_requested) return;
        this.emit(EVENTS.LEADERSHIP_ACQUIRED);
        this.renew_lease_loop().catch(err => {
            dbg.error('renew_lease_loop unexpected error', this._lease_name, err.message);
            this.emit(EVENTS.LEADERSHIP_LOST);
        });
    }

    /**
     * Stops any running acquire or renew phase and releases the lease.
     */
    async stop() {
        await this.stop_running();
        await this.release_lease();
    }

    /**
     * Blocks until this holder owns the lease, or returns early if stop_running() is called.
     */
    async acquire_lease() {
        /** @type {(value?: void) => void} */
        let done;
        this._running_promise = new Promise(resolve => { done = resolve; });
        try {
            dbg.log0('acquiring core lease', this._lease_name, 'holder', this._holder);
            while (!this._stop_requested) {
                try {
                    const { lease, can_take } = await this.read_lease_state();
                    if (!lease) {
                        // Lease object not found — operator may not have created it yet, retry.
                        dbg.warn('core lease not found, retrying', this._lease_name);
                    } else if (can_take) {
                        const status_code = await this.update_lease(lease, true);
                        if (status_code === 200) {
                            this._lease_duration_ms = (lease.spec?.leaseDurationSeconds ?? 0) * 1000;
                            dbg.log0('acquired core lease', this._lease_name,
                                'duration', this._lease_duration_ms, 'ms',
                                'renew deadline', this._get_renew_deadline_ms(), 'ms');
                            return;
                        }
                    }
                } catch (err) {
                    dbg.warn('acquire_lease transient error, retrying', this._lease_name, err.message);
                }
                if (this._stop_requested) return;
                await this._interruptible_sleep(config.CORE_LEASE_ACQUIRE_RETRY_MS);
            }
        } finally {
            done();
            this._running_promise = null;
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
        try {
            const lease = await this.read_lease();
            if (!lease) {
                dbg.warn('core lease not found during release', this._lease_name);
                return;
            }
            if (!is_lease_held_by(lease, this._holder)) {
                dbg.log0('core lease not held by us, skipping release',
                    'holder', lease.spec?.holderIdentity, 'we are', this._holder);
                return;
            }
            const status_code = await this._put_release_lease(lease);
            if (status_code === 200) {
                dbg.log0('released core lease', this._lease_name);
            } else {
                dbg.warn('core lease release failed, lease will expire naturally',
                    this._lease_name, 'status', status_code);
            }
        } catch (err) {
            dbg.warn('core lease release error, lease will expire naturally',
                this._lease_name, err.message);
        }
    }

    /**
     * Signals any running acquire or renew phase to stop and waits for it to exit.
     * Safe to call when nothing is running.
     * @returns {Promise<void>}
     */
    async stop_running() {
        this._stop_requested = true;
        this._wake_interruptible_sleep();
        if (!this._running_promise) return;
        await this._running_promise;
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
     * Returns true (and emits EVENTS.LEADERSHIP_LOST) if we no longer hold the lease.
     * @returns {Promise<boolean>}
     */
    async _handle_put_conflict() {
        dbg.warn('lease PUT conflict, re-reading lease', this._lease_name);
        const state = await this.read_lease_state();
        if (!state.can_take) {
            dbg.error('lost core lease after PUT conflict', this._lease_name, 'holder', state.lease?.spec?.holderIdentity, 'we are', this._holder);
            this.emit(EVENTS.LEADERSHIP_LOST);
            return true;
        }
        return false;
    }

    /**
     * Renews until stop_running() is called or leadership is lost.
     * Emits EVENTS.LEADERSHIP_LOST when the lease is taken by another pod or the renew deadline is exceeded.
     */
    async renew_lease_loop() {
        this._stop_requested = false;
        /** @type {(value?: void) => void} */
        let loop_done;
        this._running_promise = new Promise(resolve => {
            loop_done = resolve;
        });

        try {
            dbg.log0('starting core lease renew loop', this._lease_name);
            let last_successful_renew_ms = Date.now();
            while (!this._stop_requested) {
                // lease is about to expire, step down
                if (this._is_renew_deadline_exceeded(last_successful_renew_ms)) {
                    dbg.error('renew deadline exceeded, leadership lost', this._lease_name);
                    this.emit(EVENTS.LEADERSHIP_LOST);
                    return;
                }
                let sleep_ms = config.CORE_LEASE_RENEW_ERROR_SLEEP_MS;
                try {
                    const { lease, can_take } = await this.read_lease_state();
                    if (!lease || !can_take) {
                        // another pod acquired the lease or lease was deleted, step down
                        dbg.error('lost core lease to another holder, leadership lost', this._lease_name, 'holder', lease?.spec?.holderIdentity, 'we are', this._holder);
                        this.emit(EVENTS.LEADERSHIP_LOST);
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
                if (this._stop_requested) break;
                await this._interruptible_sleep(sleep_ms);
            }
        } finally {
            this._wake_interruptible_sleep();
            loop_done();
            this._running_promise = null;
        }
    }

    /**
     * Computes the renew deadline from the live lease duration and timing constants.
     * deadline = leaseDuration - CORE_LEASE_RENEW_ERROR_SLEEP_MS - CORE_LEASE_REQUEST_TIMEOUT_MS - LEASE_RENEW_DEADLINE_MARGIN_MS
     * @returns {number} deadline in ms
     */
    _get_renew_deadline_ms() {
        return this._lease_duration_ms -
            config.CORE_LEASE_RENEW_ERROR_SLEEP_MS -
            config.CORE_LEASE_REQUEST_TIMEOUT_MS -
            config.LEASE_RENEW_DEADLINE_MARGIN_MS;
    }

    /**
     * Returns true when too long has passed since the last successful renew.
     * Step down in this case to avoid split brain if we can no longer refresh the lease.
     * @param {number} last_successful_renew_ms
     * @returns {boolean}
     */
    _is_renew_deadline_exceeded(last_successful_renew_ms) {
        return Date.now() - last_successful_renew_ms > this._get_renew_deadline_ms();
    }

}

/**
 * @returns {boolean}
 */
function is_core_lease_enabled() {
    return Boolean(process.env.NOOBAA_CORE_LEASE_NAME);
}

/**
 * @returns {LeaderElector}
 */
function create_elector_from_env() {
    const lease_name = process.env.NOOBAA_CORE_LEASE_NAME;
    if (!lease_name) {
        throw new Error('NOOBAA_CORE_LEASE_NAME is not set');
    }
    const holder = `${process.env.HOSTNAME}_${randomUUID()}`;
    return new LeaderElector({ lease_name, holder });
}

// export classes and functions for use in other modules
exports.EVENTS = EVENTS;
exports.LeaderElector = LeaderElector;
exports.create_elector_from_env = create_elector_from_env;
exports.is_core_lease_enabled = is_core_lease_enabled;

// export helper functions for testing only
exports.parse_lease_time = parse_lease_time;
exports.format_lease_time = format_lease_time;
exports.is_lease_expired = is_lease_expired;
exports.is_lease_takeable = is_lease_takeable;
exports.is_lease_held_by = is_lease_held_by;

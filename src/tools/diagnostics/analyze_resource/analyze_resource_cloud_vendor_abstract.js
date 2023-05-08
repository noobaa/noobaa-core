/* Copyright (C) 2023 NooBaa */
'use strict';

/**
 * Abstract Class CloudVendor.
 * We use this class to enforce the CloudVendor derived classed to create these methods.
 * We use prefix '_' in the name of the parameters since we do not use them (we need them for the method signature).
 * @class CloudVendor
 */
class CloudVendor {
    static MAX_KEYS = 5; //arbitrary number, just wanted a small amount of keys

    constructor() {
        if (this.constructor === CloudVendor) {
            throw new Error("Abstract classes can't be instantiated.");
        }
    }

    async list_objects(_bucket) {
        throw new Error("Method 'async list_objects(bucket)' must be implemented.");
    }

    /**
     * Must be used only after list_objects.
     * @returns {Promise<string>}
     */
    async get_key() {
        throw new Error("Method 'async get_key()' must be implemented.");
    }

    async head_object(_bucket, _key) {
        throw new Error("Method 'async head_object(bucket, key)' must be implemented.");
    }

    async write_object(_bucket, _key) {
        throw new Error("Method 'async write_object(bucket, key)' must be implemented.");
    }

    async delete_object(_bucket, _key) {
        throw new Error("Method 'async delete_object(bucket, key' must be implemented.");
    }
}

// EXPORTS
module.exports = CloudVendor;

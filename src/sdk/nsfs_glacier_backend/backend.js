/* Copyright (C) 2024 NooBaa */
'use strict';

const nb_native = require('../../util/nb_native');

class GlacierBackend {
    // These names start with the word 'timestamp' so as to assure
    // that it acts like a 'namespace' for the these kind of files.
    //
    // It also helps in making sure that the persistent logger does not
    // confuses these files with the WAL files.
    static MIGRATE_TIMESTAMP_FILE = 'migrate.timestamp';
    static RESTORE_TIMESTAMP_FILE = 'restore.timestamp';
    static EXPIRY_TIMESTAMP_FILE = 'expiry.timestamp';

    /**
     * XATTR_RESTORE_REQUEST is set to a NUMBER (expiry days) by `restore_object` when 
     * a restore request is made. This is unset by the underlying restore process when 
     * it picks up the request, this  is to ensure that the same object is not queued 
     * for restoration multiple times.
     */
    static XATTR_RESTORE_REQUEST = 'user.noobaa.restore.request';

    /**
     * XATTR_RESTORE_EXPIRY is set to a ISO DATE by the underlying restore process or by
     * NooBaa (in case restore is issued again while the object is on disk).
     * This is read by the underlying "disk evict" process to determine if the object
     * should be evicted from the disk or not.
     * 
     * NooBaa will use this date to determine if the object is on disk or not, if the
     * expiry date is in the future, the object is on disk, if the expiry date is in
     * the past, the object is not on disk. This may or may not represent the actual
     * state of the object on disk, but is probably good enough for NooBaa's purposes
     * assuming that restore request for already restored objects fails gracefully.
     */
    static XATTR_RESTORE_EXPIRY = 'user.noobaa.restore.expiry';


    /**
     * XATTR_RESTORE_ONGOING is set to a BOOL by the underlying restore process when it picks up
     * a restore request. This is unset by the underlying restore process when it finishes
     * restoring the object.
     */
    static XATTR_RESTORE_ONGOING = 'user.noobaa.restore.ongoing';

    /**
     * XATTR_RESTORE_REQUEST_STAGED is set to the same valuue as XATTR_RESTORE_REQUEST
     * by a backend as a means to mark the request to be in-flight.
     * 
     * Any backend needs to make sure that both the attributes shall NOT be set at the same
     * time.
     */
    static XATTR_RESTORE_REQUEST_STAGED = 'user.noobaa.restore.request.staged';

    static STORAGE_CLASS_XATTR = 'user.storage_class';

    static MIGRATE_WAL_NAME = 'migrate';
    static RESTORE_WAL_NAME = 'restore';

    /**
     * migrate must take a file name which will have newline seperated
     * entries of filenames which needs to be migrated to GLACIER and
     * should perform migration of those files if feasible.
     * 
     * The function should return false if it needs the log file to be
     * preserved.
     * 
     * NOTE: This needs to be implemented by each backend.
     * @param {nb.NativeFSContext} fs_context
     * @param {string} log_file log filename
     * @returns {Promise<boolean>}
     */
    async migrate(fs_context, log_file) {
        throw new Error('Unimplementented');
    }

    /**
     * restore must take a file name which will have newline seperated
     * entries of filenames which needs to be restored from GLACIER and
     * should perform restore of those files if feasible
     * 
     * The function should return false if it needs the log file to be
     * preserved.
     * 
     * NOTE: This needs to be implemented by each backend.
     * @param {nb.NativeFSContext} fs_context
     * @param {string} log_file log filename
     * @returns {Promise<boolean>}
     */
    async restore(fs_context, log_file) {
        throw new Error('Unimplementented');
    }

    /**
     * expiry moves the restored files back to glacier
     * 
     * NOTE: This needs to be implemented by each backend.
     * @param {nb.NativeFSContext} fs_context
     */
    async expiry(fs_context) {
        throw new Error('Unimplementented');
    }

    /**
     * low_free_space must return true if the backend has
     * low free space.
     * 
     * NOTE: This may be used as a precheck before executing
     * operations like `migrate` and `restore`.
     * 
     * Example: `migrate` can be more frequently if this function
     * returns `true`.
     * 
     * @returns {Promise<boolean>}
     */
    async low_free_space() {
        throw new Error('Unimplementented');
    }

    /**
     * should_migrate returns true if the given file must be migrated
     * 
     * The caller can pass the stat data, if none is passed, stat is
     * called internally.
     * @param {string} file name of the file
     * @param {nb.NativeFSStats} [stat]
     * @returns {Promise<boolean>}
     */
    async should_migrate(fs_context, file, stat) {
        if (!stat) {
            stat = await nb_native().fs.stat(fs_context, file, {
                xattr_get_keys: [
                    GlacierBackend.XATTR_RESTORE_REQUEST,
                    GlacierBackend.XATTR_RESTORE_EXPIRY,
                    GlacierBackend.XATTR_RESTORE_REQUEST_STAGED,
                    GlacierBackend.STORAGE_CLASS_XATTR,
                ],
            });
        }

        // How can this happen?
        // 1. User uploads an item with GLACIER storage class
        // 2. It gets logged into the WAL because of storage class
        // 3. User uploads again without specifying storage class
        if (stat.xattr[GlacierBackend.STORAGE_CLASS_XATTR] !== 'GLACIER') {
            return false;
        }

        // If any of the these extended attributes are set then that means that this object was
        // marked for restore or has been restored, skip migration of these or else will result
        // in races
        if (
            stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST] ||
            stat.xattr[GlacierBackend.XATTR_RESTORE_EXPIRY] ||
            stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST_STAGED]) {
            return false;
        }

        // If there are no associated blocks with the file then skip
        // the migration.
        if (stat.blocks === 0) return false;

        return true;
    }

    /**
     * should_restore returns true if the give file must be restored
     * 
     * The caller can pass the stat data, if none is passed, stat is
     * called internally.
     * @param {string} file name of the file
     * @param {nb.NativeFSStats} [stat]
     * @returns {Promise<boolean>}
     */
    async should_restore(fs_context, file, stat) {
        if (!stat) {
            stat = await nb_native().fs.stat(fs_context, file, {
                xattr_get_keys: [
                    GlacierBackend.XATTR_RESTORE_REQUEST,
                    GlacierBackend.XATTR_RESTORE_REQUEST_STAGED,
                ],
            });
        }

        // Can happen if the file was uploaded again to `STANDARD` storage class
        if (!stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST] && !stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST_STAGED]) {
            return false;
        }

        return true;
    }
}

exports.GlacierBackend = GlacierBackend;

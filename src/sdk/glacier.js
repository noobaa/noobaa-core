/* Copyright (C) 2024 NooBaa */
'use strict';

const nb_native = require('../util/nb_native');
const s3_utils = require('../endpoint/s3/s3_utils');
const { round_up_to_next_time_of_day } = require('../util/time_utils');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');

class Glacier {
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
     * it finishes the request, this  is to ensure that the same object is not queued
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

    static STORAGE_CLASS_XATTR = 'user.storage_class';

    /**
     * GPFS_DMAPI_XATTR_TAPE_INDICATOR if set on a file indicates that the file is on tape.
     *
     * NOTE: The existence of the xattr only indicates if a copy of the file is on the tape
     * or not, it doesn't tell the file state (premigrated, etc.).
     */
    static GPFS_DMAPI_XATTR_TAPE_INDICATOR = 'dmapi.IBMObj';

    /**
     * GPFS_DMAPI_XATTR_TAPE_PREMIG if set indicates if a file is not only on tape but is
     * also in premigrated state (that is a copy of the file exists on the disk as well).
     */
    static GPFS_DMAPI_XATTR_TAPE_PREMIG = 'dmapi.IBMPMig';

    static MIGRATE_WAL_NAME = 'migrate';
    static RESTORE_WAL_NAME = 'restore';

    /** @type {nb.RestoreState} */
    static RESTORE_STATUS_CAN_RESTORE = 'CAN_RESTORE';
    /** @type {nb.RestoreState} */
    static RESTORE_STATUS_ONGOING = 'ONGOING';
    /** @type {nb.RestoreState} */
    static RESTORE_STATUS_RESTORED = 'RESTORED';

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
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>}
     */
    async migrate(fs_context, log_file, failure_recorder) {
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
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>}
     */
    async restore(fs_context, log_file, failure_recorder) {
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
     * @param {nb.NativeFSContext} fs_context
     * @param {string} file name of the file
     * @param {nb.NativeFSStats} [stat]
     * @returns {Promise<boolean>}
     */
    async should_migrate(fs_context, file, stat) {
        if (!stat) {
            stat = await nb_native().fs.stat(fs_context, file, {
                xattr_get_keys: [
                    Glacier.XATTR_RESTORE_REQUEST,
                    Glacier.XATTR_RESTORE_EXPIRY,
                    Glacier.STORAGE_CLASS_XATTR,
                ],
            });
        }

        // If there are no associated blocks with the file then skip
        // the migration.
        if (stat.blocks === 0) return false;

        const restore_status = Glacier.get_restore_status(stat.xattr, new Date(), file);
        if (!restore_status) return false;

        return restore_status.state === Glacier.RESTORE_STATUS_CAN_RESTORE;
    }

    /**
     * get_restore_status returns status of the object at the given
     * file_path
     *
     * NOTE: Returns undefined if `user.storage_class` attribute is not
     * `GLACIER`
     * @param {nb.NativeFSXattr} xattr
     * @param {Date} now
     * @param {string} file_path
     * @returns {nb.RestoreStatus | undefined}
     */
    static get_restore_status(xattr, now, file_path) {
        const storage_class = Glacier.storage_class_from_xattr(xattr);
        if (storage_class !== s3_utils.STORAGE_CLASS_GLACIER) {
            return;
        }

        if (Glacier.is_externally_managed(xattr)) {
            if (xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_PREMIG]) {
                const premig_expiry = new Date();
                // we do not know for how long the file is going to remain available,
                // the expiry is set to now + fixed config, which means it's always appears
                // to the user with the same amount of time left before it expires.
                premig_expiry.setDate(premig_expiry.getDate() + config.NSFS_GLACIER_DMAPI_PMIG_DAYS);

                return {
                    state: Glacier.RESTORE_STATUS_RESTORED,
                    ongoing: false,
                    expiry_time: premig_expiry,
                };
            }
        }

        // Total 6 states (2x restore_request, 3x restore_expiry)
        let restore_request;
        let restore_expiry;

        const restore_request_xattr = xattr[Glacier.XATTR_RESTORE_REQUEST];
        if (restore_request_xattr) {
            const num = Number(restore_request_xattr);
            if (!isNaN(num) && num > 0) {
                restore_request = num;
            } else {
                dbg.error('unexpected value for restore request for', file_path);
            }
        }
        if (xattr[Glacier.XATTR_RESTORE_EXPIRY]) {
            const expiry = new Date(xattr[Glacier.XATTR_RESTORE_EXPIRY]);
            if (isNaN(expiry.getTime())) {
                dbg.error('unexpected value for restore expiry for', file_path);
            } else {
                restore_expiry = expiry;
            }
        }

        if (restore_request) {
            if (restore_expiry > now) {
                dbg.warn('unexpected restore state - (restore_request, request_expiry > now) for', file_path);
            }

            return {
                ongoing: true,
                state: Glacier.RESTORE_STATUS_ONGOING,
            };
        } else {
            if (!restore_expiry || restore_expiry <= now) {
                return {
                    ongoing: false,
                    state: Glacier.RESTORE_STATUS_CAN_RESTORE,
                };
            }

            if (config.NSFS_GLACIER_USE_DMAPI && !xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_PREMIG]) {
                dbg.warn(
                    'NooBaa object state for file:', file_path,
                    'diverged from actual file state - file not on disk',
                    'allowing transparent read to converge file states'
                );
            }

            return {
                ongoing: false,
                expiry_time: restore_expiry,
                state: Glacier.RESTORE_STATUS_RESTORED,
            };
        }
    }

    /**
     * @param {Date} from
     * @param {Number} days - float
     * @param {string} desired_date_time - in format HH:MM:SS
     * @param {'UTC' | 'LOCAL'} tz
     * @returns {Date}
     */
    static generate_expiry(from, days, desired_date_time, tz) {
        const expires_on = new Date(from);
        expires_on.setTime(expires_on.getTime() + (days * 24 * 60 * 60 * 1000));

        const parsed = desired_date_time.split(':');
        if (parsed.length === 3) {
            let hours = 0;
            let mins = 0;
            let secs = 0;

            const parsed_hrs = Number(parsed[0]);
            if (Number.isInteger(parsed_hrs) && parsed_hrs < 24) {
                hours = parsed_hrs;
            }

            const parsed_mins = Number(parsed[1]);
            if (Number.isInteger(parsed_mins) && parsed_mins < 60) {
                mins = parsed_mins;
            }

            const parsed_secs = Number(parsed[2]);
            if (Number.isInteger(parsed_secs) && parsed_secs < 60) {
                secs = parsed_secs;
            }

            round_up_to_next_time_of_day(expires_on, hours, mins, secs, tz);
        }

        return expires_on;
    }

    /**
     * should_restore returns true if the give file must be restored
     *
     * The caller can pass the stat data, if none is passed, stat is
     * called internally.
     * @param {nb.NativeFSContext} fs_context
     * @param {string} file name of the file
     * @param {nb.NativeFSStats} [stat]
     * @returns {Promise<boolean>}
     */
    static async should_restore(fs_context, file, stat) {
        if (!stat) {
            stat = await nb_native().fs.stat(fs_context, file, {
                xattr_get_keys: [
                    Glacier.XATTR_RESTORE_REQUEST,
                    Glacier.STORAGE_CLASS_XATTR,
                ],
            });
        }

        const restore_status = Glacier.get_restore_status(stat.xattr, new Date(), file);
        if (!restore_status) return false;

        // We don't check for pre-existing expiry here, it can happen in 2 cases
        // 1. A restore is already going and someone somehow initiated this second
        // call. In that case we might see partial extended attributes such that
        // both request as well a future expiry time exists.
        // 2. A restore request was partially processed and then failed before
        // removing the request extended attribute. In such case, NSFS would still
        // report the object restore status to be `ONGOING` and we are going
        // to allow a retry of that entry.
        return restore_status.state === Glacier.RESTORE_STATUS_ONGOING;
    }

    /**
     * storage_class_from_xattr returns a parsed storage class derived from the given
     * extended attribute. It will use DMAPI EA if `use_dmapi` is set to true.
     *
     * NOTE: For `use_dmapi` to work, the xattr must have been retrieved using fs_context
     * where backend is set to 'GPFS'.
     *
     * @param {nb.NativeFSXattr} xattr
     * @param {Boolean} [use_dmapi]
     * @returns {nb.StorageClass}
     */
   static storage_class_from_xattr(xattr, use_dmapi = config.NSFS_GLACIER_USE_DMAPI) {
        if (
            use_dmapi &&
            xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_INDICATOR] &&
            xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_INDICATOR] !== ''
        ) {
            return s3_utils.STORAGE_CLASS_GLACIER;
        }

        return s3_utils.parse_storage_class(xattr[Glacier.STORAGE_CLASS_XATTR]);
    }

    /**
     * is_externally_managed returns true if given extended attributes
     * have tape indicator on them or not (only if `NSFS_GLACIER_USE_DMAPI`
     * is set to true) and the storage class xattr is empty (ie none assigned
     * by NooBaa).
     *
     * @param {nb.NativeFSXattr} xattr
     * @returns {boolean}
     */
    static is_externally_managed(xattr) {
        return Boolean(
            config.NSFS_GLACIER_USE_DMAPI &&
            !xattr[Glacier.STORAGE_CLASS_XATTR] &&
            (
                xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_INDICATOR] ||
                xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_PREMIG]
            )
        );
    }

    /**
     * getBackend returns appropriate backend for the provided type
     * @param {string} [typ]
     * @returns {Glacier}
     */
    static getBackend(typ = config.NSFS_GLACIER_BACKEND) {
        switch (typ) {
            case 'TAPECLOUD': return new (require('./glacier_tapecloud').TapeCloudGlacier)();
            default:
                throw new Error('invalid backend type provided');
        }
    }
}

exports.Glacier = Glacier;

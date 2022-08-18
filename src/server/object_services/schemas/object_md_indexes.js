/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [

    // TODO index ??? find_objects() not indexed for the create_time

    {
        // find_object_latest()
        // list_objects()
        fields: {
            bucket: 1,
            key: 1,
            // For MONGO deployments - we include version_past as extra index field to separate from null_version_index.
            // note that version_past is always null here by partialFilterExpression.
            ...(process.env.DB_TYPE === 'postgres' ? {} : { version_past: 1 })
        },
        options: {
            name: 'latest_version_index',
            unique: true,
            partialFilterExpression: {
                deleted: null,
                upload_started: null,
                version_past: null,
            }
        }
    },


    //////////////
    // VERSIONS //
    //////////////

    {
        // find_object_null_version()
        fields: {
            bucket: 1,
            key: 1,
            // For MONGO deployments - we include version_enabled as extra index field to separate from latest_version_index.
            // note that version_enabled is always null here by partialFilterExpression.
            ...(process.env.DB_TYPE === 'postgres' ? {} : { version_enabled: 1 })
        },
        options: {
            name: 'null_version_index',
            unique: true,
            partialFilterExpression: {
                deleted: null,
                upload_started: null,
                version_enabled: null,
            }
        }
    },

    {
        // find_object_by_version()
        // find_object_prev_version()
        // list_object_versions()       
        // has_any_completed_objects_in_bucket()
        fields: {
            bucket: 1,
            key: 1,
            version_seq: -1,
        },
        options: {
            name: 'version_seq_index',
            unique: true,
            partialFilterExpression: {
                deleted: null,
                upload_started: null,
            }
        }
    },


    /////////////
    // UPLOADS //
    /////////////

    {
        // list_uploads()
        fields: {
            bucket: 1,
            key: 1,
            upload_started: 1, // equals to _id for uploads
        },
        options: {
            name: 'upload_index',
            unique: true,
            partialFilterExpression: {
                deleted: null,
                upload_started: { $exists: true }
            }
        }
    },



    ///////////////////////////
    // MD AGGREGATOR INDEXES //
    ///////////////////////////

    {
        // aggregate_objects_by_create_dates()
        fields: {
            create_time: 1,
        },
        options: {
            unique: false,
            name: "aggregate_by_create_dates",
            partialFilterExpression: {
                create_time: { $exists: true }
            }
        }
    },
    {
        // aggregate_objects_by_delete_dates()
        fields: {
            deleted: 1,
        },
        options: {
            unique: false,
            name: "aggregate_by_delete_dates",
            partialFilterExpression: {
                deleted: { $exists: true }
            }
        }
    },



    ////////////////////////
    // BUCKET AGGREGATION //
    ////////////////////////

    {
        // TODO index ??? count_objects_of_bucket()
        // TODO index ??? count_objects_per_bucket()
        fields: {
            bucket: 1,
        },
        options: {
            unique: false,
            partialFilterExpression: {
                deleted: null,
            }
        }
    },

    //////////////////////
    // OBJECT RECLAIMER //
    //////////////////////

    {
        fields: {
            deleted: 1,
            // we include reclaimed as extra index field to separate from aggregate_objects_by_delete_dates index.
            // note that reclaimed is always null here by partialFilterExpression.
            reclaimed: 1
        },
        options: {
            name: 'deleted_unreclaimed_index',
            unique: false,
            partialFilterExpression: {
                deleted: { $exists: true },
                reclaimed: null
            }
        }
    },
];

/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [
    // TODO index ??? update_objects_by_key_deleted()
    // TODO index ??? find_objects() not indexed for the create_time
    // TODO index ??? has_any_completed_objects_in_bucket()
    // TODO index ??? count_objects_of_bucket()
    // TODO index ??? list_all_objects_of_bucket_ordered_by_key()
    // TODO index ??? has_any_completed_objects_in_bucket() 
    {
        // find_object_null_version()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is used since we cannot create same field indexes
            null_object: 1,
        },
        options: {
            name: 'null_object_index',
            unique: true,
            partialFilterExpression: {
                has_version: true,
                upload_started: null
            }
        }
    },
    {
        // find_object_by_version()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is used since we cannot create same field indexes
            version_object: 1,
        },
        options: {
            name: 'version_object_index',
            unique: true,
            partialFilterExpression: {
                version_id: { $exists: true },
            }
        }
    },
    {
        // update_object_by_key()
        // find_object_latest()
        // list_objects()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is used since we cannot create same field indexes
            latest_object: 1,
        },
        options: {
            name: 'latest_object_index',
            unique: true,
            partialFilterExpression: {
                is_obj_version: null,
                upload_started: null
            }
        }
    },
    {
        // find_object_prev_version()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
            version_id: -1
        },
        options: {
            name: 'prev_object_index',
            unique: true,
            partialFilterExpression: {
                is_obj_version: true,
                upload_started: null
            }
        }
    },
    {
        // list_uploads()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
            // This is currently ObjectId so it is unique
            upload_started: 1
        },
        options: {
            name: 'list_uploads_index',
            unique: true,
            partialFilterExpression: {
                upload_started: { $exists: true }
            }
        }
    },
    {
        // list_object_versions()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
            list_versions: 1,
            version_id: -1
        },
        options: {
            name: 'list_versions_index',
            unique: true,
            partialFilterExpression: {
                upload_started: null
            }
        }
    },
    {
        // list_all_objects_of_bucket_need_sync()
        // update_all_objects_of_bucket_unset_cloud_sync()
        // update_all_objects_of_bucket_set_deleted_cloud_sync()
        fields: {
            bucket: 1,
            cloud_synced: 1,
            deleted: 1,
        },
        options: {
            unique: false,
        }
    },
    {
        // has_any_objects_in_system()
        // TODO index ??? count_objects_per_bucket()
        fields: {
            system: 1,
            deleted: 1,
        },
        options: {
            unique: false,
        }
    },
    {
        // aggregate_objects_by_create_dates()
        fields: {
            create_time: 1,
        },
        options: {
            unique: false,
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
            partialFilterExpression: {
                deleted: { $exists: true }
            }
        }
    }
];

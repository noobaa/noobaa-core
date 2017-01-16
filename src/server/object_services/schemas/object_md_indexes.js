/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
        // update_object_by_key()
        // update_objects_by_key_deleted()
        // find_object_by_key()
        // find_object_by_key_allow_missing()
        // find_objects()
        // find_objects_by_prefix_and_delimiter()
        // TODO index ??? has_any_objects_in_bucket()
        // TODO index ??? count_objects_of_bucket()
        // TODO index ??? list_all_objects_of_bucket_ordered_by_key()
        fields: {
            bucket: 1,
            key: 1,
            deleted: 1,
        },
        options: {
            unique: true,
        }
    },
    {
        // list_all_objects_of_bucket_need_sync()
        // update_all_objects_of_bucket_set_cloud_sync()
        // update_all_objects_of_bucket_unset_deleted_cloud_sync()
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
            sparse: true,
        }
    },
    {
        // aggregate_objects_by_delete_dates()
        fields: {
            deleted: 1,
        },
        options: {
            unique: false,
            sparse: true,
        }
    }
];

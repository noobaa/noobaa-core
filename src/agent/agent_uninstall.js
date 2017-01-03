/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const os_utils = require('../util/os_utils');
const argv = require('minimist')(process.argv);

exports.remove_agent_storage = remove_agent_storage;

function remove_agent_storage() {
    return os_utils.get_disk_mount_points()
        .then(function(mount_points) {
            return P.all(_.map(mount_points, storage_path_info => {
                var storage_path = storage_path_info.mount;
                var path_modification = storage_path.substr(0,
                    storage_path.lastIndexOf('agent_storage')) + 'agent_storage';
                return fs_utils.folder_delete(path_modification);
            }));
        });
}


if (require.main === module) {
    if (argv.remove_agent_storage) {
        return remove_agent_storage().return();
    }
}

'use strict';

var _ = require('lodash');
var mongo_client = require('./mongo_client');
var P = require('../../util/promise');
var fs_utils = require('../../util/fs_utils');
var SupervisorCtl = require('./supervisor_ctrl');
//var dbg = require('../../util/debug_module')(__filename);
var config = require('../../../config.js');

module.exports = new MongoCtrl(); // Singleton

//
//API
//
function MongoCtrl() {

}

MongoCtrl.prototype.init = function() {
    return this._refresh_services_list();
};

//TODO:: for detaching: add remove member from replica set & destroy shard

MongoCtrl.prototype.add_replica_set_member = function(name) {
    let self = this;
    mongo_client.disconnect(); //Disconnect and reconnect to mongo, process changed
    return self._remove_single_mongo()
        .then(() => self._add_replica_set_member_supervisor(name))
        .then(() => SupervisorCtl.apply_changes())
        .then(() => mongo_client.connect());
};

MongoCtrl.prototype.add_new_shard_server = function(name, first_shard) {
    let self = this;
    mongo_client.disconnect(); //Disconnect and reconnect to mongo, process changed
    return self._remove_single_mongo()
        .then(() => self._add_new_shard_supervisor(name, first_shard))
        .then(() => SupervisorCtl.apply_changes())
        .then(() => mongo_client.connect());
};

MongoCtrl.prototype.add_new_mongos = function(cfg_array) {
    let self = this;
    return self._add_new_mongos_supervisor(cfg_array)
        .then(() => SupervisorCtl.apply_changes())
        .then(() => mongo_client.update_connection_string(cfg_array));
};

MongoCtrl.prototype.add_new_config = function() {
    let self = this;
    return self._add_new_config_supervisor()
        .then(() => SupervisorCtl.apply_changes());
};

MongoCtrl.prototype.initiate_replica_set = function(set, members, is_config_set) {
    return mongo_client.initiate_replica_set(set, members, is_config_set);
};

MongoCtrl.prototype.add_member_to_replica_set = function(set, members, is_config_set) {
    return mongo_client.replica_update_members(set, members, is_config_set);

};

MongoCtrl.prototype.add_member_shard = function(name, ip) {
    return mongo_client.add_shard(ip, config.MONGO_DEFAULTS.SHARD_SRV_PORT, name);
};

MongoCtrl.prototype.update_connection_string = function() {
    return mongo_client.update_connection_string();
};


//
//Internals
//
MongoCtrl.prototype._add_replica_set_member_supervisor = function(name) {
    if (!name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    let program_obj = {};
    let dbpath = config.MONGO_DEFAULTS.COMMON_PATH + '/' + name + 'rs';
    program_obj.name = 'mongors-' + name;
    program_obj.command = 'mongod --replSet ' +
        '--replSet ' + name +
        ' --dbpath ' + dbpath;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return fs_utils.create_fresh_path(dbpath)
        .then(() => SupervisorCtl.add_program(program_obj));
};

MongoCtrl.prototype._add_new_shard_supervisor = function(name, first_shard) {
    if (!name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    var program_obj = {};
    let dbpath = config.MONGO_DEFAULTS.COMMON_PATH + '/' + name;
    program_obj.name = 'mongoshard-' + name;
    program_obj.command = 'mongod ' +
        ' --port ' + config.MONGO_DEFAULTS.SHARD_SRV_PORT +
        ' --dbpath ' + dbpath;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    if (first_shard) { //If shard1 (this means this is the first servers which will be the base of the cluster)
        //use the original server`s data (i.e. dbpath/shard1)
        return SupervisorCtl.add_program(program_obj);
    } else {
        return fs_utils.create_fresh_path(dbpath)
            .then(() => SupervisorCtl.add_program(program_obj));
    }
};

MongoCtrl.prototype._add_new_mongos_supervisor = function(cfg_array) {
    /*
    TODO :: NBNB verify insead mongos can run with < 3 servers
    if (!cfg_array || cfg_array.length !== 3) {
        throw new Error('config array must contain exactly 3 servers');
    }*/

    let config_string = '';
    _.each(cfg_array, function(srv) {
        if (config_string !== '') {
            config_string += ',';
        }
        config_string += srv + ':' + config.MONGO_DEFAULTS.CFG_PORT;
    });

    let program_obj = {};
    program_obj.name = 'mongos';
    program_obj.command = 'mongos --configdb ' + config_string;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return SupervisorCtl.remove_program('mongos') //remove old mongos with old cfg_array
        .then(() => SupervisorCtl.add_program(program_obj));
};

MongoCtrl.prototype._add_new_config_supervisor = function() {
    let program_obj = {};
    let dbpath = config.MONGO_DEFAULTS.CFG_DB_PATH;
    program_obj.name = 'mongocfg';
    program_obj.command = 'mongod --configsvr ' +
        ' --replSet ' + config.MONGO_DEFAULTS.CFG_RSET_NAME +
        ' --port ' + config.MONGO_DEFAULTS.CFG_PORT +
        ' --dbpath ' + dbpath;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return fs_utils.create_fresh_path(dbpath)
        .then(() => SupervisorCtl.add_program(program_obj));
};

MongoCtrl.prototype._remove_single_mongo = function() {
    return P.when(SupervisorCtl.remove_program('mongodb'));
};

MongoCtrl.prototype._refresh_services_list = function() {
    //TODO:: add real status form mongo per each
    return P.when(SupervisorCtl.get_mongo_services())
        .then(mongo_services => this._mongo_services = mongo_services);
};

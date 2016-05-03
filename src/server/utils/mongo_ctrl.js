'use strict';

var _ = require('lodash');
var mongo_client = require('./mongo_client');
var P = require('../../util/promise');
var super_ctrl = require('./supervisor_ctrl');
var dbg = require('../../util/debug_module')(__filename);
var config = require('../../../config.js');

module.exports = MongoCtrl;

//
//API
//
function MongoCtrl() {
    // TODO: NBNB - turn this into a promise with init()
    this._refresh_services_list();
    dbg.log0('Controllng', this._mongo_services, 'on this server');
}

//TODO:: for detaching: add remove member from replica set & destroy shard

MongoCtrl.prototype.add_replica_set_member = function(name) {
    let self = this;
    return self._remove_single_mongo()
        .then(() => self._add_replica_set_member_supervisor(name))
        .then(() => super_ctrl.apply_changes());
};

MongoCtrl.prototype.add_new_shard_server = function(name) {
    let self = this;
    return self._remove_single_mongo()
        .then(() => self._add_new_shard_supervisor(name))
        .then(() => super_ctrl.apply_changes());
};

MongoCtrl.prototype.add_new_mongos = function(cfg_array) {
    let self = this;
    return self._remove_single_mongo()
        .then(() => self._add_new_mongos_supervisor(cfg_array))
        .then(() => super_ctrl.apply_changes())
        .then(function() {
            return mongo_client.update_connection_string(cfg_array);
        });
};

MongoCtrl.prototype.add_new_config = function() {
    let self = this;
    return self._add_new_config_supervisor()
        .then(() => super_ctrl.apply_changes());
};

MongoCtrl.prototype.initiate_replica_set = function(set, members) {
    return mongo_client.initiate_replica_set(set, members);
};

MongoCtrl.prototype.add_member_to_replica_set = function(set, members) {
    return mongo_client.replica_update_members(set, members);

};

MongoCtrl.prototype.add_member_to_shard = function(ip) {
    //sh.addShard( "mongodb0.example.net:27017" )
};

MongoCtrl.prototype.update_connection_string = function() {

};


//
//Internals
//
MongoCtrl.prototype._add_replica_set_member_supervisor = function(name) {
    if (!name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    let program_obj = {};
    program_obj.name = 'mongors-' + name;
    program_obj.command = 'mongod --replSet ' +
        '--replSet ' + name +
        ' --dbpath ' + config.MONGO_DEFAULTS.COMMON_PATH + '/' + name + 'rs';
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._add_new_shard_supervisor = function(name) {
    if (!name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    let program_obj = {};
    program_obj.name = 'mongoshard-' + name;
    program_obj.command = 'mongod --configsvr ' +
        ' --port ' + config.MONGO_DEFAULTS.SHARD_SRV_PORT +
        ' --dbpath ' + config.MONGO_DEFAULTS.COMMON_PATH + '/' + name;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._add_new_mongos_supervisor = function(cfg_array) {
    if (!cfg_array || cfg_array.length !== 3) {
        throw new Error('config array must contain exactly 3 servers');
    }

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

    return super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._add_new_config_supervisor = function() {
    let program_obj = {};
    program_obj.name = 'mongocfg';
    program_obj.command = 'mongod --configsvr ' +
        ' --replSet ' + config.MONGO_DEFAULTS.CFG_RSET_NAME +
        ' --port ' + config.MONGO_DEFAULTS.CFG_PORT +
        ' --dbpath ' + config.MONGO_DEFAULTS.CFG_DB_PATHs;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._remove_single_mongo = function() {
    return super_ctrl.remove_program('mongodb');
};

MongoCtrl.prototype._refresh_services_list = function() {
    //TODO:: add real status form mongo per each
    P.when(this._super_ctrl.get_mongo_services())
        .then(mongo_services => this._mongo_services = mongo_services);
};

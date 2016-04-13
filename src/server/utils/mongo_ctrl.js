'use strict';

var _ = require('lodash');
var fs = require('fs');
var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');
var super_ctrl = require('./supervisor_ctrl');
var dbg = require('../util/debug_module')(__filename);

module.exports = MongoCtrl;

var MONGO_DEFAULTS = {
    CFG_DB_PATH: '/var/lib/mongo/cluster/cfg0',
    CFG_PORT: '26050',
    CFG_RSET_NAME: 'config0',
    COMMON_PATH: '/var/lib/mongo/cluster',
};

function MongoCtrl() {
    this._super_ctrl = new super_ctrl();
    this._mongo_services = this._super_ctrl.get_mongo_services();
    dbg.log0('Controllng', this._mongo_services, 'on this server');
}

//TODO:: for detaching: add remove member from replica set & destroy shard

MongoCtrl.prototype.add_replica_set_member = function(config) {
    let self = this;
    self._add_replica_set_member_supervisor(config);
    return P.when(self._super_ctrl.apply_changes());
    //TODO:: implement
};

MongoCtrl.prototype.add_new_shard = function(port, name) {
    let self = this;
    self._add_new_shard_supervisor(port, name);
    return P.when(self._super_ctrl.apply_changes());
};

MongoCtrl.prototype.add_new_mongos = function(cfg_array) {
    let self = this;
    self._add_new_mongos_supervisor(cfg_array);
    return P.when(self._super_ctrl.apply_changes());
};

MongoCtrl.prototype.add_new_config = function() {
    let self = this;
    self._add_new_config_supervisor();
    return P.when(self._super_ctrl.apply_changes());
};


//Internals

MongoCtrl.prototype._add_replica_set_member_supervisor = function(config) {
    //mongod --replSet rs0
};

MongoCtrl.prototype._add_new_shard_supervisor = function(port, name) {
    if (!port || !name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    let program_obj = {};
    program_obj.name = 'mongoshard-' + name;
    program_obj.command = 'mongod --configsvr ' +
        ' --port ' + port +
        ' --dbpath ' + MONGO_DEFAULTS.COMMON_PATH + '/' + name;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    this._super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._add_new_mongos_supervisor = function(cfg_array) {
    //mongos --configdb 104.155.35.218:26050,104.155.66.69:26050,146.148.18.116:26050 --fork --logappend --syslog
    if (!cfg_array || cfg_array.length !== 3) {
        throw new Error('config array must contain exactly 3 servers');
    }

    let config_string = '';
    _.each(cfg_array, function(srv) {
        if (config_string !== '') {
            config_string += ',';
        }
        config_string += srv + ':' + MONGO_DEFAULTS.CFG_PORT;
    });

    let program_obj = {};
    program_obj.name = 'mongos';
    program_obj.command = 'mongos --configdb ' + config_string;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    this._super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._add_new_config_supervisor = function() {
    let program_obj = {};
    program_obj.name = 'mongocfg';
    program_obj.command = 'mongod --configsvr ' +
        ' --replSet ' + MONGO_DEFAULTS.CFG_RSET_NAME +
        ' --port ' + MONGO_DEFAULTS.CFG_PORT +
        ' --dbpath ' + MONGO_DEFAULTS.CFG_DB_PATHs;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    this._super_ctrl.add_program(program_obj);
};

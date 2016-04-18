'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var super_ctrl = require('./supervisor_ctrl');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../../../config.js');

module.exports = MongoCtrl;

function MongoCtrl() {
    this._super_ctrl = new super_ctrl();
    this._refresh_services_list();
    dbg.log0('Controllng', this._mongo_services, 'on this server');
}

//TODO:: for detaching: add remove member from replica set & destroy shard

MongoCtrl.prototype.add_replica_set_member = function(cfg) {
    let self = this;
    self._add_replica_set_member_supervisor(cfg);
    return P.when(self._super_ctrl.apply_changes());
};

MongoCtrl.prototype.add_new_shard_server = function(name) {
    let self = this;
    self._add_new_shard_supervisor(name);
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

MongoCtrl.prototype._add_replica_set_member_supervisor = function(cfg) {
    //TODO:: implement
    //mongod --replSet rs0
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

    this._super_ctrl.add_program(program_obj);
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

    this._super_ctrl.add_program(program_obj);
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

    this._super_ctrl.add_program(program_obj);
};

MongoCtrl.prototype._refresh_services_list = function() {
    //TODO:: add real status form mongo per each
    this._mongo_services = this._super_ctrl.get_mongo_services();
};

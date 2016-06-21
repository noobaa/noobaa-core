'use strict';

var _ = require('lodash');
var server_rpc = require('../server_rpc');
var P = require('../../util/promise');
var fs_utils = require('../../util/fs_utils');
var config = require('../../../config.js');
var SupervisorCtl = require('./supervisor_ctrl');
var mongo_client = require('../../util/mongo_client');
var mongoose_client = require('../../util/mongoose_utils');
var dotenv = require('../../util/dotenv');
var dbg = require('../../util/debug_module')(__filename);
var cutil = require('./clustering_utils');

module.exports = new MongoCtrl(); // Singleton

//
//API
//
function MongoCtrl() {

}

MongoCtrl.prototype.init = function() {
    dbg.log0('Initing MongoCtrl');
    dotenv.load();
    return this._refresh_services_list();
};

//TODO:: for detaching: add remove member from replica set & destroy shard

MongoCtrl.prototype.add_replica_set_member = function(name, first_server, servers) {
    let self = this;
    return self._remove_single_mongo_program()
        .then(() => self._add_replica_set_member_program(name, first_server))
        .then(() => SupervisorCtl.apply_changes())
        .then(() => {
            // build new connection url for mongo and write to .env
            return self.update_dotenv(name, cutil.extract_servers_ip(servers));
        });
};

MongoCtrl.prototype.add_new_shard_server = function(name, first_shard) {
    let self = this;
    return self._remove_single_mongo_program()
        .then(() => self._add_new_shard_program(name, first_shard))
        .then(() => SupervisorCtl.apply_changes());
};

MongoCtrl.prototype.add_new_mongos = function(cfg_array) {
    let self = this;
    return P.resolve(self._add_new_mongos_program(cfg_array))
        .then(() => SupervisorCtl.apply_changes());
};

MongoCtrl.prototype.add_new_config = function() {
    let self = this;
    return self._add_new_config_program()
        .then(() => SupervisorCtl.apply_changes());
};

MongoCtrl.prototype.initiate_replica_set = function(set, members, is_config_set) {
    dbg.log0('Initiate replica set', set, members, 'is_config_set', is_config_set);
    return mongo_client.instance().initiate_replica_set(set, members, is_config_set);
};

MongoCtrl.prototype.add_member_to_replica_set = function(set, members, is_config_set) {
    dbg.log0('Add members replica set', set, members, is_config_set);
    return mongo_client.instance().replica_update_members(set, members, is_config_set);

};

MongoCtrl.prototype.add_member_shard = function(name, ip) {
    dbg.log0('Add member shard', name, ip);
    return mongo_client.instance().add_shard(ip, config.MONGO_DEFAULTS.SHARD_SRV_PORT, name);
};

MongoCtrl.prototype.is_master = function(is_config_set, set_name) {
    return mongo_client.instance().is_master(is_config_set, set_name);
};

MongoCtrl.prototype.update_connection_string = function() {
    //MongoDB seems to use a shared connection/state on our mongo_client & mongoose_utils
    //Disconnect both, replace url, connect both
    //Order is important!

    return P.resolve(mongoose_client.mongoose_disconnect())
        .then(() => {
            mongo_client.instance().disconnect();
            mongo_client.instance().update_connection_string();
            mongoose_client.mongoose_update_connection_string();
            return mongoose_client.mongoose_connect();
        })
        .then(() => mongo_client.instance().connect());
};

MongoCtrl.prototype.get_mongo_rs_status = function() {
    return mongo_client.get_mongo_rs_status();
};

//
//Internals
//
MongoCtrl.prototype._add_replica_set_member_program = function(name, first_server) {
    if (!name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    let program_obj = {};
    let dbpath = config.MONGO_DEFAULTS.COMMON_PATH + '/' + name + (first_server ? '' : 'rs');
    program_obj.name = 'mongors-' + name;
    program_obj.command = 'mongod ' +
        '--replSet ' + name +
        ' --port ' + config.MONGO_DEFAULTS.SHARD_SRV_PORT +
        ' --dbpath ' + dbpath;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    dbg.log0('adding replica set program:', program_obj);
    if (first_server) { //If shard1 (this means this is the first server which will be the base of the cluster)
        //use the original server`s data
        dbg.log0('first server in the cluster - leaving dbpath as is:', dbpath);
        return SupervisorCtl.add_program(program_obj);
    } else {
        dbg.log0('adding server to an existing cluster. cleaning dbpath:', dbpath);
        return fs_utils.create_fresh_path(dbpath)
            .then(() => SupervisorCtl.add_program(program_obj));
    }
};

MongoCtrl.prototype._add_new_shard_program = function(name, first_shard) {
    if (!name) {
        throw new Error('port and name must be supplied to add new shard');
    }

    var program_obj = {};
    let dbpath = config.MONGO_DEFAULTS.COMMON_PATH + '/' + name;
    program_obj.name = 'mongoshard-' + name;
    program_obj.command = 'mongod  --shardsvr' +
        ' --replSet ' + name +
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

MongoCtrl.prototype._add_new_mongos_program = function(cfg_array) {
    let config_string = '';
    //Mongos can only recieve an odd numbered config IPs, in case we are at 2, use the first one only
    if (cfg_array.length < 3) {
        config_string = cfg_array[0] + ':' + config.MONGO_DEFAULTS.CFG_PORT;
    } else {
        _.each(cfg_array, function(srv) {
            if (config_string !== '') {
                config_string += ',';
            }
            config_string += srv + ':' + config.MONGO_DEFAULTS.CFG_PORT;
        });
    }

    let program_obj = {};
    program_obj.name = 'mongos';
    program_obj.command = 'mongos --configdb ' + config_string;
    program_obj.directory = '/usr/bin';
    program_obj.user = 'root';
    program_obj.autostart = 'true';
    program_obj.priority = '1';

    return P.resolve(SupervisorCtl.remove_program('mongos')) //remove old mongos with old cfg_array
        .then(() => SupervisorCtl.add_program(program_obj));
};

MongoCtrl.prototype._add_new_config_program = function() {
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

MongoCtrl.prototype._remove_single_mongo_program = function() {
    return P.resolve(SupervisorCtl.remove_program('mongodb'));
};

MongoCtrl.prototype._refresh_services_list = function() {
    //TODO:: add real status form mongo per each
    return P.resolve(SupervisorCtl.get_mongo_services())
        .then(mongo_services => {
            this._mongo_services = mongo_services;
        });
};

MongoCtrl.prototype.update_dotenv = function(name, IPs) {
    dbg.log0('will update dotenv for replica set', name, 'with IPs', IPs);
    let servers_str = IPs.map(ip => ip + ':' + config.MONGO_DEFAULTS.SHARD_SRV_PORT).join(',');
    let url = 'mongodb://' + servers_str + '/nbcore?replicaSet=' + name;
    let old_url = process.env.MONGO_RS_URL || '';
    dbg.log0('updating MONGO_RS_URL in .env from', old_url, 'to', url);
    dotenv.set({
        key: 'MONGO_RS_URL',
        value: url
    });
    // update all processes in the current server of the change in connection string
    return this._publish_rs_name_current_server(name);
};

MongoCtrl.prototype._publish_rs_name_current_server = function(name) {
    return server_rpc.client.redirector.publish_to_cluster({
        method_api: 'cluster_member_api',
        method_name: 'update_mongo_connection_string',
        target: '', // required but irrelevant
        request_params: {
            rs_name: name
        }
    });
};

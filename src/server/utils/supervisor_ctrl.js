'use strict';

var _ = require('lodash');
var fs = require('fs');
var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');
var config = require('../../../config.js');

module.exports = SupervisorCtrl;

function SupervisorCtrl() {
    let self = this;
    return fs.statAsync(config.CLUSTERING_PATHS.SUPER_FILE)
        .fail(function(err) {
            console.warn('Error on reading supervisor file', err);
            throw err;
        })
        .then(function() {
            return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.SUPER_FILE)
                .then(function(data) {
                    self._parse_config(data.toString());
                });
        });
}

SupervisorCtrl.prototype.apply_changes = function() {
    var self = this;
    return P.when(self._serialize())
        .then(function() {
            return promise_utils.promised_exec('supervisorctl reload');
        });
};

SupervisorCtrl.prototype.add_program = function(prog) {
    this._programs.push(prog);
};

SupervisorCtrl.prototype.get_mongo_services = function() {
    let self = this;
    let mongo_progs = {};
    _.each(self._programs, function(prog) {
        //mongos, mongo replicaset, mongo shard, mongo config set
        //TODO:: add replicaset once implemented
        if (prog.name.indexOf('mongoshard') > 0) {
            mongo_progs.push({
                type: 'shard',
                name: prog.name.slice('mongoshard-'.length),
            });
        } else if (prog.name.indexOf('mongos') > 0) {
            mongo_progs.push({
                type: 'mongos',
            });
        } else if (prog.name.indexOf('mongocfg') > 0) {
            mongo_progs.push({
                type: 'config',
            });
        }
    });
};

// Internals

SupervisorCtrl.prototype._serialize = function() {
    let data;
    let self = this;
    _.each(self._programs, function(prog) {
        data += '[program:' + prog.name + ']\n';
        _.each(_.keys(prog), function(key) {
            data += key + '=' + prog[key] + '\n';
        });
        data += config.SUPERVISOR_PROGRAM_SEPERATOR + '\n';
    });
    console.warn('Serializing', config.CLUSTERING_PATHS.SUPER_FILE, data);

    return fs.writeFileAsync(config.CLUSTERING_PATHS.SUPER_FILE, data);
};

SupervisorCtrl.prototype._parse_config = function(data) {
    let self = this;
    self._programs = [];
    //run target by target and create the services structure
    var programs = _.split(data, config.SUPERVISOR_PROGRAM_SEPERATOR);
    _.each(programs, function(p) {
        let program_obj = {};
        let lines = _.split(p, '\n');
        _.each(lines, function(l) {
            // For non empty lines
            if (l.length !== 0) {
                if (l[0] === '[') { //Program name
                    program_obj.name = l.slice(l.indexOf(':') + 1, l.indexOf(']'));
                } else {
                    let parts = _.split(l, '=');
                    program_obj[parts[0]] = parts[1];
                }
            }
        });
        self._programs.push(program_obj);
    });
};

//function reload_services

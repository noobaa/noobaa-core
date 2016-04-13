'use strict';

var _ = require('lodash');
var fs = require('fs');
var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');

module.exports = SupervisorCtrl;

var SUPERVISOR_DEFAULTS = {
    SUPER_FILE: '/etc/noobaa_supervisor.conf',
    PROGRAM_SEPERATOR: '#endprogram',
};

function SupervisorCtrl() {
    let self = this;
    return fs.statAsync(SUPERVISOR_DEFAULTS.SUPER_FILE)
        .fail(function(err) {
            console.warn('Error on reading supervisor file', err);
            throw err;
        })
        .then(function() {
            return P.nfcall(fs.readFile, SUPERVISOR_DEFAULTS.SUPER_FILE)
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
        if (prog.name.indexOf('mongo') > 0) {
            //service type
            //mongos, repl, shard, config
            //repl name / shard name
            //port
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
        data += SUPERVISOR_DEFAULTS.PROGRAM_SEPERATOR + '\n';
    });
    console.warn('Serialized', SUPERVISOR_DEFAULTS.SUPER_FILE, data);

    return fs.writeFileAsync(SUPERVISOR_DEFAULTS.SUPER_FILE, data);
};

SupervisorCtrl.prototype._parse_config = function(data) {
    let self = this;
    self._programs = [];
    //run target by target and create the services structure
    var programs = _.split(data, SUPERVISOR_DEFAULTS.PROGRAM_SEPERATOR);
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

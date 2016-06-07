'use strict';

var _ = require('lodash');
var fs = require('fs');
var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');
var os_utils = require('../../util/os_utils');
var config = require('../../../config.js');

module.exports = new SupervisorCtrl(); //Singleton

function SupervisorCtrl() {
    this._inited = false;
}

SupervisorCtrl.prototype.init = function() {
    let self = this;
    if (self._inited) {
        return;
    }
    self._supervised = os_utils.is_supervised_env();
    if (!self._supervised) {
        return;
    }
    return fs.statAsync(config.CLUSTERING_PATHS.SUPER_FILE)
        .fail(function(err) {
            console.warn('Error on reading supervisor file', err);
            throw err;
        })
        .then(function() {
            return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.SUPER_FILE)
                .then(function(data) {
                    return self._parse_config(data.toString());
                });
        })
        .then(() => {
            self._inited = true;
        });
};

SupervisorCtrl.prototype.apply_changes = function() {
    var self = this;

    return P.when(self.init())
        .then(() => {
            if (!self._supervised) {
                return;
            }
            return self._serialize();
        })
        .then(function() {
            return promise_utils.promised_exec('supervisorctl update')
                .delay(5000); //TODO:: Better solution
        });
};

SupervisorCtrl.prototype.add_program = function(prog) {
    let self = this;

    return P.when(self.init())
        .then(() => {
            if (!self._supervised) {
                return;
            }
            return self._programs.push(prog);
        });
};

SupervisorCtrl.prototype.remove_program = function(prog_name) {
    let self = this;

    return P.when(self.init())
        .then(() => {
            if (!self._supervised) {
                return;
            }

            let ind = _.findIndex(self._programs, function(prog) {
                return prog.name === (prog_name);
            });
            //don't fail on removing non existent program
            if (ind !== -1) {
                self._programs.splice(ind, 1);
            }
            return;
        });
};

SupervisorCtrl.prototype.get_mongo_services = function() {
    let self = this;

    let mongo_progs = {};
    return P.when(self.init())
        .then(() => {
            if (!self._supervised) {
                return;
            }

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
                } else if (prog.name.indexOf('mongodb') > 0) {
                    mongo_progs.push({
                        type: 'mongo_single',
                    });
                }
            });
        });
};


SupervisorCtrl.prototype.add_agent = function(agent_name, args_str) {
    let self = this;

    let prog = {};
    prog.directory = config.SUPERVISOR_DEFAULTS.DIRECTORY;
    prog.stopsignal = config.SUPERVISOR_DEFAULTS.STOPSIGNAL;
    prog.command = '/usr/local/bin/node src/agent/agent_cli.js ' + args_str;
    prog.name = 'agent_' + agent_name;
    return P.when(self.init())
        .then(() => {
            if (!self._supervised) {
                return;
            }
            self.add_program(prog);
        })
        .then(() => self.apply_changes());
};

// Internals

SupervisorCtrl.prototype._serialize = function() {
    let data = '';
    let self = this;
    if (!self._supervised) {
        return;
    }

    _.each(self._programs, function(prog) {
        data += '[program:' + prog.name + ']\n';
        _.each(_.keys(prog), function(key) {
            if (key !== 'name') { //skip no names
                data += key + '=' + prog[key] + '\n';
            }
        });
        data += config.SUPERVISOR_PROGRAM_SEPERATOR + '\n\n';
    });

    return fs.writeFileAsync(config.CLUSTERING_PATHS.SUPER_FILE, data);
};

SupervisorCtrl.prototype._parse_config = function(data) {
    let self = this;
    if (!self._supervised) {
        return;
    }

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
        if (program_obj.name) {
            self._programs.push(program_obj);
        }
    });
};


//function reload_services

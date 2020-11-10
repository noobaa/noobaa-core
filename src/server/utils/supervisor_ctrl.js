/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var fs = require('fs');
var P = require('../../util/promise');
var os_utils = require('../../util/os_utils');
var config = require('../../../config.js');

class SupervisorCtrl {
    constructor() {
        this._inited = false;
    }

    init() {
        if (this._inited) {
            return;
        }
        this._supervised = os_utils.is_supervised_env();
        if (!this._supervised) {
            return;
        }

        return fs.promises.stat(config.CLUSTERING_PATHS.SUPER_FILE)
            .catch(function(err) {
                console.warn('Error on reading supervisor file', err);
                throw err;
            })
            .then(() => fs.promises.readFile(config.CLUSTERING_PATHS.SUPER_FILE))
            .then(data => this._parse_config(data.toString()))
            .then(() => {
                this._inited = true;
            });
    }

    apply_changes() {
        return P.resolve()
            .then(() => this.init())
            .then(() => {
                if (!this._supervised) {
                    return;
                }
                return this._serialize();
            })
            .then(() => os_utils.exec('supervisorctl update'));
    }

    restart(services) {
        return os_utils.spawn('supervisorctl', ['restart', services.join(' ')], {
                detached: true
            }, false)
            .then(() => P.delay(5000)) //TODO:: Better solution
            .catch(function(err) {
                console.error('failed to restart services', services);
                throw new Error('failed to restart services ' + services + err);
            });
    }

    start(services) {
        return os_utils.spawn('supervisorctl', ['start', services.join(' ')], {
                detached: true
            }, false)
            .then(() => P.delay(5000)) //TODO:: Better solution
            .catch(function(err) {
                console.error('failed to start services', services);
                throw new Error('failed to start services ' + services + err);
            });
    }

    stop(services) {
        return os_utils.spawn('supervisorctl', ['stop', services.join(' ')], {
                detached: true
            }, false)
            .then(() => P.delay(5000)) //TODO:: Better solution
            .catch(function(err) {
                console.error('failed to stop services', services);
                throw new Error('failed to stop services ' + services + err);
            });
    }

    async list() {
        await this.init();
        return this._programs.map(prog => prog.name);
    }

    add_program(prog) {
        return P.resolve()
            .then(() => this.init())
            .then(() => {
                if (!this._supervised) {
                    return;
                }
                prog.stderr_logfile_backups = '3';
                prog.stdout_logfile_backups = '3';
                return this._programs.push(prog);
            });
    }

    remove_program(prog_name) {
        return P.resolve()
            .then(() => this.init())
            .then(() => {
                if (!this._supervised) {
                    return;
                }
                let ind = _.findIndex(this._programs, function(prog) {
                    return prog.name === (prog_name);
                });
                //don't fail on removing non existent program
                if (ind !== -1) {
                    this._programs.splice(ind, 1);
                }
            });
    }

    async get_program(prog_name) {
        await this.init();
        const program = this._programs.find(prog => prog.name === prog_name);
        if (program) {
            return _.clone(program);
        }
    }

    async update_program(program) {
        await this.init();
        const prog_index = this._programs.findIndex(prog => prog.name === program.name);
        if (prog_index >= 0) {
            this._programs[prog_index] = program;
        }
    }

    async update_services_autostart(services, value) {
        if (value !== true && value !== false) throw new Error('autostart supports true/false only');
        for (const srv of services) {
            const program = this._programs.find(prog => prog.name === srv);
            program.autostart = `${value}`;
        }
    }

    get_mongo_services() {
        let mongo_progs = [];
        return P.resolve()
            .then(() => this.init())
            .then(() => {
                if (!this._supervised) {
                    return;
                }
                _.each(this._programs, function(prog) {
                    //mongos, mongo replicaset, mongo shard, mongo config set
                    //TODO:: add replicaset once implemented
                    if (prog.name.indexOf('mongoshard') > -1) {
                        mongo_progs.push(prog);
                    } else if (prog.name.indexOf('mongos') > -1) {
                        mongo_progs.push(prog);
                    } else if (prog.name.indexOf('mongocfg') > -1) {
                        mongo_progs.push(prog);
                        // This should be for both cluster and single mongo
                    } else if (prog.name.indexOf('mongo_wrapper') > -1) {
                        mongo_progs.push(prog);
                    }
                });
                return mongo_progs;
            });
    }

    add_agent(agent_name, args_str) {
        let prog = {};
        prog.directory = config.SUPERVISOR_DEFAULTS.DIRECTORY;
        prog.stopsignal = config.SUPERVISOR_DEFAULTS.STOPSIGNAL;
        prog.command = '/usr/local/bin/node src/agent/agent_cli.js ' + args_str;
        prog.name = 'agent_' + agent_name;
        prog.autostart = 'true';
        prog.priority = '1100';
        return P.resolve()
            .then(() => this.init())
            .then(() => {
                if (!this._supervised) {
                    return;
                }
                return this.add_program(prog);
            })
            .then(() => this.apply_changes());
    }

    restart_supervisord() {
        return os_utils.spawn('/etc/init.d/supervisord', ['restart'], {
                detached: true
            }, false)
            .then(() => P.delay(5000)) //TODO:: Better solution
            .catch(function(err) {
                console.error('failed to restart supervisor daemon');
                throw new Error('failed to restart supervisor daemon ' + err);
            });
    }

    // Internals
    _serialize() {
        let data = '';
        if (!this._supervised) {
            return;
        }
        _.each(this._programs, function(prog) {
            data += '[program:' + prog.name + ']\n';
            _.each(_.keys(prog), function(key) {
                if (key !== 'name') {
                    data += key + '=' + prog[key] + '\n';
                }
            });
            data += config.SUPERVISOR_PROGRAM_SEPERATOR + '\n\n';
        });
        return fs.promises.writeFile(config.CLUSTERING_PATHS.SUPER_FILE, data);
    }

    _parse_config(data) {
        if (!this._supervised) {
            return;
        }
        this._programs = [];
        //run target by target and create the services structure
        var programs = _.split(data, config.SUPERVISOR_PROGRAM_SEPERATOR);
        _.each(programs, p => {
            let program_obj = {};
            let lines = _.split(p, '\n');
            _.each(lines, function(l) {
                // For non empty lines
                if (l.length !== 0) {
                    if (l[0] === '[') {
                        program_obj.name = l.slice(l.indexOf(':') + 1, l.indexOf(']'));
                    } else {
                        let parts = _.split(l, '=');
                        program_obj[parts[0]] = parts[1];
                    }
                }
            });
            if (program_obj.name) {
                this._programs.push(program_obj);
            }
        });
    }
}


module.exports = new SupervisorCtrl(); //Singleton

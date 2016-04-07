'use strict';

var _ = require('lodash');
var fs = require('fs');
var P = require('../../util/promise');

module.exports = SupervisorSerial;

var SUPER_FILE = '/etc/noobaa_supervisor.conf';
var MONGO_SEPERATOR = '#endprogram';

function SupervisorSerial() {
    let self = this;
    return fs.statAsync(SUPER_FILE)
        .fail(function(err) {
            console.warn('Error on reading supervisor file', err);
            throw err;
        })
        .then(function() {
            return P.nfcall(fs.readFile, SUPER_FILE)
                .then(function(data) {
                    self._parse_config(data.toString());
                });
        });
}

//TODO:: for detaching: add remove member from replica set & destroy shard

SupervisorSerial.prototype.add_replica_set_member = function() {

};

SupervisorSerial.prototype.add_new_shard = function() {

};

SupervisorSerial.prototype.add_new_config = function() {
    //mongod --configsvr --replSet config --port 26050 --dbpath /var/lib/mongo/shardedcluster/cfg0
    //let program_obj = {};

};

SupervisorSerial.prototype.serialize = function() {
    let file;
    let self = this;
    _.each(self._programs, function(p) {
        file += '[program:' + p.name + ']\n';
        _.each(_.keys(p), function(k) {
            file += k + '=' + p[k] + '\n';
        });
        file += MONGO_SEPERATOR + '\n';
    });
    console.warn('Serialized', file);
};

SupervisorSerial.prototype._parse_config = function(data) {
    let self = this;
    self._programs = [];
    //run target by target and create the services structure
    var programs = _.split(data, MONGO_SEPERATOR);
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

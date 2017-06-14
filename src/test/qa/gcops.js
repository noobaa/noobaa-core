/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var P = require('../../util/promise');

const promise_utils = require('../../util/promise_utils');
var google = require('googleapis');
var compute = google.compute('v1');

function list_machines(project, authClient, zone, prefix) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instancesListParams = {
                auth: authClient,
                project: project,
                zone: zone,
                filter: 'name eq ^' + prefix + '.*',
            };
            return P.nfcall(compute.instances.list, instancesListParams);
        })
        .then(instances_list => {
            var names_list = [];
            _.each(instances_list.items, function(current_instance) {
                names_list.push(current_instance.name);
            });
            return names_list;
        });
}

function count_on_machines(project, authClient, zone, prefix) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instancesListParams = {
                auth: authClient,
                project: project,
                zone: zone,
                filter: '(name eq ^' + prefix + '.*)(status eq RUNNING)',
            };
            return P.nfcall(compute.instances.list, instancesListParams);
        })
        .then(instances_list => {
            console.log(instances_list.items.length);
            return instances_list.items.length;
        });
}

function get_random_machine(project, authClient, zone, prefix) {
    return list_machines(project, authClient, zone, prefix)
        .then(function(list) {
            let rand = Math.floor(Math.random() * list.length);
            return list[rand];
        })
        .catch(err => {
            console.error('Get random machine failed!', err);
            throw err;
        });
}

function reset_machine(project, authClient, zone, machine) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instanceParams = {
                auth: authClient,
                instance: machine,
                project: project,
                zone: zone,
            };
            return P.nfcall(compute.instances.reset, instanceParams);
        });
}

function start_machine(project, authClient, zone, machine) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instanceParams = {
                auth: authClient,
                instance: machine,
                project: project,
                zone: zone,
            };
            return P.nfcall(compute.instances.start, instanceParams);
        });
}

function stop_machine(project, authClient, zone, machine) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instanceParams = {
                auth: authClient,
                instance: machine,
                project: project,
                zone: zone,
            };
            return P.nfcall(compute.instances.stop, instanceParams);
        });
}

function get_machine_status(project, authClient, zone, machine) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instanceParams = {
                auth: authClient,
                instance: machine,
                project: project,
                zone: zone,
            };
            return P.nfcall(compute.instances.get, instanceParams)
                .then(machine_info => machine_info.status);
        });
}

function wait_machine_state(project, authClient, zone, machine, state) {
    return P.ninvoke(authClient, 'authorize')
        .then(token => {
            var instanceParams = {
                auth: authClient,
                instance: machine,
                project: project,
                zone: zone,
            };
            var c_state;
            console.log('Waiting for machine state to be ' + state);
            return promise_utils.pwhile(() => c_state !== state, () =>
                P.nfcall(compute.instances.get, instanceParams)
                .then(machine_info => {
                    c_state = machine_info.status;
                    console.log('Current state is: ' + c_state + ' waiting for: ' + state + ' - will wait for extra 5 seconds');
                })
                .delay(5000));
        });
}

exports.reset_machine = reset_machine;
exports.start_machine = start_machine;
exports.stop_machine = stop_machine;
exports.get_random_machine = get_random_machine;
exports.list_machines = list_machines;
exports.count_on_machines = count_on_machines;
exports.get_machine_status = get_machine_status;
exports.wait_machine_state = wait_machine_state;

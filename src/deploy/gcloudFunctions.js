/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');

const promise_utils = require('../util/promise_utils');
var { google } = require('googleapis');
const compute = google.compute('v1');

class GcloudFunctions {

    constructor(account_email, account_key, project, zone) {
        this.project = project;
        this.zone = zone;
        this.account_email = account_email;
        this.account_key = account_key;

        this.authClient = new google.auth.JWT(account_email, account_key, null, ['https://www.googleapis.com/auth/compute']);
    }

    authenticate() {
        console.log('\nConnecting to Gcloud: ');
        return P.ninvoke(this.authClient, 'authorize')
            .then(token => {
                this.token = token;
            });
    }

    listMachines(prefix) {
        var instancesListParams = {
            auth: this.authClient,
            project: this.project,
            zone: this.zone,
            filter: 'name eq ^' + prefix + '.*',
        };
        return P.nfcall(compute.instances.list, instancesListParams)
            .then(instances_list => {
                var names_list = [];
                _.each(instances_list.items, function(current_instance) {
                    names_list.push(current_instance.name);
                });
                return names_list;
            });
    }

    countOnMachines(prefix) {
        return P.ninvoke(this.authClient, 'authorize')
            .then(token => {
                var instancesListParams = {
                    auth: this.authClient,
                    project: this.project,
                    zone: this.zone,
                    filter: '(name eq ^' + prefix + '.*)(status eq RUNNING)',
                };
                return P.nfcall(compute.instances.list, instancesListParams);
            })
            .then(instances_list => instances_list.items.length);
    }

    getRandomMachine(prefix) {
        return this.listVirtualMachines(prefix)
            .then(function(list) {
                let rand = Math.floor(Math.random() * list.length);
                return list[rand];
            })
            .catch(err => {
                console.error('Get random machine failed!', err);
                throw err;
            });
    }

    restartVirtualMachine(machine) {
        var instanceParams = {
            instance: machine,
            auth: this.authClient,
            project: this.project,
            zone: this.zone,
        };
        return P.nfcall(compute.instances.reset, instanceParams);
    }

    startVirtualMachine(machine) {
        var instanceParams = {
            instance: machine,
            auth: this.authClient,
            project: this.project,
            zone: this.zone,
        };
        return P.nfcall(compute.instances.start, instanceParams);
    }

    stopVirtualMachine(machine) {
        var instanceParams = {
            instance: machine,
            auth: this.authClient,
            project: this.project,
            zone: this.zone,
        };
        return P.nfcall(compute.instances.stop, instanceParams);
    }

    getMachineStatus(machine) {
        var instanceParams = {
            instance: machine,
            auth: this.authClient,
            project: this.project,
            zone: this.zone,
        };
        return P.nfcall(compute.instances.stop, instanceParams)
            .then(machine_info => machine_info.status);
    }

    waitMachineState(machine, state) {
        var instanceParams = {
            instance: machine,
            auth: this.authClient,
            project: this.project,
            zone: this.zone,
        };
        var c_state;
        console.log('Waiting for machine state to be ' + state);
        return promise_utils.pwhile(() => c_state !== state, () => P.nfcall(compute.instances.get, instanceParams)
            .then(machine_info => {
                c_state = machine_info.status;
                console.log('Current state is: ' + c_state + ' waiting for: ' + state + ' - will wait for extra 5 seconds');
            })
            .delay(5000)
        );
    }
}

// require('../../util/dotenv').load();
// var account_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// var account_key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
//
// var bla = new GcloudFunctions(account_email, account_key, 'noobaa-test-1', 'europe-west1-b');
// bla.authenticate().then(() => bla.countOnMachines('phone-')).then(console.log);

module.exports = GcloudFunctions;

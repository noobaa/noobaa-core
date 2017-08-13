/* eslint-disable */
/* Copyright (C) 2016 NooBaa */
'use strict';

const promise_utils = require('../../util/promise_utils');
var dotenv = require('../../util/dotenv');
// const gcops = require('../qa/gcops');
const argv = require('minimist')(process.argv);
// var google = require('googleapis');

var AzureFunctions = require('../../deploy/azureFunctions');
var GcloudFunctions = require('../../deploy/gcloudFunctions');

var vm_prefix = argv.prefix || 'agent-';
var zone = argv.zone || 'eastus';
var project = argv.project || 'QA-HA-resources';

var min_timeout = argv.min_timeout || 30; // minimum 30 seconds
var max_timeout = argv.max_timeout || 90; // maximum 1.5 minute
var min_machines = argv.min_machines || 2; // minimum 3 machine
var max_machines = argv.max_machines || 3; // maximum 10 machines
var service = argv.service || 'azure';
var timeout = argv.timeout || 0; // time running in minutes

dotenv.load();
var account_email = argv.account || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
var account_key = argv.key_file || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

var funcs = null;
if (service === 'gcloud') {
    funcs = new GcloudFunctions(account_email, account_key, project, zone);
} else {
    funcs = new AzureFunctions(clientId, domain, secret, subscriptionId, project, zone);
}

// var authClient = new google.auth.JWT(
//     account_email, account_key, null, ['https://www.googleapis.com/auth/compute']);
var machines_number = 0;
var start = Date.now();
return funcs.authenticate()
    .then(() => funcs.listVirtualMachines(vm_prefix))
    .then(listVM => {
        if (timeout !== 0) {
            console.log('will keep killing machines for ', timeout, 'minutes');
        }
        machines_number = listVM.length;
        return promise_utils.pwhile(() => (timeout === 0 || ((Date.now() - start) / (60 * 1000)) < timeout), () => {
            var rand_machine;
            var rand_timeout = Math.floor(Math.random() * (max_timeout - min_timeout) + min_timeout);
            console.log('Number of ON machines are: ' + machines_number);
            return funcs.getRandomMachine(vm_prefix)
                .then(machine => {
                    rand_machine = machine;
                    console.log('Random machine is ' + machine);
                    console.log('Sleeping for ' + rand_timeout + ' seconds');
                    return funcs.getMachineStatus(rand_machine);
                })
                .delay(rand_timeout * 1000) // sleep for timeout in milliseconds
                .then(status => {
                    if ((status === 'VM stopped') && (machines_number < max_machines)) {
                        console.log('Turning ON machine: ' + rand_machine);
                        return funcs.startVirtualMachine(rand_machine)
                            .then(() => funcs.waitMachineState(rand_machine, 'VM running'));
                    } else if ((status === 'VM running') && (machines_number > min_machines)) {
                        console.log('Turning OFF machine: ' + rand_machine);
                        return funcs.stopVirtualMachine(rand_machine)
                            .then(() => funcs.waitMachineState(rand_machine, 'VM stopped'));
                    } else if (machines_number === 0) {
                        console.warn("List of VM is empty");
                    }
                });
        });
    })
    .then(() => {
        console.log(':) :) :) The Killing has stopped successfully! (: (: (:');
        process.exit(0);
    })
    .catch(err => {
        console.error(':( :( Errors during test ): ):', err);
        process.exit(1);
    });

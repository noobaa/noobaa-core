'use strict';

const promise_utils = require('../../util/promise_utils');
var dotenv = require('dotenv');
const gcops = require('../qa/gcops');
const argv = require('minimist')(process.argv);
var google = require('googleapis');

var vm_prefix = argv.vm_prefix || 'agent-instance-for-';
var zone = argv.zone || 'us-central1-a';
var project = argv.project || 'noobaa-test-1';
var min_timeout = argv.min_timeout || 30; // minimum 20 seconds
var max_timeout = argv.max_timeout || 120; // maximum 1 minute
var min_machines = argv.min_machines || 6; // minimum 3 machine
var max_machines = argv.max_machines || 10; // maximum 10 machines


dotenv.load();
var account_email = argv.account || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
var account_key = argv.key_file || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

var authClient = new google.auth.JWT(
    account_email, account_key, null, ['https://www.googleapis.com/auth/compute']);
var machines_number = 0;
return gcops.count_on_machines(project, authClient, zone, vm_prefix)
    .then(count => {
        machines_number = count;
        return promise_utils.pwhile(() => true, () => {
            var rand_machine;
            var rand_timeout = Math.floor(Math.random() * (max_timeout - min_timeout) + min_timeout);
            console.log('Number of ON machines are: ' + machines_number);
            return gcops.get_random_machine(project, authClient, zone, vm_prefix)
                .then(machine => {
                    rand_machine = machine;
                    console.log('Sleeping for ' + rand_timeout + ' seconds');
                    return gcops.get_machine_status(project, authClient, zone, rand_machine);
                })
                .delay(rand_timeout * 1000) // sleep for timeout in milliseconds
                .then(status => {
                    if ((status === 'TERMINATED') && (machines_number < max_machines)) {
                        console.log('Turning ON machine: ' + rand_machine);
                        machines_number++;
                        return gcops.start_machine(project, authClient, zone, rand_machine)
                            .then(() => gcops.wait_machine_state(project, authClient, zone, rand_machine, 'RUNNING'));
                    } else if ((status === 'RUNNING') && (machines_number > min_machines)) {
                        console.log('Turning OFF machine: ' + rand_machine);
                        machines_number--;
                        return gcops.stop_machine(project, authClient, zone, rand_machine)
                            .then(() => gcops.wait_machine_state(project, authClient, zone, rand_machine, 'TERMINATED'));
                    }
                });
        });
    });

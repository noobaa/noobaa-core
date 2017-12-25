/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const fs = require('fs');
const dbg = require('../../util/debug_module')(__filename);
const util = require('util');
const s3ops = require('../qa/s3ops');
const readline = require('readline');
const promise_utils = require('../../util/promise_utils');
const argv = require('minimist')(process.argv);

dbg.set_process_name('dataset');

module.exports = {
    run_test: run_test
};

const TEST_CFG_DEFAULTS = {
    server: '127.0.0.1', // local run on noobaa server
    bucket: 'first.bucket', // default bucket
    part_num_low: 2, // minimum 2 part - up to 100MB
    part_num_high: 10, // maximum 10 parts - down to 5MB - s3 minimum
    aging_timeout: 0, // time running in minutes
    max_depth: 1, // the maximum depth
    min_depth: 1, // the minimum depth
    size_units: 'MB', // the default units of the size is MB
    file_size_low: 50, // minimum 50MB
    file_size_high: 200, // maximum 200Mb
    dataset_size: 10, // DS of 10GB
};

const BASE_UNIT = 1024;
const UNIT_MAPPING = {
    KB: {
        data_multiplier: Math.pow(BASE_UNIT, 1),
        dataset_multiplier: Math.pow(BASE_UNIT, 2)
    },
    MB: {
        data_multiplier: Math.pow(BASE_UNIT, 2),
        dataset_multiplier: Math.pow(BASE_UNIT, 1)
    },
    GB: {
        data_multiplier: Math.pow(BASE_UNIT, 3),
        dataset_multiplier: Math.pow(BASE_UNIT, 0)
    }
};

const DATASET_NAME = 'DataSet_' + (Math.floor(Date.now() / 1000));
const JOURNAL_FILE = `./${DATASET_NAME}_journal.log`;
const CFG_MARKER = 'DATASETCFG-';
const ACTION_MARKER = 'ACT-';

//define colors
const Yellow = "\x1b[33;1m";
const NC = "\x1b[0m";

if (argv.help) {
    usage();
    process.exit(3);
}

let TEST_CFG = _.defaults(_.pick(argv, _.keys(TEST_CFG_DEFAULTS)), TEST_CFG_DEFAULTS);
TEST_CFG.data_multiplier = UNIT_MAPPING[TEST_CFG.size_units.toUpperCase()].data_multiplier || UNIT_MAPPING.MB.data_multiplier;
TEST_CFG.dataset_multiplier = UNIT_MAPPING[TEST_CFG.size_units.toUpperCase()].dataset_multiplier || UNIT_MAPPING.MB.dataset_multiplier;

//getting the default dataset size to the proper units.
if (TEST_CFG.dataset_size === 10) {
    TEST_CFG.dataset_size = Math.floor(TEST_CFG.dataset_size * TEST_CFG.dataset_multiplier);
}

if (TEST_CFG.file_size_high <= TEST_CFG.file_size_low) {
    TEST_CFG.file_size_low = 1;
} else if (TEST_CFG.file_size_low >= TEST_CFG.file_size_high) {
    TEST_CFG.file_size_high = TEST_CFG.dataset_size;
} else if (TEST_CFG.file_size_high >= TEST_CFG.dataset_size || TEST_CFG.file_size_low >= TEST_CFG.dataset_size) {
    TEST_CFG.file_size_low = 50;
    TEST_CFG.file_size_high = 200;
}

Object.freeze(TEST_CFG);

/*
ActionTypes defines the operations which will be used in the test
each action contains its name and can contain the following:

    include_random: should this action be included in random selection
    action: the actual func to run if this action is selected
    weight: how much weight this action gets (default is 1)
    randomizer: randomizer function for the action, returns the needed randomized paramters (names, sizes, etc.)

*/
const ACTION_TYPES = [{
    name: 'RANDOM',
    include_random: false,
}, {
    name: 'UPLOAD_NEW',
    include_random: true,
    weight: 2,
    action: upload_new,
    randomizer: upload_new_randomizer
}, {
    name: 'COPY',
    include_random: true,
    weight: 1,
    action: copy,
    randomizer: copy_randomizer
}, {
    name: 'UPLOAD_OVERWRITE',
    include_random: true,
    weight: 1,
    action: upload_overwrite,
    randomizer: upload_overwrite_randomizer
}, {
    name: 'RENAME',
    include_random: true,
    weight: 1,
    action: run_rename,
    randomizer: rename_randomizer
}, {
    name: 'SET_ATTR',
    include_random: true,
    weight: 1,
    action: set_attribute,
    randomizer: set_attribute_randomizer
}, {
    name: 'READ',
    include_random: true,
    weight: 6,
    action: read,
    randomizer: read_randomizer
}, {
    name: 'DELETE',
    include_random: false,
    action: run_delete,
    randomizer: delete_randomizer
}];

let RANDOM_SELECTION = [];

/*
    Populate array for random selection according to desired weights
*/
function populate_random_selection() {
    for (let i = 0; i < ACTION_TYPES.length; ++i) {
        const selected = ACTION_TYPES[i];
        if (selected.include_random) {
            let calc_weight = Math.floor(selected.weight);
            if (!selected.randomizer) {
                console.error(`ACTION ${selected.name} does not include a randomizer, cannot create setup`);
            }
            _.times(calc_weight, () => RANDOM_SELECTION.push(selected));
        }
    }

    Object.freeze(RANDOM_SELECTION);
}
populate_random_selection();

let TEST_STATE = {
    current_size: 0,
    count: 0,
    aging: false
};

/*********
 * UTILS
 *********/

function usage() {
    console.log(`
    --server            -   azure location (default: ${TEST_CFG_DEFAULTS.server})
    --bucket            -   bucket to run on (default: ${TEST_CFG_DEFAULTS.bucket})
    --part_num_low      -   min part number in multipart (default: ${TEST_CFG_DEFAULTS.part_num_low})
    --part_num_high     -   max part number in multipart (default: ${TEST_CFG_DEFAULTS.part_num_high}) 
    --aging_timeout     -   time to run aging in min (default: ${TEST_CFG_DEFAULTS.aging_timeout})
    --min_depth         -   min depth of directorys (default: ${TEST_CFG_DEFAULTS.min_depth})
    --max_depth         -   mxa depth of directorys (default: ${TEST_CFG_DEFAULTS.max_depth})
    --size_units        -   size of units (default: ${TEST_CFG_DEFAULTS.size_units})
    --file_size_low     -   lowest file size (min 50 MB) (default: ${TEST_CFG_DEFAULTS.file_size_low})
    --file_size_high    -   highest file size (max 200 MB) (default: ${TEST_CFG_DEFAULTS.file_size_high})
    --dataset_size      -   dataset size (default: ${TEST_CFG_DEFAULTS.dataset_size})
    --replay            -   replays a given scenario, requires a path to the journal file. 
                            server and bucket are the only applicable parameters when running in replay mode  
    --help              -   show this help
    `);
}

function log_journal_file(item) {
    return fs.appendFileAsync(JOURNAL_FILE, item + '\n');
}

/*
    Select a random or specific action and journal
*/
function act_and_log(action_type) {
    let chosen;
    let idx;
    if (action_type === 'RANDOM') {
        chosen = RANDOM_SELECTION[Math.floor(Math.random() * RANDOM_SELECTION.length)];
    } else {
        idx = _.findIndex(ACTION_TYPES, ac => ac.name === action_type);
        if (idx === -1) {
            console.error(`Cannot find action ${action_type}`);
            process.exit(1);
        } else {
            chosen = ACTION_TYPES[idx];
        }
    }

    let randomized_params;
    return P.resolve()
        .then(() => chosen.randomizer())
        .then(res => {
            randomized_params = res;
            randomized_params.action = chosen.name;
            return log_journal_file(`${ACTION_MARKER}${JSON.stringify(randomized_params)}`);
        })
        .then(() => chosen.action(randomized_params));
}

// returning a file name with the proper depth
function get_filename() {
    let file_name = DATASET_NAME;
    if (TEST_CFG.min_depth === 1 && TEST_CFG.max_depth === 1) {
        file_name += '/';
    } else if (TEST_CFG.max_depth === 0) {
        file_name = `${DATASET_NAME}_`;
    } else {
        let random_max_depth = Math.floor(Math.random() * (TEST_CFG.max_depth + 1));
        console.log(`random_max_depth: ${random_max_depth}`);
        if (random_max_depth <= TEST_CFG.min_depth) {
            if (random_max_depth === 0) {
                file_name = `${DATASET_NAME}_`;
            } else {
                file_name += '/';
                let current_depth = 2;
                // return
                while (current_depth <= TEST_CFG.min_depth) {
                    file_name += `depth${current_depth}/`;
                    current_depth += 1;
                }
            }
        } else {
            file_name += '/';
            let current_depth = 2;
            while (current_depth <= random_max_depth) {
                file_name += `depth${current_depth}/`;
                current_depth += 1;
            }

            while (current_depth <= random_max_depth) {
                file_name += `depth${current_depth}/`;
                current_depth += 1;
            }
        }
    }
    return `${file_name}file${TEST_STATE.count}`;
}

function set_fileSize() {
    let rand_size = Math.floor((Math.random() * (TEST_CFG.file_size_high - TEST_CFG.file_size_low)) + TEST_CFG.file_size_low);
    if (TEST_CFG.dataset_size - TEST_STATE.current_size === 0) {
        rand_size = 1;
        //if we choose file size grater then the remaining space for the dataset,
        //set it to be in the size that complet the dataset size.
    } else if (rand_size > TEST_CFG.dataset_size - TEST_STATE.current_size) {
        rand_size = TEST_CFG.dataset_size - TEST_STATE.current_size;
    }
    return rand_size;
}

/*********
 * ACTIONS
 *********/
function read_randomizer() {
    return s3ops.get_a_random_file(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .tap(res => console.info(`Slected to download: ${res.Key}, size: ${res.Size}`))
        .then(res => ({
            filename: res.Key
        }));
}

function read(params) {
    console.log(`running read`);
    return P.resolve()
        .then(() => s3ops.get_file_check_md5(TEST_CFG.server, TEST_CFG.bucket, params.filename));
}

function upload_new_randomizer() {
    let is_multi_part = Math.floor(Math.random() * 2) === 0;
    let rand_size = set_fileSize();
    let rand_parts;
    if (is_multi_part) {
        rand_parts = (Math.floor(Math.random() *
            (TEST_CFG.part_num_high - TEST_CFG.part_num_low)) +
            TEST_CFG.part_num_low);
    }
    let file_name = get_filename();

    let res = {
        is_multi_part,
        rand_size,
        file_name
    };
    if (res.is_multi_part) {
        res.rand_parts = rand_parts;
    }
    return res;
}

function upload_new(params) {
    //skipping new writes when dataset size is as requested size.
    if (!TEST_STATE.aging || !TEST_STATE.current_size === TEST_CFG.dataset_size) {
        // running put new - multi-part
        if (params.is_multi_part) {
            if (params.rand_size / params.rand_parts >= 5) {
                if (TEST_STATE.aging) {
                    console.log(`running upload new - multi-part`);
                } else {
                    console.log(`Loading... currently uploaded
                        ${TEST_STATE.current_size} ${TEST_CFG.size_units} from desired 
                        ${TEST_CFG.dataset_size} ${TEST_CFG.size_units}`);
                }
                console.log(`uploading ${params.file_name} with size: ${params.rand_size}${TEST_CFG.size_units}`);
                return s3ops.upload_file_with_md5(
                    TEST_CFG.server, TEST_CFG.bucket, params.file_name,
                    params.rand_size, params.rand_parts, TEST_CFG.data_multiplier)
                    .then(res => {
                        console.log(`file multi-part uploaded was
                            ${params.file_name} with ${params.rand_parts} parts`);
                        TEST_STATE.current_size += params.rand_size;
                        TEST_STATE.count += 1;
                    });
            } else {
                console.warn(`size parts are
                    ${params.rand_size / params.rand_parts}
                    , parts must bet larger then 5MB, skipping upload overwrite - multi-part`);
            }
            // running put new
        } else {
            if (TEST_STATE.aging) {
                console.log(`running upload new`);
            } else {
                console.log(`Loading... currently uploaded 
                    ${TEST_STATE.current_size} ${TEST_CFG.size_units} from desired 
                    ${TEST_CFG.dataset_size} ${TEST_CFG.size_units}`);
            }
            console.log(`uploading ${params.file_name} with size: ${params.rand_size}${TEST_CFG.size_units}`);
            return s3ops.put_file_with_md5(TEST_CFG.server, TEST_CFG.bucket, params.file_name, params.rand_size, TEST_CFG.data_multiplier)
                .then(res => {
                    console.log(`file uploaded was ${params.file_name}`);
                    TEST_STATE.current_size += params.rand_size;
                    TEST_STATE.count += 1;
                });
        }
    } else if (params.is_multi_part) {
        console.warn(`dataset size is ${TEST_STATE.current_size}, skipping upload new - multi-part`);
    } else {
        console.warn(`dataset size is ${TEST_STATE.current_size}, skipping upload new`);
    }
    return P.resolve();
}

function upload_overwrite_randomizer() {
    let rand_size = set_fileSize();
    let is_multi_part = Math.floor(Math.random() * 2) === 0;
    let rand_parts;
    if (is_multi_part) {
        rand_parts = (Math.floor(Math.random() * (TEST_CFG.part_num_high - TEST_CFG.part_num_low)) +
            TEST_CFG.part_num_low);
    }
    return s3ops.get_a_random_file(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .then(rfile => {
            let res = {
                is_multi_part,
                rand_size,
                filename: rfile.Key,
                oldsize: rfile.Size
            };
            if (res.is_multi_part) {
                res.rand_parts = rand_parts;
            }
            return res;
        });
}

function upload_overwrite(params) {
    if (params.is_multi_part) {
        if (params.rand_size / params.rand_parts >= 5) {
            console.log(`running upload overwrite - multi-part`);
            return s3ops.upload_file_with_md5(
                TEST_CFG.server, TEST_CFG.bucket, params.filename,
                params.rand_size, params.rand_parts, TEST_CFG.data_multiplier)
                .tap(() => console.log(`file upload (multipart) overwritten was ${params.filename} with ${params.rand_parts} parts`))
                .then(() => {
                    TEST_STATE.current_size -= Math.floor(params.oldsize / TEST_CFG.data_multiplier);
                    TEST_STATE.current_size += params.rand_size;
                });
        } else {
            console.warn(`size parts are ${
                params.rand_size / params.rand_parts
                }, parts must bet larger then 5MB, skipping upload overwrite - multi-part`);
        }
    } else {
        console.log(`running upload overwrite`);
        return s3ops.put_file_with_md5(
            TEST_CFG.server, TEST_CFG.bucket, params.filename,
            params.rand_size, TEST_CFG.data_multiplier)
            .tap(name => console.log(`file upload (put) overwritten was ${params.filename}`))
            .then(() => {
                TEST_STATE.current_size -= Math.floor(params.oldsize / TEST_CFG.data_multiplier);
                TEST_STATE.current_size += params.rand_size;
            });
    }
    return P.resolve();
}

function copy_randomizer() {
    let file_name = get_filename();
    return s3ops.get_a_random_file(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .then(res => ({
            new_filename: file_name,
            old_filename: res.Key
        }));
}

function copy(params) {
    console.log(`running copy object from ${params.old_filename} to ${params.new_filename}`);
    return s3ops.copy_file_with_md5(TEST_CFG.server, TEST_CFG.bucket, params.old_filename, params.new_filename)
        .then(res => {
            TEST_STATE.count += 1;
            console.log(`file copied to: ${params.new_filename}`);
            return s3ops.get_file_size(TEST_CFG.server, TEST_CFG.bucket, params.new_filename)
                .then(size => {
                    TEST_STATE.current_size += size;
                });
        });
}

function rename_randomizer() {
    let file_name = get_filename();
    return s3ops.get_a_random_file(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .then(res => ({
            new_filename: file_name,
            old_filename: res.Key
        }));
}

function run_rename(params) {
    console.log(`running rename object from ${params.old_filename} to ${params.new_filename}`);
    return s3ops.copy_file_with_md5(TEST_CFG.server, TEST_CFG.bucket, params.old_filename, params.new_filename)
        .then(() => s3ops.delete_file(TEST_CFG.server, TEST_CFG.bucket, params.old_filename));
}

function set_attribute_randomizer() {
    // setting attribute using:
    // putObjectTagging - 50%
    // copyObject - 50%
    let useCopy = Math.floor(Math.random() * 2) === 0;
    useCopy = true; //currently doing only copy due to bug #3228

    return s3ops.get_a_random_file(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .then(res => ({
            filename: res.Key,
            useCopy: useCopy
        }));
}

function set_attribute(params) {
    console.log(`running set attribute for ${params.filename}`);
    if (params.useCopy) {
        console.log(`setting attribute using copyObject`);
        return s3ops.set_file_attribute_with_copy(TEST_CFG.server, TEST_CFG.bucket, params.filename);
    } else {
        console.log(`setting attribute using putObjectTagging`);
        return s3ops.set_file_attribute(TEST_CFG.server, TEST_CFG.bucket, params.filename);
    }
}

function delete_randomizer() {
    return s3ops.get_a_random_file(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .then(res => ({
            filename: res.Key,
            size: res.Size
        }));
}

function run_delete(params) {
    console.log(`runing delete`);
    return s3ops.get_file_number(TEST_CFG.server, TEST_CFG.bucket, DATASET_NAME)
        .then(object_number => {
            // won't delete the last file in the bucket
            if (object_number > 1) {
                return s3ops.delete_file(TEST_CFG.server, TEST_CFG.bucket, params.filename)
                    .then(() => {
                        TEST_STATE.current_size -= Math.floor(params.size / TEST_CFG.data_multiplier);
                    });
            } else {
                console.log(`${Yellow}only one file, skipping delete${NC}`);
                return P.resolve();
            }
        });
}

/*********
 * MAIN
 *********/
function run_test() {
    return P.resolve()
        .then(() => log_journal_file(`${CFG_MARKER}${DATASET_NAME}-${JSON.stringify(TEST_CFG)}`))
        .then(() => promise_utils.pwhile(() => TEST_STATE.current_size < TEST_CFG.dataset_size, () => act_and_log('UPLOAD_NEW'))
            // aging
            .then(() => {
                console.log('NBNB after pwhile');
                TEST_STATE.aging = true;
                const start = Date.now();
                if (TEST_CFG.aging_timeout !== 0) {
                    console.log(`will run aging for ${TEST_CFG.aging_timeout} minutes`);
                }
                return promise_utils.pwhile(() =>
                    (TEST_CFG.aging_timeout === 0 || ((Date.now() - start) / (60 * 1000)) < TEST_CFG.aging_timeout), () => {
                        console.log(`Aging... currently uploaded ${TEST_STATE.current_size} ${TEST_CFG.size_units} from desired 
                        ${TEST_CFG.dataset_size} ${TEST_CFG.size_units}`);

                        let action_type;
                        if (TEST_STATE.current_size > TEST_CFG.dataset_size) {
                            console.log(`${Yellow}the current dataset size is
                                ${TEST_STATE.current_size}${TEST_CFG.size_units} and the reqested dataset size is
                                ${TEST_CFG.dataset_size}${TEST_CFG.size_units}, going to delete${NC}`);
                            action_type = 'DELETE';
                        } else {
                            action_type = 'RANDOM';
                        }
                        return P.resolve()
                            .then(() => act_and_log(action_type));
                    });
            })
            .then(() => {
                console.log(`Everything finished with success!`);
                process.exit(0);
            })
            .catch(err => {
                console.error(`Errors during test`, err);
                process.exit(4);
            }));
}

function run_replay() {
    let journal = [];
    const readfile = readline.createInterface({
        input: fs.createReadStream(argv.replay),
        terminal: false
    });
    return new P((resolve, reject) => {
        readfile
            .on('line', line => journal.push(line))
            .once('error', reject)
            .once('close', resolve);
    })
        .then(() => {
            //first line should contain the TEST_CFG
            console.log(`journal[0] ${journal[0]}`);
            if (!journal[0].startsWith(`${CFG_MARKER}`)) {
                console.error('Expected CFG as first line of replay');
                process.exit(5);
            }
            TEST_CFG = JSON.parse(journal[0].slice(CFG_MARKER.length + DATASET_NAME.length + 1));
            let iline = 1;
            let idx;
            let current_action;
            let current_params;
            return promise_utils.pwhile(
                () => iline < journal.length,
                () => P.resolve()
                    .then(() => {
                        //split action from params
                        current_params = JSON.parse(journal[iline].slice(ACTION_MARKER.length));
                        current_action = current_params.action;
                        delete current_params.action;
                        console.log(`Calling ${current_action} with parameters ${util.inspect(current_params)}`);
                        //run single selected activity
                        idx = _.findIndex(ACTION_TYPES, ac => ac.name === current_action);
                        if (idx === -1) {
                            console.error(`Cannot find action ${current_action}`);
                            process.exit(1);
                        } else {
                            return ACTION_TYPES[idx].action(current_params);
                        }

                    })
                    .catch(err => console.error(`Failed replaying action ${current_action} with ${err}`))
                    .finally(() => {
                        iline += 1;
                    })
            );
        })
        .catch(err => {
            console.error('Failed replaying journal file ', err);
            process.exit(5);
        });
}

function main() {
    return P.resolve()
        .then(() => {
            if (argv.replay) {
                return run_replay();
            } else {
                return run_test();
            }
        })
        .then(() => {
            process.exit(0);
        })
        .catch(function(err) {
            console.warn('error while running test ', err);
            process.exit(6);
        });
}

if (require.main === module) {
    main();
}

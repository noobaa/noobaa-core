/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const readline = require('readline');
const P = require('../../util/promise');
const seedrandom = require('seedrandom');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);

const test_name = 'dataset';
dbg.set_process_name(test_name);

module.exports = {
    run_test: run_test,
    init_parameters: init_parameters,
};

const TEST_CFG_DEFAULTS = {
    s3_ip: '',
    s3_port_https: 443,
    access_key: undefined,
    secret_key: undefined,
    bucket: 'first.bucket', // default bucket
    part_num_low: 2, // minimum 2 part - up to 100MB
    part_num_high: 10, // maximum 10 parts - down to 5MB - s3 minimum
    aging_timeout: 0, // time running in minutes
    max_depth: 1, // the maximum depth
    min_depth: 10, // the minimum depth
    size_units: 'MB', // the default units of the size is MB
    file_size_low: 50, // minimum 50MB
    file_size_high: 200, // maximum 200Mb
    dataset_size: 10, // DS of 10GB
    versioning: false,
    no_exit_on_success: false,
    seed: crypto.randomBytes(10).toString('hex')
};

const TEST_STATE_INITIAL = {
    current_size: 0,
    count: 0,
    aging: false
};

const BASE_UNIT = 1024;
const UNIT_MAPPING = {
    KB: {
        data_multiplier: BASE_UNIT ** 1,
        dataset_multiplier: BASE_UNIT ** 2
    },
    MB: {
        data_multiplier: BASE_UNIT ** 2,
        dataset_multiplier: BASE_UNIT ** 1
    },
    GB: {
        data_multiplier: BASE_UNIT ** 3,
        dataset_multiplier: BASE_UNIT ** 0
    }
};

const DATASET_NAME = 'DataSet_' + (Math.floor(Date.now() / 1000));
const JOURNAL_FILE = `/tmp/${DATASET_NAME}_journal.log`;
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
let TEST_STATE = { ...TEST_STATE_INITIAL };
const s3ops = new S3OPS({
    ip: TEST_CFG.s3_ip,
    ssl_port: TEST_CFG.s3_port_https,
    access_key: TEST_CFG.access_key,
    secret_key: TEST_CFG.secret_key
});

update_dataset_sizes();

let report = new Report();
const cases = [
    'RANDOM',
    'UPLOAD_NEW',
    'SERVER_SIDE_COPY',
    'CLIENT_SIDE_COPY',
    'UPLOAD_OVERWRITE',
    'UPLOAD_AND_ABORT',
    'RENAME',
    'SET_ATTR',
    'READ',
    'READ_RANGE',
    'DELETE',
    'MULTI_DELETE',
];
report.init_reporter({ suite: test_name, conf: TEST_CFG, mongo_report: true, cases: cases });

/*
ActionTypes defines the operations which will be used in the test
each action contains its name and can contain the following:

    include_random: should this action be included in random selection
    action: the actual func to run if this action is selected
    weight: how much weight this action gets (default is 1)
    randomizer: randomizer function for the action, returns the needed randomized parameters (names, sizes, etc.)

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
    name: 'SERVER_SIDE_COPY',
    include_random: true,
    weight: 1,
    action: server_side_copy,
    randomizer: server_side_copy_randomizer
}, {
    name: 'CLIENT_SIDE_COPY',
    include_random: true,
    weight: 1,
    action: client_side_copy,
    randomizer: client_side_copy_randomizer
}, {
    name: 'UPLOAD_OVERWRITE',
    include_random: true,
    weight: 1,
    action: upload_overwrite,
    randomizer: upload_overwrite_randomizer
}, {
    name: 'UPLOAD_AND_ABORT',
    include_random: true,
    weight: 1,
    action: upload_and_abort,
    randomizer: upload_abort_randomizer
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
    weight: 3,
    action: read,
    randomizer: read_randomizer
}, {
    name: 'READ_RANGE',
    include_random: true,
    weight: 2,
    action: read_range,
    randomizer: read_range_randomizer
}, {
    name: 'DELETE',
    include_random: false,
    action: run_delete,
    randomizer: delete_randomizer
}, {
    name: 'MULTI_DELETE',
    include_random: false,
    action: run_multi_delete,
    randomizer: multi_delete_randomizer
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

/*********
 * UTILS
 *********/

function usage() {
    console.log(`
    --s3_ip                 -   noobaa s3 ip
    --s3_port_https         -   noobaa s3 port in https (default: ${TEST_CFG_DEFAULTS.s3_port_https})
    --access_key            -   S3 storage access key
    --secret_key            -   S3 storage secret key
    --bucket                -   bucket to run on (default: ${TEST_CFG_DEFAULTS.bucket})
    --part_num_low          -   min part number in multipart (default: ${TEST_CFG_DEFAULTS.part_num_low})
    --part_num_high         -   max part number in multipart (default: ${TEST_CFG_DEFAULTS.part_num_high}) 
    --aging_timeout         -   time to run aging in min (default: ${TEST_CFG_DEFAULTS.aging_timeout})
    --min_depth             -   min depth of directories (default: ${TEST_CFG_DEFAULTS.min_depth})
    --max_depth             -   max depth of directories (default: ${TEST_CFG_DEFAULTS.max_depth})
    --size_units            -   size of units in KB/MB/GB (default: ${TEST_CFG_DEFAULTS.size_units})
    --file_size_low         -   lowest file size (min 50 MB) (default: ${TEST_CFG_DEFAULTS.file_size_low})
    --file_size_high        -   highest file size (max 200 MB) (default: ${TEST_CFG_DEFAULTS.file_size_high})
    --dataset_size          -   dataset size (default: ${TEST_CFG_DEFAULTS.dataset_size})
    --versioning            -   run dataset in versioning mode (assumption: bucket versioning is ENABLED)
    --replay                -   replays a given scenario, requires a path to the journal file. 
                                server and bucket are the only applicable parameters when running in replay mode  
    --seed                  -   seed for random generator. testing with the same seed generates the same sequence of operations.
    --no_aging              -   skip aging stage
    --no_exit_on_success    -   do not exit when test is successful
    --help                  -   show this help
    `);
}

function update_dataset_sizes() {
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
}

function log_journal_file(item) {
    return fs.promises.appendFile(JOURNAL_FILE, item + '\n');
}

/*
    Select a random or specific action and journal
*/
async function act_and_log(action_type) {
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
    try {
        const res = await chosen.randomizer();
        const randomized_params = _.omit(res, 'extra');
        randomized_params.action = chosen.name;
        await log_journal_file(`${ACTION_MARKER}${JSON.stringify(randomized_params)}`);
        await chosen.action(randomized_params);
        await report.success(chosen.name);
    } catch (err) {
        await report.fail(chosen.name);
        throw err;
    }
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
        //set it to be in the size that complete the dataset size.
    } else if (rand_size > TEST_CFG.dataset_size - TEST_STATE.current_size) {
        rand_size = TEST_CFG.dataset_size - TEST_STATE.current_size;
    }
    return rand_size;
}

//Should use versioning operation randomizer
function should_use_versioning() {
    //When no objects exists (first upload), can't use versioning
    return (TEST_CFG.versioning && TEST_STATE.count) ? Math.round(Math.random()) : 0;
}

function get_random_file(skip_version_check) {
    //If versioning enabled AND skip_version_check not true, randomize between working on specific version vs. working on current
    if (should_use_versioning() && !skip_version_check) {
        return s3ops.get_a_random_version_file(TEST_CFG.bucket, DATASET_NAME)
            .then(res => ({
                filename: res.Key,
                versionid: res.VersionId,
                extra: {
                    size: res.Size,
                }
            }));
    } else {
        return s3ops.get_a_random_file(TEST_CFG.bucket, DATASET_NAME)
            .then(res => ({
                filename: res.Key,
                extra: {
                    size: res.Size,
                }
            }));
    }
}

function check_min_part_size(rand_size, rand_parts) {
    if (TEST_CFG.size_units === 'KB' && rand_size / rand_parts >= (5 * 1024)) {
        return true;
    } else if (TEST_CFG.size_units === 'MB' && rand_size / rand_parts >= 5) {
        return true;
    }
    return false;
}

/*********
 * ACTIONS
 *********/
async function read_randomizer() {
    const randomFile = await get_random_file();
    console.info(`Selected to read file: ${randomFile.filename}, size: ${randomFile.extra && randomFile.extra.size} ${
        randomFile.versionid ? ', version: ' + randomFile.versionid : ''}`);
    return randomFile;
}

async function read(params) {
    console.log(`running read`);
    await s3ops.get_file_check_md5(TEST_CFG.bucket, params.filename, { versionid: params.versionid });
}

async function read_range_randomizer() {
    let rand_parts = (Math.floor(Math.random() * (TEST_CFG.part_num_high - TEST_CFG.part_num_low)) +
        TEST_CFG.part_num_low);
    const randomFile = await get_random_file();
    console.info(`Selected to read_range: ${randomFile.filename}, size: ${randomFile.extra && randomFile.extra.size}, with ${
            rand_parts} ranges ${randomFile.versionid ? ', version: ' + randomFile.versionid : ''}`);
    randomFile.rand_parts = rand_parts;
    return randomFile;
}

async function read_range(params) {
    console.log(`running read_range ${params.filename} ${params.versionid ? ', version: ' + params.versionid : ''}`);
    await s3ops.get_file_ranges_check_md5(TEST_CFG.bucket, params.filename,
        params.rand_parts, { versionid: params.versionid });
}

async function upload_new_randomizer() {
    let is_multi_part = Math.floor(Math.random() * 2) === 0;
    let rand_size = set_fileSize();
    let file_name;
    let rand_parts;
    if (is_multi_part) {
        rand_parts = (Math.floor(Math.random() *
                (TEST_CFG.part_num_high - TEST_CFG.part_num_low)) +
            TEST_CFG.part_num_low);
    }
    if (rand_size / rand_parts < 5242880) {
        console.log(`part size is too low ${rand_size / rand_parts}, skipping multipart upload`);
        is_multi_part = false;
    }
    //If versioning is enabled, randomize between uploading a new key and a new version
    if (should_use_versioning()) {
        console.log('Uploading a new version');
        const randomFile = await get_random_file(true);
        file_name = randomFile.filename; /*skip version check*/
    } else {
        console.log('Uploading a new key');
        file_name = get_filename();
    }
    let res = {
        is_multi_part,
        rand_size,
        file_name,
        rand_parts: is_multi_part ? rand_parts : undefined,
    };
    return res;
}

async function upload_new(params) {
    //skipping new writes when dataset size is as requested size.
    if (!TEST_STATE.aging || !TEST_STATE.current_size === TEST_CFG.dataset_size) {
        // running put new - multi-part
        if (params.is_multi_part) {
            if (check_min_part_size(params.rand_size, params.rand_parts)) {
                if (TEST_STATE.aging) {
                    console.log(`running upload new - multi-part`);
                } else {
                    console.log(`Loading... currently uploaded ${
                        TEST_STATE.current_size} ${TEST_CFG.size_units} from desired ${
                            TEST_CFG.dataset_size} ${TEST_CFG.size_units}`);
                }
                console.log(`uploading ${params.file_name} with size: ${params.rand_size}${TEST_CFG.size_units}`);
                await s3ops.upload_file_with_md5(
                    TEST_CFG.bucket, params.file_name,
                    params.rand_size, params.rand_parts, TEST_CFG.data_multiplier);
                console.log(`file multi-part uploaded was ${
                            params.file_name} with ${params.rand_parts} parts`);
                TEST_STATE.current_size += params.rand_size;
                TEST_STATE.count += 1;
            } else {
                console.warn(`size parts are ${
                    params.rand_size / params.rand_parts
                }, parts must be larger then 5MB, skipping upload overwrite - multi-part`);
            }
            // running put new
        } else {
            if (TEST_STATE.aging) {
                console.log(`running upload new`);
            } else {
                console.log(`Loading... currently uploaded ${
                    TEST_STATE.current_size} ${TEST_CFG.size_units} from desired ${
                        TEST_CFG.dataset_size} ${TEST_CFG.size_units}`);
            }
            console.log(`uploading ${params.file_name} with size: ${params.rand_size}${TEST_CFG.size_units}`);
            await s3ops.put_file_with_md5(TEST_CFG.bucket, params.file_name, params.rand_size, TEST_CFG.data_multiplier);
            console.log(`file uploaded was ${params.file_name}`);
            TEST_STATE.current_size += params.rand_size;
            TEST_STATE.count += 1;
        }
    } else if (params.is_multi_part) {
        console.warn(`dataset size is ${TEST_STATE.current_size}, skipping upload new - multi-part`);
    } else {
        console.warn(`dataset size is ${TEST_STATE.current_size}, skipping upload new`);
    }
}

function upload_abort_randomizer() {
    let file_name = get_filename(); //No versionid for uploads, no need to handle versioning
    let res = {
        is_multi_part: true,
        file_name,
    };
    return res;
}

async function upload_and_abort(params) {
    console.log(`running upload multi-part and abort`);
    console.log(`initiating ${params.file_name}`);
    await s3ops.create_multipart_upload(TEST_CFG.bucket, params.file_name);
    const uploadId = await s3ops.get_object_uploadId(TEST_CFG.bucket, params.file_name);
    await s3ops.abort_multipart_upload(TEST_CFG.bucket, params.file_name, uploadId);
    TEST_STATE.count += 1;
    console.log(`file multi-part uploaded ${params.file_name} was aborted`);
}

async function upload_overwrite_randomizer() {
    //upload overwrite in a versioning case would simply create a new version, no need for special handling
    let rand_size = set_fileSize();
    let is_multi_part = Math.floor(Math.random() * 2) === 0;
    let rand_parts;
    if (is_multi_part) {
        rand_parts = (Math.floor(Math.random() * (TEST_CFG.part_num_high - TEST_CFG.part_num_low)) +
            TEST_CFG.part_num_low);
    }
    if (rand_size / rand_parts < 5242880) {
        console.log(`part size is too low ${rand_size / rand_parts}, skipping multipart upload`);
        is_multi_part = false;
    }
    const rfile = await s3ops.get_a_random_file(TEST_CFG.bucket, DATASET_NAME);
    let res = {
        is_multi_part,
        rand_size,
        filename: rfile.Key,
        oldsize: rfile.Size,
        rand_parts: is_multi_part ? rand_parts : undefined,
    };
    return res;
}

async function upload_overwrite(params) {
    if (params.is_multi_part) {
        if (params.rand_size / params.rand_parts >= 5) {
            console.log(`running upload overwrite - multi-part`);
            await s3ops.upload_file_with_md5(TEST_CFG.bucket, params.filename,
                params.rand_size, params.rand_parts, TEST_CFG.data_multiplier);
            console.log(`file upload (multipart) overwritten was ${params.filename} with ${params.rand_parts} parts`);
            TEST_STATE.current_size -= Math.floor(params.oldsize / TEST_CFG.data_multiplier);
            TEST_STATE.current_size += params.rand_size;
        } else {
            console.warn(`size parts are ${
                params.rand_size / params.rand_parts
                }, parts must be larger then 5MB, skipping upload overwrite - multi-part`);
        }
    } else {
        console.log(`running upload overwrite`);
        await s3ops.put_file_with_md5(TEST_CFG.bucket, params.filename, params.rand_size, TEST_CFG.data_multiplier);
        console.log(`file upload (put) overwritten was ${params.filename}`);
        TEST_STATE.current_size -= Math.floor(params.oldsize / TEST_CFG.data_multiplier);
        TEST_STATE.current_size += params.rand_size;
    }
}

async function server_side_copy_randomizer() {
    const file_name = get_filename();
    const randomFile = await get_random_file();
    return {
        new_filename: file_name,
        old_filename: {
            name: randomFile.filename,
            versionid: randomFile.versionid
        }
    };
}

async function server_side_copy(params) {
    console.log(`running server_side copy object from ${JSON.stringify(params.old_filename)}  to ${params.new_filename}`);
    await s3ops.server_side_copy_file_with_md5(
        TEST_CFG.bucket,
        params.old_filename.name,
        TEST_CFG.bucket,
        params.new_filename,
        params.old_filename.versionid);
    TEST_STATE.count += 1;
    console.log(`file copied to: ${params.new_filename}`);
    const size = await s3ops.get_file_size(TEST_CFG.bucket, params.new_filename);
    TEST_STATE.current_size += size;
}

async function client_side_copy_randomizer() {
    const file_name = get_filename();
    const randomFile = await get_random_file();
    return {
        new_filename: file_name,
        old_filename: {
            name: randomFile.filename,
            versionid: randomFile.versionid
        }
    };
}

async function client_side_copy(params) {
    console.log(`running client_side copy object from ${JSON.stringify(params.old_filename)} to ${params.new_filename}`);
    await s3ops.client_side_copy_file_with_md5(
        TEST_CFG.bucket,
        params.old_filename.name,
        params.new_filename,
        params.old_filename.versionid);
    console.log(`file copied to: ${params.new_filename}`);
    const size = await s3ops.get_file_size(TEST_CFG.bucket, params.new_filename);
    TEST_STATE.current_size += size;
    TEST_STATE.count += 1;
}

async function rename_randomizer() {
    const file_name = get_filename();
    const randomFile = await get_random_file();
    return {
        new_filename: file_name,
        old_filename: {
            name: randomFile.filename,
            versionid: randomFile.versionid
        }
    };
}

async function run_rename(params) {
    TEST_STATE.count += 1;
    console.log(`running rename object from ${JSON.stringify(params.old_filename)} to ${params.new_filename}`);
    await s3ops.server_side_copy_file_with_md5(
        TEST_CFG.bucket,
        params.old_filename.name,
        TEST_CFG.bucket,
        params.new_filename,
        params.old_filename.versionid);
    await s3ops.delete_file(TEST_CFG.bucket, params.old_filename.name, params.old_filename.versionid);
    TEST_STATE.count += 1;
}

async function set_attribute_randomizer() {
    // setting attribute using:
    // putObjectTagging - 50%
    // copyObject - 50%
    // let useCopy = Math.floor(Math.random() * 2) === 0;
    let useCopy = true; //currently doing only copy due to bug #3228

    const randomFile = await get_random_file();
    return {
        filename: randomFile.filename,
        versionid: randomFile.versionid,
        useCopy: useCopy
    };
}

async function set_attribute(params) {
    console.log(`running set attribute for ${params.filename} ${params.versionid ? ', version: ' + params.versionid : ''}`);
    if (params.useCopy) {
        console.log(`setting attribute using copyObject`);
        await s3ops.set_file_attribute_with_copy(TEST_CFG.bucket, params.filename, params.versionid);
    } else {
        console.log(`setting attribute using putObjectTagging`);
        await s3ops.set_file_attribute(TEST_CFG.bucket, params.filename, params.versionid);
    }
}

async function delete_randomizer() {
    const randomFile = await get_random_file();
    return {
        filename: randomFile.filename,
        versionid: randomFile.versionid,
        size: randomFile.extra.size
    };
}

async function run_delete(params) {
    console.log(`running delete ${params.filename} ${params.versionid ? ', version: ' + params.versionid : ''}`);
    const object_number = await s3ops.get_file_number(TEST_CFG.bucket, DATASET_NAME);
    // won't delete the last file in the bucket
    if (object_number > 1) {
        await s3ops.delete_file(TEST_CFG.bucket, params.filename, params.versionid);
        TEST_STATE.current_size -= Math.floor(params.size / TEST_CFG.data_multiplier);
    } else {
        console.log(`${Yellow}only one file, skipping delete${NC}`);
    }
}

function multi_delete_randomizer() {
    return P.map(_.times(2),
            () => get_random_file()
            .then(res => ({
                filename: res.filename,
                versionid: res.versionid,
                size: res.extra.size
            }))
        )
        .then(res => ({
            files: res
        }));
}

async function run_multi_delete(params) {
    console.log(`running multi delete`);
    const object_number = await s3ops.get_file_number(TEST_CFG.bucket, DATASET_NAME);
    // won't delete the last files in the bucket
    if (object_number > 2) {
        await s3ops.delete_multiple_files(TEST_CFG.bucket, params.files);
        for (const file of params.files) {
            TEST_STATE.current_size -= Math.floor(file.size / TEST_CFG.data_multiplier);
        }
    } else {
        console.log(`${Yellow}only two files, skipping multi delete${NC}`);
    }
}

/*********
 * MAIN
 *********/
function init_parameters({ dataset_params, report_params }) {
    TEST_STATE = { ...TEST_STATE_INITIAL };
    TEST_CFG = _.defaults(_.pick(dataset_params, _.keys(TEST_CFG)), TEST_CFG);

    update_dataset_sizes();
    const suite_name = report_params.suite_name || test_name;

    report.init_reporter({ suite: suite_name, conf: TEST_CFG, mongo_report: true, cases: cases, prefix: report_params.cases_prefix });
}

async function upload_new_files() {
    console.time('dataset upload');
    while (TEST_STATE.current_size < TEST_CFG.dataset_size) {
        await act_and_log('UPLOAD_NEW');
    }
    console.timeEnd('dataset upload');
}

function run_test(throw_on_fail) {
    return P.resolve()
        .then(() => log_journal_file(`${CFG_MARKER}${DATASET_NAME}-${JSON.stringify(TEST_CFG)}`))
        .then(() => upload_new_files()
            // aging
            .then(() => {
                if (argv.no_aging) {
                    console.log('skipping aging stage');
                    return;
                }
                TEST_STATE.aging = true;
                const start = Date.now();
                if (TEST_CFG.aging_timeout !== 0) {
                    console.log(`will run aging for ${TEST_CFG.aging_timeout} minutes`);
                }
                return P.pwhile(() =>
                    (TEST_CFG.aging_timeout === 0 || ((Date.now() - start) / (60 * 1000)) < TEST_CFG.aging_timeout), () => {
                        console.log(`Aging... currently uploaded ${TEST_STATE.current_size} ${TEST_CFG.size_units} from desired ${
                            TEST_CFG.dataset_size} ${TEST_CFG.size_units}`);
                        let action_type;
                        if (TEST_STATE.current_size > TEST_CFG.dataset_size) {
                            console.log(`${Yellow}the current dataset size is ${
                                TEST_STATE.current_size}${TEST_CFG.size_units} and the requested dataset size is ${
                                TEST_CFG.dataset_size}${TEST_CFG.size_units}, going to delete${NC}`);
                            action_type = Math.round(Math.random()) ? 'DELETE' : 'MULTI_DELETE';
                        } else {
                            action_type = 'RANDOM';
                        }
                        return P.resolve()
                            .then(() => act_and_log(action_type));
                    });
            })
            .then(async () => {
                await report.report();
            })
            .then(() => {
                console.log(`Everything finished with success!`);
                if (!TEST_CFG.no_exit_on_success) process.exit(0);
            })
            .catch(async err => {
                await report.report();
                console.error(`Errors during test`, err);
                if (throw_on_fail) {
                    throw new Error(`dataset failed`);
                } else {
                    process.exit(4);
                }
            }));
}

function run_replay() {
    let journal = [];
    const readfile = readline.createInterface({
        input: fs.createReadStream(argv.replay),
        terminal: false
    });
    return new Promise((resolve, reject) => {
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
            return P.pwhile(
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
                .then(() => report.success(current_action))
                .catch(err => report.fail(current_action)
                    .then(() => {
                        console.error(`Failed replaying action ${current_action} with ${err}`);
                        throw err;
                    })
                )
                .finally(() => {
                    iline += 1;
                })
            );
        })
        .then(async () => report.report())
        .catch(async err => {
            await report.report();
            console.error('Failed replaying journal file ', err);
            process.exit(5);
        });
}

async function main() {
    console.log(`Starting dataset. seeding randomness with seed ${TEST_CFG.seed}`);
    seedrandom(TEST_CFG.seed);
    try {
        if (argv.replay) {
            await run_replay();
        } else {
            await run_test(false);
        }
        if (!TEST_CFG.no_exit_on_success) process.exit(0);
    } catch (err) {
        console.warn('error while running test ', err);
        process.exit(6);
    }
}

if (require.main === module) {
    main();
}

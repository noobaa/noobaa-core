/* Copyright (C) 2016 NooBaa */
'use strict';

const s3ops = require('../qa/s3ops');
const promise_utils = require('../../util/promise_utils');
const argv = require('minimist')(process.argv);

const {
    server = '127.0.0.1', // local run on noobaa server
    bucket = 'first.bucket', // default bucket
    part_num_low = 2, // minimum 2 part - up to 100MB
    part_num_high = 10, // maximum 10 parts - down to 5MB - s3 minimum
    aging_timeout = 0, // time running in minutes
    max_depth = 1, // the maximum depth
    min_depth = 1, // the minimum depth
    size_units = 'MB', // the default units of the size is MB
    help = false
} = argv;

let {
    file_size_low = 50, // minimum 50MB
    file_size_high = 200, // maximum 200Mb
    dataset_size = 10, // DS of 10GB
} = argv;

function usage() {
    console.log(`
    --server            -   azure location (default: ${server})
    --bucket            -   bucket to run on (default: ${bucket})
    --part_num_low      -   min part number in multipart (default: ${part_num_low})
    --part_num_high     -   max part number in multipart (default: ${part_num_high}) 
    --aging_timeout     -   time to run aging in min (default: ${aging_timeout})
    --min_depth         -   min depth of directorys (default: ${min_depth})
    --max_depth         -   mxa depth of directorys (default: ${max_depth})
    --size_units        -   size of units (default: ${size_units})
    --file_size_low     -   lowest file size (min 50 MB) (default: ${file_size_low})
    --file_size_high    -   highest file size (max 200 MB) (default: ${file_size_high})
    --dataset_size      -   dataset size (default: ${dataset_size})
    --help              -   show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

const baseUnit = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: Math.pow(baseUnit, 1),
        dataset_multiplier: Math.pow(baseUnit, 2)
    },
    MB: {
        data_multiplier: Math.pow(baseUnit, 2),
        dataset_multiplier: Math.pow(baseUnit, 1)
    },
    GB: {
        data_multiplier: Math.pow(baseUnit, 3),
        dataset_multiplier: Math.pow(baseUnit, 0)
    }
};

const { data_multiplier, dataset_multiplier } = unit_mapping[size_units.toUpperCase()] || unit_mapping.MB;

//getting the default dataset size to the proper units.
if (dataset_size === 10) {
    dataset_size = Math.floor(dataset_size * dataset_multiplier);
}

if (file_size_high <= file_size_low) {
    file_size_low = 1;
} else if (file_size_low >= file_size_high) {
    file_size_high = dataset_size;
} else if (file_size_high >= dataset_size || file_size_low >= dataset_size) {
    file_size_low = 50;
    file_size_high = 200;
}

const actionTypeToFuncCall = {
    0: (...args) => upload_new(...args, true),
    1: (...args) => upload_new(...args, true),
    2: copy,
    3: upload_overwrite,
    4: upload_overwrite,
    5: run_rename,
    6: set_attribute,
    default: run_delete
};

const dataset_name = 'DataSet_' + (Math.floor(Date.now() / 1000));
let current_size = 0;
let count = 0;

//define colors
const Yellow = "\x1b[33;1m";
const NC = "\x1b[0m";

// returning a file name with the proper depth
function set_depth(dataset, file_count) {
    let file_name = dataset;
    if (min_depth === 1 && max_depth === 1) {
        file_name += '/';
    } else if (max_depth === 0) {
        file_name = `${dataset}_`;
    } else {
        let random_max_depth = Math.floor(Math.random() * (max_depth + 1));
        console.log(`random_max_depth: ${random_max_depth}`);
        if (random_max_depth <= min_depth) {
            if (random_max_depth === 0) {
                file_name = `${dataset}_`;
            } else {
                file_name += '/';
                let current_depth = 2;
                // return
                while (current_depth <= min_depth) {
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
    return `${file_name}file${file_count}`;
}

function set_fileSize() {
    let rand_size = Math.floor((Math.random() * (file_size_high - file_size_low)) + file_size_low);
    if (dataset_size - current_size === 0) {
        // rand_size = current_size;
        rand_size = 1;
        //if we choose file size grater then the remaining space for the dataset,
        //set it to be in the size that complet the dataset size.
    } else if (rand_size > dataset_size - current_size) {
        rand_size = dataset_size - current_size;
    }
    return rand_size;
}

function read(server_ip, bucket_name, dataset) {
    console.log(`running read`);
    return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
        .tap(res => console.info(`Slected to download: ${res.Key}, size: ${res.Size}`))
        .then(res => s3ops.get_file_check_md5(server_ip, bucket_name, res.Key));
}

function upload_new(server_ip, bucket_name, dataset, isAging) {
    let is_multi_part = Math.floor(Math.random() * 2) === 0;
    //skipping new writes when dataset size is as requested size.
    if (!isAging || !current_size === dataset_size) {
        let rand_size = set_fileSize();
        // running put new - multi-part
        if (is_multi_part) {
            let rand_parts = (Math.floor(Math.random() * (part_num_high - part_num_low)) + part_num_low);
            if (rand_size / rand_parts >= 5) {
                if (isAging) {
                    console.log(`running upload new - multi-part`);
                } else {
                    console.log(`Loading... currently uploaded ${
                        current_size} ${size_units} from desired ${
                        dataset_size} ${size_units}`);
                }
                count += 1;
                let file_name = set_depth(dataset, count);
                console.log(`uploading ${file_name} with size: ${rand_size}${size_units}`);
                return s3ops.upload_file_with_md5(server_ip, bucket_name, file_name, rand_size, rand_parts, data_multiplier)
                    .then(res => {
                        console.log(`file multi-part uploaded was ${
                            file_name} with ${rand_parts} parts`);
                        current_size += rand_size;
                    });
            } else {
                console.warn(`size parts are ${
                    rand_size / rand_parts
                    }, parts must bet larger then 5MB, skipping upload overwrite - multi-part`);
            }
            // running put new
        } else {
            if (isAging) {
                console.log(`running upload new`);
            } else {
                console.log(`Loading... currently uploaded ${
                    current_size} ${size_units} from desired ${
                    dataset_size} ${size_units}`);

            }
            count += 1;
            let file_name = set_depth(dataset, count);
            console.log(`uploading ${file_name} with size: ${rand_size}${size_units}`);
            return s3ops.put_file_with_md5(server_ip, bucket_name, file_name, rand_size, data_multiplier)
                .then(res => {
                    console.log(`file uploaded was ${file_name}`);
                    current_size += rand_size;
                });
        }
    } else if (is_multi_part) {
        console.warn(`dataset size is ${
            current_size}, skipping upload new - multi-part`);
    } else {
        console.warn(`dataset size is ${current_size}, skipping upload new`);
    }
}

function upload_overwrite(server_ip, bucket_name, dataset) {
    let rand_size = set_fileSize();
    let is_multi_part = Math.floor(Math.random() * 2) === 0;
    if (is_multi_part) {
        let rand_parts = (Math.floor(Math.random() * (part_num_high - part_num_low)) + part_num_low);
        if (rand_size / rand_parts >= 5) {
            console.log(`running upload overwrite - multi-part`);
            return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
                .then(res => {
                    current_size -= Math.floor(res.Size / data_multiplier);
                    return s3ops.upload_file_with_md5(server_ip, bucket_name, res.Key, rand_size, rand_parts, data_multiplier)
                        .then(() => res.key);
                })
                .tap(name => console.log(`file upload overwritten was ${
                    name} with ${rand_parts} parts`))
                .then(() => {
                    current_size += rand_size;
                });
        } else {
            console.warn(`size parts are ${
                rand_size / rand_parts
                }, parts must bet larger then 5MB, skipping upload overwrite - multi-part`);
        }
    } else {
        console.log(`running upload overwrite`);
        return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
            .then(res => {
                current_size -= Math.floor(res.Size / data_multiplier);
                return s3ops.put_file_with_md5(server_ip, bucket_name, res.Key, rand_size, data_multiplier)
                    .then(() => res.key);
            })
            .tap(name => console.log(`file upload overwritten was ${name}`))
            .then(res => {
                // console.log(`file upload overwritten was ${dataset}file${count}`);
                current_size += rand_size;
            });
    }
}

function copy(server_ip, bucket_name, dataset) {
    console.log(`running copy object`);
    count += 1;
    let file_name = set_depth(dataset, count);
    return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
        .then(res => {
            console.log(`file copying from: ${res.Key}`);
            return s3ops.copy_file_with_md5(server_ip, bucket_name, res.Key, file_name);
        })
        .then(res => {
            console.log(`file copied to: ${file_name}`);
            return s3ops.get_file_size(server_ip, bucket_name, file_name)
                .then(size => {
                    current_size += size;
                });
        });
}

function run_rename(server_ip, bucket_name, dataset) {
    console.log(`running rename object`);
    count += 1;
    let file_name = set_depth(dataset, count);
    return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
        .then(res => {
            console.log(`file copying from: ${res.Key}`);
            return s3ops.copy_file_with_md5(server_ip, bucket_name, res.Key, file_name)
                .then(() => s3ops.delete_file(server_ip, bucket_name, res.Key));
        });
}

function set_attribute(server_ip, bucket_name, dataset) {
    console.log(`running set attribute`);
    return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
        .then(res => {
            console.log(`setting attribute of: ${res.Key}`);
            // setting attribute using:
            // putObjectTagging - 50%
            // copyObject - 50%
            let useCopy = Math.floor(Math.random() * 2) === 0;
            useCopy = true; //currently doing only copy due to bug #3228
            if (useCopy) {
                console.log(`setting attribute using copyObject`);
                return s3ops.set_file_attribute_with_copy(server_ip, bucket_name, res.Key);
            } else {
                console.log(`setting attribute using putObjectTagging`);
                return s3ops.set_file_attribute(server_ip, bucket_name, res.Key);
            }
        });
}

function run_delete(server_ip, bucket_name, dataset) {
    console.log(`runing delete`);
    return s3ops.get_file_number(server_ip, bucket_name, dataset)
        .then(object_number => {
            // won't delete the last file in the bucket
            if (object_number > 1) {
                return s3ops.get_a_random_file(server_ip, bucket_name, dataset)
                    .then(res => {
                        current_size -= Math.floor(res.Size / data_multiplier);
                        return s3ops.delete_file(server_ip, bucket_name, res.Key);
                    });
            } else {
                console.log(`${Yellow}only one file, skipping delete${NC}`);
            }
        });
}

// load
promise_utils.pwhile(() => current_size < dataset_size, () => upload_new(server, bucket, dataset_name, false))
    // aging
    .then(() => {
        const start = Date.now();
        if (aging_timeout !== 0) {
            console.log(`will run aging for ${aging_timeout} minutes`);
        }
        return promise_utils.pwhile(() => (aging_timeout === 0 || ((Date.now() - start) / (60 * 1000)) < aging_timeout), () => {
            console.log(`Aging... currently uploaded ${current_size} ${
                size_units} from desired ${dataset_size} ${size_units}`);
            // true - read / false - change
            let read_or_change = Math.floor(Math.random() * 2) === 0;
            // read_or_change = false;
            // 50% reads
            if (read_or_change) {
                read(server, bucket, dataset_name);
                // all other options
            } else {
                //if dataset size is bigger then the requested size running delete.
                let action_type;
                if (current_size > dataset_size) {
                    console.log(`${Yellow}the current dataset size is ${
                        current_size}${size_units} and the reqested dataset size is ${
                        dataset_size}${size_units}, going to delete${NC}`);
                    action_type = 20;
                } else {
                    action_type = Math.floor(Math.random() * 7);
                }
                const action = actionTypeToFuncCall[action_type] || actionTypeToFuncCall.default;
                return action(server, bucket, dataset_name);
            }
        });
    })
    .then(() => {
        console.log(`Everything finished with success!`);
        process.exit(0);
    })
    .catch(err => {
        console.error(`Errors during test`, err);
        process.exit(1);
    });
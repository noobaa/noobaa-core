/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const P = require('../../util/promise');
const argv = require('minimist')(process.argv);

let res_files = [];

let {
    result,
    output_file = `./out_test.csv`
} = argv;

//Making sure that the results locations are in array.
res_files = res_files.concat(result);
console.log(res_files);
async function read_json(path) {
    const buf = await fs.promises.readFile(path);
    return JSON.parse(buf.toString());
}

async function convert() {
    const failed = [];
    const passed = [];
    let passed_sum;
    let failed_sum;
    for (const file of res_files) {
        const res = await read_json(file);
        if (res['Passed cases'] !== undefined) {
            passed.push(res['Passed cases']);
        }
        if (res['Failed cases'] !== undefined) {
            failed.push(res['Failed cases']);
        }
    }

    const merged_pass = _.mergeWith({}, ...passed, _.add);
    const merged_fail = _.mergeWith({}, ...failed, _.add);

    if (passed.length === 0) {
        passed_sum = 0;
    } else {
        passed_sum = _.values(merged_pass).reduce(_.add);
    }

    if (failed.length === 0) {
        failed_sum = 0;
    } else {
        failed_sum = _.values(merged_fail).reduce(_.add);
    }

    const sum_results = {
        'passed.SUM': passed_sum,
        'failed.SUM': failed_sum,
    };
    const flat_passed = _.mapKeys(merged_pass, (value, key) => 'passed.' + key);
    const flat_failed = _.mapKeys(merged_fail, (value, key) => 'failed.' + key);

    const out = _.merge(flat_passed, flat_failed);

    console.log('out:', out);
    console.log('out sum:', sum_results);

    await fs.promises.writeFile(output_file, object_to_csv(out) + object_to_csv(sum_results));
    console.log(`The report saved in: ${output_file}`);
}

function object_to_csv(obj) {
    const lines = [];
    _.each(obj, (value, key) => lines.push(`${key},${value}`));
    return lines.join('\n') + '\n';
}

P.resolve()
    .then(convert);

/* Copyright (C) 2016 NooBaa */
'use strict';


const fs = require('fs');
const path = require('path');
const stream = require('stream');

const dbg = require('../../util/debug_module')(__filename);
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const size_utils = require('../../util/size_utils');
const coverage_utils = require('../../util/coverage_utils');

const FE_DUMP_DIR = path.join(
    os_utils.IS_MAC ? path.join(process.cwd(), 'logs') : '/log',
    'nbfedump'
);

const FE_DUMP_DIR_SIZE_LIMIT = 40 * (1024 ** 2); // 40MB

function set_debug_level(req) {
    dbg.log0('Received set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
    dbg.set_level(req.rpc_params.level, req.rpc_params.module);
}

function get_coverage_data(req) {
    const coverage_data = coverage_utils.get_coverage_data();
    if (coverage_data) {
        dbg.log0('get_coverage_data: Returning data to collector');
    } else {
        dbg.warn('get_coverage_data: No data');
    }
    return { coverage_data };
}

async function upload_fe_dump(req) {
    const { name, dump } = req.rpc_params;
    const filename = path.join(FE_DUMP_DIR, name);

    try {
        dbg.log0(`upload_fe_dump: Ensuring FE dump directory ${FE_DUMP_DIR}`);
        await fs_utils.create_path(FE_DUMP_DIR);

        const source = new stream.Readable({
            read(size) {
                this.push(Buffer.from(dump, 'base64'));
                this.push(null);
            }
        });

        dbg.log0(`upload_fe_dump: Writing FE dump file ${filename}`);
        const dest = fs.createWriteStream(filename, { autoClose: true });
        dest.on('error', err => dbg.error(`upload_fe_dump: Cannot write FE dump file ${filename}`, err));
        source.pipe(dest);

        await _clean_excess_fe_dumps(FE_DUMP_DIR, FE_DUMP_DIR_SIZE_LIMIT);

    } catch (err) {
        dbg.error(`upload_fe_dump: Cannot write FE dump file ${filename}`, err);
    }
}

async function _clean_excess_fe_dumps(dir, size_limit) {
    try {
        const folder_disk_size = await fs_utils.disk_usage(dir);
        let size_over_limit = folder_disk_size.size - size_limit;
        if (size_over_limit > 0) {
            dbg.log0(`_clean_excess_fe_dumps: trying to clean ${size_utils.human_size(size_over_limit)}`);

            const sorted_by_timestamp = (await fs.promises.readdir(FE_DUMP_DIR))
                .filter(name => !name.startsWith('.'))
                .sort();

            for (const file of sorted_by_timestamp) {
                const filepath = path.join(dir, file);
                const { size } = await fs.promises.stat(filepath);

                dbg.log0(`_clean_excess_fe_dumps: deleting dump file ${file} (${size_utils.human_size(size)})`);
                await fs.promises.unlink(filepath);

                size_over_limit -= size;
                if (size_over_limit <= 0) break;
            }
        }
    } catch (err) {
        dbg.error(`_clean_excess_fe_dumps: Cannot delete FE dump files from ${dir}`, err);
    }
}

// EXPORTS
exports.set_debug_level = set_debug_level;
exports.get_coverage_data = get_coverage_data;
exports.upload_fe_dump = upload_fe_dump;

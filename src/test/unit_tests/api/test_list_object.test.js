/* Copyright (C) 2016 NooBaa */
'use strict';


const fs = require('fs');
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const {TMP_PATH} = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');

const tmp_fs_path = path.join(TMP_PATH, 'test_list_object');
const DEFAULT_FS_CONFIG = get_process_fs_context();

// eslint-disable-next-line max-lines-per-function
describe('manage list objct flow', () => {
    describe('Telldir and Seekdir implementation', () => {
        const list_dir_root = path.join(tmp_fs_path, 'list_dir_root');
        const list_dir_1_1 = path.join(list_dir_root, 'list_dir_1_1');
        const total_files = 4;

        beforeAll(async () => {
            await fs_utils.create_fresh_path(list_dir_root);
            await fs_utils.create_fresh_path(list_dir_1_1);
            for (let i = 0; i < total_files; i++) {
                create_temp_file(list_dir_root, `test_${i}.json`, {test: test});
            }
        });

        afterAll(async () => {
            await fs_utils.folder_delete(`${list_dir_root}`);
            await fs_utils.folder_delete(`${list_dir_1_1}`);
        });

        it('telldir returns bigint', async () => {
            const dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            const tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
            expect(typeof tell_dir).toStrictEqual('bigint');
        });

        it('seekdir expects bigint', async () => {
            const big_int = 2n ** 32n;
            const dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            const tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
            expect(() => dir_handle.seekdir(DEFAULT_FS_CONFIG, Number(tell_dir))).toThrow();
            expect(() => dir_handle.seekdir(DEFAULT_FS_CONFIG, 2n ** 32n ** 32n)).toThrow();
            expect(() => dir_handle.seekdir(DEFAULT_FS_CONFIG, -(2n ** 32n ** 32n))).toThrow();
            // valid scenario
            expect(await dir_handle.seekdir(DEFAULT_FS_CONFIG, big_int)).toBeUndefined();

        });

        it('list dir files - telldir and seekdir.', async () => {
            let tell_dir;
            let dir_marker;
            let total_dir_entries = 0;
            let dir_entry;
            let dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            // reak first read after 3 entries.
            for (let i = 0; i <= 2; i++) {
                dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                if (!dir_entry) break;
                tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
                dir_marker = {
                    dir_path: list_dir_root,
                    pos: tell_dir,
                };
                total_dir_entries += 1;
            }
            // Continue the read using dir location fetch from telldir
            try {
                dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, dir_marker.dir_path);
                await dir_handle.seekdir(DEFAULT_FS_CONFIG, dir_marker.pos);
                for (;;) {
                    dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                    if (!dir_entry) break;
                    total_dir_entries += 1;
                }
                await dir_handle.close(DEFAULT_FS_CONFIG);
                dir_handle = null;
            } catch (err) {
                console.log("Error :", err);
            }
            //total number of dir and files inside list_dir_root is 5 
            expect(total_dir_entries).toBe(total_files + 1);
        });

        it('list dir files -  Dir.read() and seekdir()', async () => {
            let dir_marker;
            let total_dir_entries = 0;
            let dir_entry;
            let dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            // reak first read after 3 entries.
            for (let i = 0; i <= 2; i++) {
                dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                if (!dir_entry) break;
                const tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
                //verify tell_dir and dir_entry.off return same value
                expect(tell_dir).toBe(dir_entry.off);
                dir_marker = {
                    dir_path: list_dir_root,
                    pos: dir_entry.off,
                };
                total_dir_entries += 1;
            }
            // Continue the read using dir location fetch from Dir.read()
            try {
                dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, dir_marker.dir_path);
                await dir_handle.seekdir(DEFAULT_FS_CONFIG, dir_marker.pos);
                for (;;) {
                    dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                    if (!dir_entry) break;
                    total_dir_entries += 1;
                }
                await dir_handle.close(DEFAULT_FS_CONFIG);
                dir_handle = null;
            } catch (err) {
                console.log("Error :", err);
            }
            //total number of dir and files inside list_dir_root is 5 
            expect(total_dir_entries).toBe(total_files + 1);
        });

        it('list 10000 dir files - telldir and seekdir', async () => {
            for (let i = total_files; i < total_files + 9995; i++) {
                create_temp_file(list_dir_root, `test_${i}.json`, {test: test});
            }
            let tell_dir;
            let dir_marker;
            let total_dir_entries = 0;
            let dir_entry;
            let dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            // reak first read after 3 entries.
            for (let i = 0; i <= 500; i++) {
                dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                if (!dir_entry) break;
                tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
                dir_marker = {
                    dir_path: list_dir_root,
                    pos: tell_dir,
                };
                total_dir_entries += 1;
            }
            // Continue the read using dir location fetch from telldir
            try {
                dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, dir_marker.dir_path);
                await dir_handle.seekdir(DEFAULT_FS_CONFIG, dir_marker.pos);
                for (;;) {
                    dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                    if (!dir_entry) break;
                    total_dir_entries += 1;
                }
                await dir_handle.close(DEFAULT_FS_CONFIG);
                dir_handle = null;
            } catch (err) {
                console.log("Error :", err);
            }
            //total number of dir and files inside list_dir_root is 5 
            expect(total_dir_entries).toBe(10000);
        }, 10000);
    });
});

/** 
 * create_temp_file would create a file with the data
 * @param {string} path_to_dir
 * @param {string} file_name
 * @param {object} data
 */
async function create_temp_file(path_to_dir, file_name, data) {
    const path_to_temp_file_name = path.join(path_to_dir, file_name);
    const content = JSON.stringify(data);
    await fs.promises.writeFile(path_to_temp_file_name, content);
    return path_to_temp_file_name;
}

/* Copyright (C) 2016 NooBaa */
'use strict';
/*eslint max-lines-per-function: ["error", 500]*/

const _ = require('lodash');
const fs = require('fs');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../../util/fs_utils');
const os_utils = require('../../../util/os_utils');
const nb_native = require('../../../util/nb_native');
const { get_process_fs_context } = require('../../../util/native_fs_utils');

const DEFAULT_FS_CONFIG = get_process_fs_context();

/**
 * Node.js 22 changes fs.Stats Date values to be populated lazily for improving performance.
 * @param {fs.Stats} fs_stat
 */
function get_fs_stat_with_lazy_date(fs_stat) {
    const stats_obj = { ...fs_stat };
    if (!os_utils.IS_MAC) {
        stats_obj.birthtime = fs_stat.ctime;
        stats_obj.birthtimeMs = fs_stat.ctimeMs;
    }
    stats_obj.atime = fs_stat.atime;
    stats_obj.ctime = fs_stat.ctime;
    stats_obj.mtime = fs_stat.mtime;
    return stats_obj;
}


mocha.describe('nb_native fs', async function() {

    mocha.describe('stat', async function() {
        mocha.it('works', async function() {
            const path = 'package.json';
            const res = await nb_native().fs.stat(DEFAULT_FS_CONFIG, path);
            const res2 = await fs.promises.stat(path);
            console.log("res2.atime: ", res2.atime, "res2.mtime: ", res2.mtime, "res2.ctime: ", res2.ctime);

            // birthtime in non mac platforms is ctime
            //https://nodejs.org/api/fs.html#statsbirthtime
            //Node 22 creates Date objects lazily to improve performance.
            //To get these objects we have to access it and just printing
            //would not do that, we have to assign it.
            const fs_stat_all_dates = get_fs_stat_with_lazy_date(res2);

            assert.deepStrictEqual(
                _.omit(res, 'xattr', 'mtimeNsBigint', 'atimeNsBigint', 'ctimeNsBigint'), // we need to remove xattr, mtimeSec, mtimeNsec from fs_napi response as the node JS stat doesn't return them
                _.omitBy(fs_stat_all_dates, v => typeof v === 'function'),
            );
        });
    });

    mocha.describe('lstat', async function() {
        const link_name = 'link.json';
        const file_name = 'file.json';
        const PATH = `/tmp/lstat${file_name}`;
        const LINK_PATH = `/tmp/lstat${link_name}`;
        mocha.before('lstat-before', async function() {
            // create a file and create a symlink
            const fd = await fs.promises.open(PATH, 'w');
            fd.close();
            await fs.promises.symlink(PATH, LINK_PATH);
        });

        mocha.after('lstat-after', async function() {
            await fs.promises.rm(PATH);
            await fs.promises.unlink(LINK_PATH);
        });

        mocha.it('lstat on symbolic link', async function() {
            const native_lstat_res = await nb_native().fs.stat(DEFAULT_FS_CONFIG, LINK_PATH, { use_lstat: true });
            const lstat_res = await fs.promises.lstat(LINK_PATH);
            // stat_res is the stat of the regular file (follows the link)
            const stat_res = await fs.promises.stat(LINK_PATH);

            console.log("lstat_res.atime: ", lstat_res.atime, "lstat_res.mtime: ", lstat_res.mtime, "lstat_res.ctime: ", lstat_res.ctime);

            // birthtime in non mac platforms is ctime
            // https://nodejs.org/api/fs.html#statsbirthtime
            const fs_lstat_all_dates = get_fs_stat_with_lazy_date(lstat_res);

            assert.deepStrictEqual(
                _.omit(native_lstat_res, 'xattr', 'mtimeNsBigint', 'atimeNsBigint', 'ctimeNsBigint'), // we need to remove xattr, mtimeNsBigint, atimeNsBigint, ctimeNsBigint from fs_napi response as the node JS stat doesn't return them
                _.omitBy(fs_lstat_all_dates, v => typeof v === 'function'),
            );

            assert.notDeepStrictEqual(
                _.omit(native_lstat_res, 'xattr', 'mtimeNsBigint', 'atimeNsBigint', 'ctimeNsBigint'), // we need to remove xattr, mtimeNsBigint, atimeNsBigint, ctimeNsBigint from fs_napi response as the node JS stat doesn't return them
                _.omitBy(stat_res, v => typeof v === 'function'),
            );
        });
    });

    // mocha.describe('rename', function() {
    //     mocha.it('works', async function() {
    //         throw new Error('TODO')
    //     });
    // });

    // mocha.describe('unlink', function() {
    //     mocha.it('works', async function() {
    //         throw new Error('TODO')
    //     });
    // });

    // mocha.describe('writeFile', function() {
    //     mocha.it('works', async function() {
    //         throw new Error('TODO')
    //     });
    // });

    // mocha.describe('readFile', function() {
    //     mocha.it('works', async function() {
    //         throw new Error('TODO')
    //     });
    // });

    // mocha.describe('readdir', function() {
    //     mocha.it('works', async function() {
    //         throw new Error('TODO')
    //     });
    // });

    mocha.describe('open', async function() {
        mocha.it.skip('open + close', async function() {
            const path = 'package.json';
            const fh = await nb_native().fs.open(DEFAULT_FS_CONFIG, path);
            console.log(fh);
            await nb_native().fs.close(DEFAULT_FS_CONFIG, fh);
        });

        mocha.it.skip('close bad fd', async function() {
            const fh = { fd: 666666 };
            try {
                await nb_native().fs.close(DEFAULT_FS_CONFIG, fh);
                throw new Error('Should have failed');
            } catch (err) {
                assert.strictEqual(err.message, 'Bad file descriptor');
            }
        });
    });


    // mocha.describe('Dir', function() {
    //     mocha.it('works', async function() {
    //         const { opendir } = nb_native().fs;
    //         const d = await opendir('.');
    //         try {
    //             for (let e = await d.read(); e; e = await d.read()) {
    //                 console.log(e);
    //             }
    //         } finally {
    //             await d.close();
    //         }
    //     });
    // });

    // mocha.describe('File', function() {
    //     mocha.it('works', async function() {
    //         const { open } = nb_native().fs;
    //         const f = await open('./jenia.txt');
    //         try {
    //             let buf = Buffer.from('QQQQQQQQQQQQ');
    //             // jeniathisisme
    //             const read = await f.read(buf, 3, 5, 1);
    //             console.warn('JEINA THIS IS BUF', buf.toString(), read);
    //             // iath 4
    //         } finally {
    //             await f.close();
    //         }
    //     });
    //     mocha.it('works FS', async function() {
    //         const { open } = fs.promises;
    //         const f = await open('./jenia.txt', 'r');
    //         try {
    //             let buf = Buffer.from('QQQQQQQQQQQQ');
    //             // jeniathisisme
    //             const read = await f.read(buf, 3, 5, 1);
    //             console.warn('JEINA THIS IS BUF', buf.toString(), read);
    //             // iath 4
    //         } finally {
    //             await f.close();
    //         }
    //     });

    // });


    mocha.describe('Readdir', async function() {
        mocha.it('works', async function() {
            const { readdir } = nb_native().fs;
            const r = await readdir(DEFAULT_FS_CONFIG, '.');
            console.log('JEINA THIS IS DIR', r, r.length);
        });
        mocha.it('works FS', async function() {
            const { readdir } = fs.promises;
            const r = await readdir('.', { withFileTypes: true });
            console.log('JEINA THIS IS FS DIR', r, r.length);
        });

    });

    mocha.describe('Readdir DIRWRAP', async function() {
        mocha.it('works', async function() {
            const { opendir } = nb_native().fs;
            const r = await opendir(DEFAULT_FS_CONFIG, '.');
            let dir = await r.read(DEFAULT_FS_CONFIG);
            while (dir) {
                console.log('JEINA THIS IS DIR', dir);
                dir = await r.read(DEFAULT_FS_CONFIG);
            }
            await r.close(DEFAULT_FS_CONFIG);
        });

        mocha.it('works FS', async function() {
            const { opendir } = fs.promises;
            const r = await opendir('.');
            let dir = await r.read();
            while (dir) {
                console.log('JEINA THIS IS DIR FS', dir);
                dir = await r.read();
            }
            await r.close();
        });
    });

    // mocha.describe('Errors', function() {
    //     mocha.it('works', async function() {
    //         const { stat } = nb_native().fs;
    //         try {
    //             const r = await stat('./jenia.txt');
    //         } catch (error) {
    //             console.log('JEINA FAIL', error.code, error.message);
    //         }
    //     });
    // });

    mocha.describe('FileWrap Getxattr, Replacexattr', async function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_1_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key': 'value' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res = (await tmpfile.stat(DEFAULT_FS_CONFIG)).xattr;
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, xattr_res);
        });
    });

    mocha.describe('FileWrap Getxattr, Replacexattr clear prefixes override', async function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_2_${Date.now()}_clear`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res1 = (await tmpfile.stat(DEFAULT_FS_CONFIG)).xattr;
            const set_options = { 'user.key3': 'value3' };
            const clear_prefix = 'user.key1';
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, set_options, clear_prefix);
            const xattr_res2 = (await tmpfile.stat(DEFAULT_FS_CONFIG)).xattr;
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, xattr_res1);
            assert.deepEqual({ 'user.key2': 'value2', 'user.key3': 'value3' }, xattr_res2);

        });
    });


    mocha.describe('FileWrap Getxattr, Replacexattr clear prefixes add xattr - no clear', async function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_3_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res1 = (await tmpfile.stat(DEFAULT_FS_CONFIG)).xattr;
            const set_options = { 'user.key3': 'value3' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, set_options);
            const xattr_res2 = (await tmpfile.stat(DEFAULT_FS_CONFIG)).xattr;
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, xattr_res1);
            assert.deepEqual({ ...xattr_obj, ...set_options }, xattr_res2);

        });
    });


    mocha.describe('FileWrap GetSinglexattr', async function() {
        mocha.it('get single existing xattr', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_4_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res = await nb_native().fs.getsinglexattr(DEFAULT_FS_CONFIG, PATH, 'user.key11');
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj['user.key11'], xattr_res);

        });

        mocha.it('get single not existing xattr', async function() {
            let error_message = 'No data available';
            if (os_utils.IS_MAC) {
                error_message = 'Attribute not found';
            }
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_5_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            try {
                await nb_native().fs.getsinglexattr(DEFAULT_FS_CONFIG, PATH, 'user.key12');
                assert.fail('should have failed with No data availble - xattr doesnt exist');
            } catch (err) {
                // err.code ENODATA not availble in libuv, comparing by err.message
                // opened https://github.com/libuv/libuv/issues/3795 to track it
                assert.equal(err.message, error_message);
            } finally {
                await tmpfile.close(DEFAULT_FS_CONFIG);
            }
        });

        mocha.it('stat -  not existing xattr', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_6_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const res = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH, { skip_user_xattr: true });
            await tmpfile.close(DEFAULT_FS_CONFIG);
            console.log(res);
        });
    });

    mocha.describe('Stat with xattr', async function() {
        mocha.it('get xattr with FileWrap Stat', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_7_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const stat_res = await tmpfile.stat(DEFAULT_FS_CONFIG);
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, stat_res.xattr);
        });

        mocha.it('get xattr with FS Stat', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_8_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const stat_res = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH);
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, stat_res.xattr);
        });

        mocha.it('get xattr with FS Stat with only basic attributes', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest_9_${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.content_md5': 'md5' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const stat_res = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH, { skip_user_xattr: true });
            await tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual({ 'user.content_md5': 'md5' }, stat_res.xattr);
        });
    });


    mocha.describe('Safe link/unlink', async function() {
        mocha.it('safe link - success', async function() {
            const { safe_link } = nb_native().fs;
            const PATH1 = `/tmp/safe_link${Date.now()}_1`;
            const PATH2 = `/tmp/safe_link${Date.now()}_2`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH1);
            console.log('link success - stat res: ', res1);
            await safe_link(DEFAULT_FS_CONFIG, PATH1, PATH2, res1.mtimeNsBigint, res1.ino);
            const res2 = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH2);
            assert.deepEqual(res1.ino, res2.ino);
            assert.deepEqual(res1.mtimeNsBigint, res2.mtimeNsBigint);
            await fs_utils.file_delete(PATH1);
            await fs_utils.file_delete(PATH2);
        });


        mocha.it('safe link - failure', async function() {
            const { safe_link } = nb_native().fs;
            const PATH1 = `/tmp/safe_link${Date.now()}_1`;
            const PATH2 = `/tmp/safe_link${Date.now()}_2`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH1);
            console.log('link failure - stat res: ', res1);
            const fake_ino = 12345678;

            try {
                await safe_link(DEFAULT_FS_CONFIG, PATH1, PATH2, res1.mtimeNsBigint, fake_ino);
                await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH2);
                await fs_utils.file_delete(PATH2);
                assert.fail('should have failed');
            } catch (err) {
                const actual_err_msg = err.message;
                assert.equal(actual_err_msg, 'FS::SafeLink ERROR link target doesn\'t match expected inode and mtime');
                await fs_utils.file_must_exist(PATH1);
            }
            await fs_utils.file_delete(PATH1);
        });

        mocha.it('safe unlink - success', async function() {
            const { safe_unlink } = nb_native().fs;
            const PATH1 = `/tmp/safe_unlink${Date.now()}_1`;
            const tmp_mv_path = `/tmp/safe_unlink${Date.now()}_rand`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH1);
            await safe_unlink(DEFAULT_FS_CONFIG, PATH1, tmp_mv_path, res1.mtimeNsBigint, res1.ino);
            await fs_utils.file_must_not_exist(PATH1);
            await fs_utils.file_delete(PATH1);
        });

        mocha.it('safe unlink - failure', async function() {
            const { safe_unlink } = nb_native().fs;
            const PATH1 = `/tmp/safe_unlink${Date.now()}_1`;
            const tmp_mv_path = `/tmp/safe_unlink${Date.now()}_rand`;
            await create_file(PATH1);
            const res1 = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH1);
            const fake_mtime_sec = 12345678;
            try {
                await safe_unlink(DEFAULT_FS_CONFIG, PATH1, tmp_mv_path, BigInt(fake_mtime_sec), res1.ino);
                assert.fail('file should have not been deleted');
            } catch (err) {
                assert.equal(err.message, 'FS::SafeUnlink ERROR unlink target doesn\'t match expected inode and mtime');
                const res2 = await nb_native().fs.stat(DEFAULT_FS_CONFIG, PATH1);
                // source file & target file should still exist
                assert.equal(res1.ino.toString(), res2.ino.toString());
                await fs_utils.file_must_exist(PATH1);
                await fs_utils.file_must_exist(tmp_mv_path);
                await fs_utils.file_delete(PATH1);
                await fs_utils.file_delete(tmp_mv_path);
            }
        });
    });
});

async function create_file(file_path) {
    return fs.promises.appendFile(file_path, file_path + '\n');
}

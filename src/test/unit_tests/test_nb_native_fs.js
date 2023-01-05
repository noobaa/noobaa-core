/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const mocha = require('mocha');
const assert = require('assert');
const nb_native = require('../../util/nb_native');

const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};
const MAC_PLATFORM = 'darwin';

mocha.describe('nb_native fs', function() {

    mocha.describe('stat', function() {
        mocha.it('works', async function() {
            const path = 'package.json';
            const res = await nb_native().fs.stat(DEFAULT_FS_CONFIG, path);
            const res2 = await fs.promises.stat(path);
            // birthtime in non mac platforms is ctime
            //https://nodejs.org/api/fs.html#statsbirthtime
            if (process.platform !== MAC_PLATFORM) {
                res2.birthtime = res2.ctime;
                res2.birthtimeMs = res2.ctimeMs;
            }
            assert.deepStrictEqual(
                res,
                _.omitBy(res2, v => typeof v === 'function'),
            );
        });
    });

    mocha.describe('lstat', function() {
        mocha.it('works', async function() {
            const path = 'package.json';
            const res = await nb_native().fs.lstat(DEFAULT_FS_CONFIG, path);
            const res2 = await fs.promises.stat(path);
            // birthtime in non mac platforms is ctime
            // https://nodejs.org/api/fs.html#statsbirthtime
            if (process.platform !== MAC_PLATFORM) {
                res2.birthtime = res2.ctime;
                res2.birthtimeMs = res2.ctimeMs;
            }
            assert.deepStrictEqual(
                res,
                _.omitBy(res2, v => typeof v === 'function'),
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

    mocha.describe('open', function() {
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


    mocha.describe('Readdir', function() {
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

    mocha.describe('Readdir DIRWRAP', function() {
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

    mocha.describe('FileWrap Getxattr, Replacexattr', function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key': 'value' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res = await tmpfile.getxattr(DEFAULT_FS_CONFIG);
            tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, xattr_res);
        });
    });

    mocha.describe('FileWrap Getxattr, Replacexattr clear prefixes override', function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res1 = await tmpfile.getxattr(DEFAULT_FS_CONFIG);
            const set_options = { 'user.key3': 'value3' };
            const clear_prefix = 'user.key1';
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, set_options, clear_prefix);
            const xattr_res2 = await tmpfile.getxattr(DEFAULT_FS_CONFIG);
            tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, xattr_res1);
            assert.deepEqual({ 'user.key2': 'value2', 'user.key3': 'value3' }, xattr_res2);

        });
    });


    mocha.describe('FileWrap Getxattr, Replacexattr clear prefixes add xattr - no clear', function() {
        mocha.it('set, get', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res1 = await tmpfile.getxattr(DEFAULT_FS_CONFIG);
            const set_options = { 'user.key3': 'value3' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, set_options);
            const xattr_res2 = await tmpfile.getxattr(DEFAULT_FS_CONFIG);
            tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj, xattr_res1);
            assert.deepEqual({ ...xattr_obj, ...set_options }, xattr_res2);

        });
    });


    mocha.describe('FileWrap GetSinglexattr', function() {
        mocha.it('get single existing xattr', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            const xattr_res = await nb_native().fs.getsinglexattr(DEFAULT_FS_CONFIG, PATH, 'user.key11');
            tmpfile.close(DEFAULT_FS_CONFIG);
            assert.deepEqual(xattr_obj['user.key11'], xattr_res);

        });

        mocha.it('get single not existing xattr', async function() {
            const { open } = nb_native().fs;
            const PATH = `/tmp/xattrtest${Date.now()}`;
            const tmpfile = await open(DEFAULT_FS_CONFIG, PATH, 'w');
            const xattr_obj = { 'user.key1': 'value1', 'user.key11': 'value11', 'user.key2': 'value2' };
            await tmpfile.replacexattr(DEFAULT_FS_CONFIG, xattr_obj);
            try {
                await nb_native().fs.getsinglexattr(DEFAULT_FS_CONFIG, PATH, 'user.key12');
                assert.fail('should have failed with No data availble - xattr doesnt exist');
            } catch (err) {
                // err.code ENODATA not availble in libuv, comparing by err.message
                // opened https://github.com/libuv/libuv/issues/3795 to track it
                assert.equal(err.message, 'No data available');
            }
            tmpfile.close(DEFAULT_FS_CONFIG);
        });
    });
});

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
    backend: ''
};

mocha.describe('nb_native fs', function() {

    mocha.describe('stat', function() {
        mocha.it('works', async function() {
            const path = 'package.json';
            const res = await nb_native().stat(DEFAULT_FS_CONFIG, path);
            const res2 = await fs.promises.stat(path);
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
            const fh = await nb_native().open(DEFAULT_FS_CONFIG, path);
            console.log(fh);
            await nb_native().close(DEFAULT_FS_CONFIG, fh);
        });

        mocha.it.skip('close bad fd', async function() {
            const fh = { fd: 666666 };
            try {
                await nb_native().close(DEFAULT_FS_CONFIG, fh);
                throw new Error('Should have failed');
            } catch (err) {
                assert.strictEqual(err.message, 'Bad file descriptor');
            }
        });
    });


    // mocha.describe('Dir', function() {
    //     mocha.it('works', async function() {
    //         const { opendir } = nb_native();
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
    //         const { open } = nb_native();
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
            const { readdir } = nb_native();
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
            const { opendir } = nb_native();
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
    //         const { stat } = nb_native();
    //         try {
    //             const r = await stat('./jenia.txt');
    //         } catch (error) {
    //             console.log('JEINA FAIL', error.code, error.message);
    //         }
    //     });
    // });

    mocha.describe('ACL', function() {
        mocha.it('stat', async function() {
            const path = 'package.json';
            try {
                await nb_native().stat({ uid: 26041992 }, path);
                throw new Error('Expected to get EPERM');
            } catch (error) {
                assert.strictEqual(error.message, 'Operation not permitted');
                assert.strictEqual(error.code, 'EPERM');
            }
            const response = await nb_native().stat(DEFAULT_FS_CONFIG, path);
            console.log('ACL Stat response', response);
        });
    });

});

/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const P = require('../util/promise');
const pkg = require('../../package.json');
const Semaphore = require('../util/semaphore');
const promise_utils = require('../util/promise_utils');
const license_utils = require('../util/license_utils');

const LICENSE_INFO_JSON_PATH = path.resolve('license_info.json');
const serial = new Semaphore(1);

/**
 * Handle the license info http request
 * @param {http.Request} req
 * @param {http.Response} res
 */
function serve_http(req, res) {
    console.log('license_info: serve_http');
    serial.surround(() => P.resolve()
            .then(() => fs.statAsync(LICENSE_INFO_JSON_PATH))
            .catch(err => {
                if (err.code === 'ENOENT') {
                    console.log('license_info: no file yet, generating ...');
                } else {
                    console.log('license_info: error reading and parsing file, re-generating ...', err.stack || err);
                }
                // fork and run main() in separate process
                return promise_utils.fork(__filename, [
                    '--out', LICENSE_INFO_JSON_PATH,
                    '--sort', 'path',
                    // '--verbose',
                ], {}, false);
            })
        )
        .then(() => {
            console.log('license_info: serving data');
            res.sendFile(LICENSE_INFO_JSON_PATH);
        })
        .catch(err => {
            console.error('license_info: ERROR', err.stack || err);
            res.status(500).send('Server Error');
        });
}

/**
 * Collect license info as a separate process
 */
function main() {
    const argv = minimist(process.argv.slice(2));
    const license_map = new Map();
    const info = {
        version: pkg.version || '*',
        date: new Date(),
        licenses: [],
    };

    const detector = new license_utils.LicenseDetector();
    if (argv.verbose) {
        detector.on('detected', (file_path, best) => {
            console.log('detected', file_path, best);
        });
        detector.on('undetected', (file_path, best) => {
            console.log('UNDETECTED', file_path, best);
        });
    }
    const scanner = new license_utils.LicenseScanner(detector);
    scanner.on('progress', count => {
        process.stdout.write('.');
    });
    scanner.on('license', l => {
        const full_path = path.resolve(l.path);
        const dirname = path.dirname(full_path);
        const basename = path.basename(full_path);
        let obj = license_map.get(dirname);
        if (!obj) {
            obj = {
                path: dirname,
                scanned: {},
            };
            license_map.set(dirname, obj);
            info.licenses.push(obj);
        }
        _.defaults(obj, l);
        obj.scanned[basename] = l.license;
        // console.log(`path: ${l.path} license: ${l.license} name: ${l.name} version: ${l.version} url: ${l.url}`);
    });

    return P.resolve()
        .then(() => detector.init_templates())
        .then(() => scanner.scan())
        .then(() => {
            console.log(`completed scan, found ${info.licenses.length} licenses`);
            if (argv.sort) {
                info.licenses.sort((a, b) => {
                    const aa = a[argv.sort];
                    const bb = b[argv.sort];
                    if (aa < bb) return -1;
                    if (aa > bb) return 1;
                    return 0;
                });
            }
            const text = JSON.stringify(info, null, '  ');
            if (!argv.out) {
                process.stdout.write(text);
                return;
            }
            return fs.writeFileAsync(argv.out, text);
        });
}

if (require.main === module) main();

exports.serve_http = serve_http;

/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const P = require('../util/promise');
const pkg = require('../../package.json');
const Semaphore = require('../util/semaphore');
const os_utils = require('../util/os_utils');
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
            .then(() => fs.promises.stat(LICENSE_INFO_JSON_PATH))
            .catch(err => {
                if (err.code === 'ENOENT') {
                    console.log('license_info: no file yet, generating ...');
                } else {
                    console.log('license_info: error reading and parsing file, re-generating ...', err.stack || err);
                }
                // fork and run main() in separate process
                return os_utils.fork(__filename, [
                    '--rpms',
                    '--dir', '/usr',
                    '--dir', '/root',
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
        obj.license_type = license_utils.get_license_type(obj.license);
        if (argv.perm && obj.license_type !== license_utils.PERMISSIVE_TYPE) {
            console.error('NON PERMISSIVE:', obj);
        }
        // console.log(`path: ${l.path} license: ${l.license} name: ${l.name} version: ${l.version} url: ${l.url}`);
    });

    return P.resolve()
        .then(() => detector.init_templates())
        .then(() => argv.rpms && scanner.scan_rpms())
        .then(() =>
            (_.isArray(argv.dir) && P.map(argv.dir, dir => scanner.scan_dir(dir))) ||
            (_.isString(argv.dir) && scanner.scan_dir(argv.dir))
        )
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
            const text = argv.csv ?
                format_csv(info) :
                JSON.stringify(info, null, '  ');
            if (!argv.out) {
                process.stdout.write(text);
                return;
            }
            return fs.promises.writeFile(argv.out, text);
        });
}

function format_csv(info) {
    const lines = [];
    const dups = new Map();
    lines.push([
        '(Q1) Open Source Name/ Version Number', '', '',
        '(Q2) License - provide hyperlink',
        '(Q2.1) Is it dual licensed? (Y/N) If yes, which one do you use?',
        '(Q2.2) For AGPL, GPL or LGPL - must it be licensed under a particular version? (if yes, indicate version)',
        '(Q3) Licensor - Complete Copyright Notice',
        '(Q4) Link to Source',
        '(Q5) Company Products',
        '(Q6) Function/ Use with Product/Importance of the Open Source Material',
        '(Q7) Interaction with Product (e.g., dynamically or statically linked)',
        '(Q8) Modified? (Y/N)',
        '(Q9) Distribution- Downloadable/Internally used/ SaaS (if distributed, specify if distributed in source code or object code form)',
        '(Q10) Compiled Together? (specify if Company\'s Products compiled together with the Open Source Material)'
    ].map(x => `"${x || ''}"`).join(',') + '\n');
    info.licenses.forEach(l => {
        if (l.name || l.url) {
            var k = `${l.name}\0${l.version}\0${l.url}`;
            if (dups.has(k)) return;
            dups.set(k, l);
        }
        lines.push([
            // Q1
            l.name, l.version, l.path,
            // (Q2) License - provide hyperlink
            l.license,
            // (Q2.1) Is it dual-licensed? (Y/N) If yes, which one do you use?
            'N',
            // (Q2.2) For AGPL, GPL or LGPL - must it be licensed under a particular version? (if yes, indicate version)
            'N',
            // (Q3) Licensor - Complete Copyright Notice
            'Refer to project source',
            // (Q4) Link to Source
            l.url,
            // (Q5) Company Products
            `NooBaa ${info.version}`,
            // (Q6) Function/ Use with Product/Importance of the Open Source Material
            '',
            // (Q7) Interaction with Product (e.g., dynamically or statically linked)
            (l.path.includes('/native/') && 'Static linking') ||
            (l.path.includes('/node_modules/') && 'No linking') ||
            'Dynamic linking',
            // (Q8) Modified? (Y/N)
            'N',
            //(Q9) Distribution- Downloadable/Internally used/ SaaS (if distributed, specify if distributed in source code or object code form)
            (l.path.includes('/node_modules/') && 'Downloadable - Distributed as source') ||
            'Downloadable - Distributed as binary',
            // (Q10) Compiled Together? (specify if Company's Products compiled together with the Open Source Material)
            (l.path.includes('/native/') && 'Y') ||
            'N',
        ].map(x => `"${x || ''}"`).join(',') + '\n');
    });
    return lines.join('');
}

if (require.main === module) main();

exports.serve_http = serve_http;

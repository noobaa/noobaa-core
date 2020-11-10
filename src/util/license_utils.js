/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const events = require('events');

const P = require('./promise');
const fs_utils = require('./fs_utils');
const os_utils = require('./os_utils');
const string_utils = require('./string_utils');

const PROPRIETARY_TYPE = 'PROPRIETARY';
const PERMISSIVE_TYPE = 'PERMISSIVE';
const GPL_TYPE = 'GPL';

/**
 * LicenseDetector uses templates and string comparing algorithms
 * in order to quickly detect the license in a given text.
 */
class LicenseDetector extends events.EventEmitter {

    async init_templates() {
        if (this.LICENSE_TEMPLATES) return P.resolve();
        const templates_dir = path.join(__dirname, 'license_templates');
        const names = await fs.promises.readdir(templates_dir);
        const templates = await Promise.all(names.map(async name => {
            const text = await fs.promises.readFile(path.join(templates_dir, name), 'utf8');
            return this.parse_text(text, name);
        }));
        // sorting licenses to check ones with fewer symbols first
        templates.sort((a, b) => a.symbols.length - b.symbols.length);
        this.LICENSE_TEMPLATES = templates;
    }

    detect_license_text(text, file_path) {
        const p = this.parse_text(text, file_path);
        const edit_factor = 0.5;
        let best;

        _.forEach(this.LICENSE_TEMPLATES, template => {
            const stop_marker = Math.min(best ? best.distance : Infinity, edit_factor * p.symbols.length);
            const distance = string_utils.levenshtein_distance(p.symbols, template.symbols, 'fuzzy', stop_marker);
            if (!best || best.distance > distance) {
                best = {
                    template,
                    distance,
                };
            }
        });
        if (best &&
            best.distance <= edit_factor * p.symbols.length &&
            best.distance <= edit_factor * best.template.symbols.length) {
            this.emit('detected', file_path, best);
            return best.template.name;
        }
        this.emit('undetected', file_path, best);
    }

    parse_text(text, name, max_len) {
        const words = text
            // .slice(0, max_len || text.length)
            .replace(/[^A-Za-z]/g, ' ')
            .toLowerCase()
            .split(/\s+/);

        const symbols = [];
        let roll_context = {};
        let last_word = 0;
        for (let i = 0; i < words.length; ++i) {
            const hash = string_utils.rolling_hash(words[i], roll_context);
            if ((hash % 8) < 4) {
                symbols.push(hash);
                last_word = i;
                roll_context = {};
            }
        }
        if (last_word + 1 < words.length) {
            symbols.push(roll_context.hash);
        }

        return {
            name,
            words,
            symbols,
            length: text.length
        };
    }
}

/**
 * LicenseScanner scans directories and package managers (RPM)
 * and emits information about found licenses.
 */
class LicenseScanner extends events.EventEmitter {

    constructor(detector) {
        super();
        this.detector = detector;
        this._scanned_count = 0;
    }

    async scan_rpms() {
        const text = await os_utils.exec(
            `rpm -qa --qf "%{NAME}|%{VERSION}|%{URL}|%{LICENSE}\n"`, {
                ignore_rc: false,
                return_stdout: true,
            }
        );
        await Promise.all(text.split('\n').map(async l => {
            this._increase_scanned_count();
            const [
                name = '',
                version = '',
                url = '',
                license = ''
            ] = l.split('|');
            if (!name && !version && !url && !license) return;
            const paths = [
                `/usr/share/doc/${name}-${version}`,
                `/usr/share/doc/${name}`,
                `/usr/share/${name}-${version}`,
                `/usr/share/${name}`,
            ];
            const stats = Promise.all(paths.map(file_path => fs.promises.stat(file_path).catch(fs_utils.ignore_enoent)));
            const index = _.findIndex(stats, stat => Boolean(stat));
            this._emit_license({
                path: paths[index < 0 ? 0 : index] + '/RPM',
                license,
                name,
                version,
                url,
            });
        }));
    }

    scan_dir(dir) {
        return fs_utils.read_dir_recursive({
            root: dir,
            on_entry: e => {
                this._increase_scanned_count();
                // true to keep recursing
                if (e.stat.isDirectory()) return true;
                if (!e.stat.isFile()) return false;
                const file_name = path.basename(e.path);
                if ((/^license|^copying/i).test(file_name)) {
                    return this.scan_license_file(e.path);
                }
                if (file_name === 'package.json' || file_name === 'bower.json') {
                    return this.scan_package_json_file(e.path);
                }
                // NOTE:
                //      going over code files slows down the scan too much.
                //      will need to make the detection lighter if we want it.
                //
                // if (/\.(js|h|c|hpp|cpp|cxx|cc|py|pl|rb)$/.test(file_name)) {
                //     return this.scan_code_file(e.path);
                // }
            }
        });
    }

    async scan_license_file(file_path) {
        try {
            const text = await fs.promises.readFile(file_path, 'utf8');
            const license = this.detector.detect_license_text(text, file_path);
            this._emit_license({
                path: file_path,
                license,
            });
        } catch (err) {
            console.warn('scan_license_file: FAILED', file_path, err.message);
        }
    }

    async scan_package_json_file(file_path) {
        try {
            const text = await fs.promises.readFile(file_path, 'utf8');
            const {
                name = '',
                    version = '',
                    license = '',
                    licenses = '',
                    url = '',
                    repository = '',
                    homepage = '',
                    author = '',
            } = JSON.parse(text);
            const u = url || homepage || (repository && repository.url) || '';
            if (!license && !licenses && !url && !author) {
                // empty package, just a folder with package.json but no info or license,
                // we just ignore these assuming they do not have any license claims.
                return;
            }
            const license_list = [license || licenses].flat();
            license_list.map(l => this._emit_license({
                path: file_path,
                license: l.type || l,
                name,
                version,
                url: u,
            }));
        } catch (err) {
            console.warn('scan_package_json_file: FAILED', file_path, err.message);
        }
    }

    async scan_code_file(file_path) {
        const buffer = Buffer.allocUnsafe(10 * 1024);
        let fh;
        try {
            fh = await fs.promises.open(file_path, 'r');
            const bytes_read = await fh.read(buffer, 0, buffer.length, 0);
            const text = buffer.slice(0, bytes_read).toString('utf8');
            const license = this.detector.detect_license_text(text, file_path);
            if (!license) return;
            this._emit_license({ path: file_path, license });
        } catch (err) {
            console.warn('scan_code_file: FAILED', file_path, err.message);
        } finally {
            if (fh) await fh.close();
        }
    }

    _increase_scanned_count() {
        this._scanned_count += 1;
        if (this._scanned_count % 100 === 0) {
            this.emit('progress', this._scanned_count);
        }
    }

    _emit_license(license) {
        license.license_type = get_license_type(license.license);
        if (license.license_type !== PERMISSIVE_TYPE) {
            console.error('GGG', license);
        }
        this.emit('license', license);
    }

}

function get_license_type(name) {
    // APACHE-2.0
    // APACHE 2.0
    // APACHE LICENSE 2.0
    // APACHE LICENSE VERSION 2.0
    // APACHE-2.0-APPENDIX
    if ((/^apache/i).test(name)) return PERMISSIVE_TYPE;
    // MIT
    // MIT/X11
    if ((/^mit/i).test(name)) return PERMISSIVE_TYPE;
    // BSD
    // BSD-2
    // BSD-2-CLAUSE
    // BSD-3
    // BSD-3-CLAUSE
    // BSD-3-CLAUSE AND MIT
    if ((/^bsd/i).test(name)) return PERMISSIVE_TYPE;
    // ISC
    if ((/^isc$/i).test(name)) return PERMISSIVE_TYPE;
    // Unlicense
    if ((/^unlicense$/i).test(name)) return PERMISSIVE_TYPE;
    // MPL-2.0
    if ((/^mpl/i).test(name)) return PERMISSIVE_TYPE;
    // MOZILLA 2.0
    if ((/^mozilla/i).test(name)) return PERMISSIVE_TYPE;
    // WTF
    // WTFPL
    // WTFPL-2.0
    if ((/^wtf/i).test(name)) return PERMISSIVE_TYPE;
    // ZLIB
    if ((/^zlib/i).test(name)) return PERMISSIVE_TYPE;
    // Public domain
    if ((/^public.*domain/i).test(name)) return PERMISSIVE_TYPE;
    // ARTISTIC-2.0
    // ARTISTIC LICENSE 2.0
    if ((/^artistic/i).test(name)) return PERMISSIVE_TYPE;
    // AFL (Academic Free License)
    if ((/^afl/i).test(name)) return PERMISSIVE_TYPE;
    // PYTHON-2.0
    if ((/^python/i).test(name)) return PERMISSIVE_TYPE;
    // W3C
    if ((/^w3c/i).test(name)) return PERMISSIVE_TYPE;

    // GPL
    // LGPL
    if ((/^l?gpl/i).test(name)) return GPL_TYPE;

    // default
    return PROPRIETARY_TYPE;
}

exports.LicenseDetector = LicenseDetector;
exports.LicenseScanner = LicenseScanner;
exports.get_license_type = get_license_type;
exports.PROPRIETARY_TYPE = PROPRIETARY_TYPE;
exports.PROPRIETARY_TYPE = PERMISSIVE_TYPE;
exports.PROPRIETARY_TYPE = GPL_TYPE;

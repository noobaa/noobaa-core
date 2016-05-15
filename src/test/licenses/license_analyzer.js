'use strict';
var fs = require('fs');
var path = require('path');

var DETECTABLE_LICENSES;
var PERMISSIVE_LICENSES_MAP_UPPERCASE;
var config = {
    debug: false,
    comments: false,
};

module.exports = {
    process_folder: process_folder,
    detect_license_text: detect_license_text,
    init_detectable_licenses: init_detectable_licenses,
    config: config
};

if (require.main === module) {
    var argv = require('minimist')(process.argv);
    // run with --debug for debug printouts
    config.debug = argv.debug;
    // run with --comments to add comments on parse errors to the output
    config.comments = argv.comments;
    init_detectable_licenses();
    console.log('Software,Version,Licenses,Url,Comments');
    var dirs = argv._.slice(2);
    if (dirs.length) {
        dirs.forEach(process_folder);
    } else {
        process_folder('.');
    }
}

function process_folder(dir) {
    fs.readdir(dir, function(err, list) {
        if (err && err.code === 'ENOTDIR') return;
        fatal_error(err);
        var json_files = [];
        var license_files = [];
        list.forEach(function(name) {
            // recurse to handle subdirs (will ignore files)
            process_folder(path.join(dir, name));
            if (name === 'package.json' || name === 'bower.json') {
                json_files.push(name);
            } else if (name.match(/license|copying/i)) {
                license_files.push(name);
            }
        });
        if (!json_files.length && !license_files.length) return;
        read_all_files(dir, json_files, function(err1, res1) {
            fatal_error(err1);
            read_all_files(dir, license_files, function(err2, res2) {
                fatal_error(err2);
                dbg('Process', dir);
                var pkg = {
                    licenses: [],
                    comments: []
                };
                res1.forEach(function(json_text, i) {
                    if (!json_text) return;
                    process_pkg_json(pkg, dir, json_files[i], json_text);
                });
                if (!pkg.name &&
                    !pkg.version &&
                    !pkg.url &&
                    !pkg.licenses.length &&
                    !license_files.length) {
                    // empty package, just a folder with package.json but no info or license,
                    // we just ignore these assuming they do not have any license claims.
                    return;
                }
                res2.forEach(function(license_text, i) {
                    if (!license_text) return;
                    process_pkg_license(pkg, dir, license_files[i], license_text);
                });
                if (!pkg.name) {
                    pkg.name = path.basename(dir);
                }
                process_pkg_all_licenses(pkg);
                console.log(pkg.name +
                    ',' + pkg.version +
                    ',' + pkg.licenses +
                    ',' + pkg.url +
                    ',' + (pkg.comments.map(function(s) {
                        return '### ' + s;
                    }).join(' ') || '')
                    // ',' + dir +
                );
            });
        });
    });
}

function read_all_files(dir, names, callback) {
    var res = [];
    if (!names.length) {
        return callback(null, res);
    }
    res.length = names.length;
    var remain = names.length;
    names.forEach(function(name, i) {
        fs.readFile(path.join(dir, name), {
            encoding: 'utf8'
        }, function(err, data) {
            if (err) {
                return;
            }
            res[i] = data;
            remain -= 1;
            if (remain === 0) {
                callback(null, res);
            }
        });
    });
}

function process_pkg_json(pkg, dir, json_file, json_text) {
    try {
        var pj = JSON.parse(json_text);
        pkg.name = pj.name;
        pkg.version = pj.version || '';
        pkg.url = pj.repository && pj.repository.url || '';
        var l = pj.license || pj.licenses;
        if (Array.isArray(l)) {
            l.forEach(function(ll) {
                pkg.licenses.push({
                    src: json_file,
                    license: ll.type || ll
                });
            });
        } else if (l) {
            pkg.licenses.push({
                src: json_file,
                license: l.type || l
            });
        }
    } catch (err) {
        if (config.comments) {
            pkg.comments.push('JSON PARSE ERROR: ' + err.message +
                ' ' + path.join(dir, json_file));
        } else {
            dbg('JSON PARSE ERROR: ' + err.message +
                ' ' + path.join(dir, json_file));
        }
    }
}

function process_pkg_license(pkg, dir, license_file, license_text) {
    var license = detect_license_text(license_text, path.join(dir, license_file));
    if (license) {
        pkg.licenses.push({
            src: license_file,
            license: license
        });
    } else {
        pkg.licenses.push({
            src: license_file,
            license: undefined
        });
        if (config.comments) {
            pkg.comments.push('UNDETECTED LICENSE FILE: ' + path.join(dir, license_file));
        } else {
            dbg('UNDETECTED LICENSE FILE: ' + path.join(dir, license_file));
        }
    }
}

function process_pkg_all_licenses(pkg) {
    var permissive = false;
    var licenses = [];
    pkg.licenses.forEach(function(l) {
        var name = String(l.license);
        if (name.toUpperCase() in PERMISSIVE_LICENSES_MAP_UPPERCASE) {
            permissive = true;
        }
        var found = false;
        licenses.forEach(function(prev_l) {
            var prev_name = String(prev_l.license);
            if (name.startsWith(prev_name) || prev_name.startsWith(name)) {
                found = true;
            }
        });
        if (!found) {
            licenses.push(l);
        }
    });
    if (!licenses.length) {
        pkg.licenses = undefined;
    } else if (licenses.length === 1) {
        pkg.licenses = String(licenses[0].license).replace(',', ' ');
    } else {
        pkg.licenses = licenses.map(function(l) {
            return l.src.replace(',', ' ') + ':' + String(l.license).replace(',', ' ');
        }).join(' & ');
    }
    if (!permissive) {
        if (config.comments) {
            pkg.comments.push('NON PERMISSIVE LICENSE !!!');
        } else {
            dbg('NON PERMISSIVE LICENSE: ' + pkg.name);
        }
    }
}

function detect_license_text(input_text, name) {
    var input_index = index_text(input_text);
    var best_distance = input_index.words.length;
    var best_license = '';
    DETECTABLE_LICENSES.forEach(function(license) {
        var base_index = license.index;
        var distance = levenshtein_distance(base_index.words, input_index.words, best_distance);
        if (distance < best_distance) {
            best_distance = distance;
            best_license = license.name;
        }
    });
    // if the distance is relatively small compared to the length of the input then accept it
    if (best_distance < 0.50 * input_index.words.length) {
        dbg('Detected by distance', best_distance, best_license, '@', name);
        return best_license;
    }
    dbg('Could not detect by distance', best_distance, best_license, '@', name);
}

function init_detectable_licenses() {
    if (DETECTABLE_LICENSES) {
        return;
    }
    var templates_dir = path.join(__dirname, 'templates');
    var templates = fs.readdirSync(templates_dir);
    DETECTABLE_LICENSES = templates.map(function(name) {
        return {
            name: name,
            index: index_text(fs.readFileSync(path.join(templates_dir, name), {
                encoding: 'utf8'
            }))
        };
    }).sort(function(a, b) {
        // sorting licenses to check ones with fewer words first
        return a.index.words.length - b.index.words.length;
    });
    DETECTABLE_LICENSES.forEach(function(l) {
        dbg('Loaded template', l.name, 'contains', l.index.words.length, 'words');
    });
    // this map includes also names as commonly appear in package.json
    PERMISSIVE_LICENSES_MAP_UPPERCASE = {
        'APACHE-2.0': 1,
        'APACHE 2.0': 1,
        'APACHE LICENSE 2.0': 1,
        'APACHE LICENSE VERSION 2.0': 1,
        'APACHE-2.0-APPENDIX': 1,
        'ARTISTIC-2.0': 1,
        'ARTISTIC LICENSE 2.0': 1,
        'BSD': 1,
        'BSD-2': 1,
        'BSD-2-CLAUSE': 1,
        'BSD-3': 1,
        'BSD-3-CLAUSE': 1,
        'BSD-3-CLAUSE AND MIT': 1,
        'ISC': 1,
        'MIT': 1,
        'MIT/X11': 1,
        'MPL-2.0': 1,
        'MOZILLA 2.0': 1,
        'PYTHON-2.0': 1,
        'W3C': 1,
        'WTF': 1,
        'WTFPL': 1,
        'WTFPL-2.0': 1,
        'ZLIB': 1,
    };
}

function index_text(text) {
    if (Array.isArray(text)) {
        text = text.join('\n');
    }
    return {
        words: text.split(/\s+/),
    };
}

/**
 * Compute text edit-distance used as a similarity score
 * https://en.wikipedia.org/wiki/Levenshtein_distance
 */
function levenshtein_distance(s, t, stop_marker) {
    // degenerate cases
    if (s === t) return 0;
    if (s.length === 0) return t.length;
    if (t.length === 0) return s.length;

    // create two work vectors of integer distances
    var v0 = [];
    var v1 = [];
    v0.length = v1.length = t.length + 1;

    // initialize v0 (the previous row of distances)
    // this row is A[0][i]: edit distance for an empty s
    // the distance is just the number of characters to delete from t
    var i;
    var j;
    for (i = 0; i < v0.length; ++i) {
        v0[i] = i;
    }

    for (i = 0; i < s.length; ++i) {
        // calculate v1 (current row distances) from the previous row v0

        // first element of v1 is A[i+1][0]
        //   edit distance is delete (i+1) chars from s to match empty t
        v1[0] = i + 1;

        // use formula to fill in the rest of the row
        for (j = 0; j < t.length; ++j) {
            var cost = (s[i] === t[j]) ? 0 : 1;
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        }

        // copy v1 (current row) to v0 (previous row) for next iteration
        // bail if we already passed the stop marker, to allow to drop matches faster
        var min = Infinity;
        for (j = 0; j < v0.length; ++j) {
            v0[j] = v1[j];
            if (min > v1[j]) {
                min = v1[j];
            }
        }
        if (min > stop_marker) {
            return min;
        }
    }

    return v1[t.length];
}

function dbg() {
    if (config.debug) {
        var args = Array.prototype.slice.apply(arguments);
        console.warn.apply(console, [' . . . '].concat(args));
    }
}

function fatal_error(err) {
    if (err) {
        console.error('FATAL ERROR:', err.stack || err);
        process.exit(1);
    }
}

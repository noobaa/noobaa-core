/* eslint-disable header/header, no-useless-escape */
/*
Copyright (c) 2015, Scott Motte
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


'use strict';

const fs = require('fs');
const _ = require('lodash');

var DROPPED_LINES = {
    LINES: [],
    INDICES: [],
};

module.exports = {

    /*
     * Main entry point into dotenv. Allows configuration before loading .env
     * @param {Object} options - valid options: path ('.env'), encoding ('utf8')
     * @returns {Boolean}
     */
    config: function(options) {
        const paths = ['.env', '/data/.env'];
        let encoding = 'utf8';

        paths.forEach(env_file => {
            try {
                let parsedObj = this.parse(fs.readFileSync(env_file, {
                    encoding: encoding
                }));

                Object.keys(parsedObj).forEach(function(key) {
                    process.env[key] = parsedObj[key];
                });
            } catch (e) {
                _.noop();
            }
        });


    },

    /*
     * Parses a string or buffer into an object
     * @param {String|Buffer} src - source to be parsed
     * @returns {Object}
     */
    parse: function(src_param) {

        let src = src_param;
        if (!src) {
            try {
                src = fs.readFileSync('/data/.env', {
                    encoding: 'utf8'
                });
            } catch (e) {
                src = fs.readFileSync('.env', {
                    encoding: 'utf8'
                });
            }
        }
        var obj = {};
        var idx = 0;

        // convert Buffers before splitting into lines and processing
        src.toString().split('\n')
            .forEach(function(line) {
                // matching "KEY' and 'VAL' in 'KEY=VAL'
                var keyValueArr = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
                // matched?
                if (keyValueArr === null) {
                    DROPPED_LINES.INDICES.push(idx);
                    DROPPED_LINES.LINES.push(line);
                    // console.warn('line', line);
                } else {
                    var key = keyValueArr[1];

                    // default undefined or missing values to empty string
                    var value = keyValueArr[2] ? keyValueArr[2] : '';

                    // expand newlines in quoted values
                    var len = value ? value.length : 0;
                    if (len > 0 && value.charAt(0) === '"' && value.charAt(len - 1) === '"') {
                        value = value.replace(/\\n/gm, '\n');
                    }

                    // remove any surrounding quotes and extra spaces
                    value = value.replace(/(^['"]|['"]$)/g, '').trim();

                    obj[key] = value;
                }
                idx += 1;
            });

        return obj;
    },

    stringify: obj => Object.keys(obj)
        .map(key => `${key}=${obj[key]}`)
        .join('\n') + '\n',

    /*
     * Sets a new value for params
     * @param {Object} newVal - param name and new value of param
     */
    set: function(newVal) {
        var path = '/data/.env';
        var encoding = 'utf8';
        var silent = false;

        try {
            // specifying an encoding returns a string instead of a buffer
            var newObj = this.replace(fs.readFileSync(path, {
                encoding: encoding
            }), newVal);


            fs.writeFileSync(path, '');
            Object.keys(newObj).forEach(function(key) {
                fs.appendFileSync(path, key + '=' + newObj[key] + '\n');
                process.env[key] = newObj[key];
            });

            return true;
        } catch (e) {
            if (!silent) {
                console.error(e);
            }
            return false;
        }
    },

    /*
     * Replaces a value on a given source buffer
     * @param {Object} newVal - param name and new value of param
     * @param {String|Buffer} src - source to be parsed
     * @returns {Object}
     */
    replace: function(src, newVal) {
        var obj = {};
        var found = false;

        // convert Buffers before splitting into lines and processing
        src.toString().split('\n')
            .forEach(function(line) {
                // matching "KEY' and 'VAL' in 'KEY=VAL'
                var keyValueArr = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
                // matched?
                if (keyValueArr !== null) {
                    var key = keyValueArr[1];
                    var value;
                    if (key === newVal.key) {
                        value = newVal.value;
                        found = true;
                    } else {
                        // default undefined or missing values to empty string
                        value = keyValueArr[2] ? keyValueArr[2] : '';
                    }

                    obj[key] = value;
                }
            });

        if (!found) {
            obj[newVal.key] = newVal.value;
        }

        return obj;
    }

};

module.exports.load = module.exports.config;

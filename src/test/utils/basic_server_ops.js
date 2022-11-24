/* Copyright (C) 2016 NooBaa */
"use strict";

const _ = require('lodash');
const request = require('request');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const P = require('../../util/promise');
const ec2_wrap = require('../../deploy/ec2_wrapper');
const os_utils = require('../../util/os_utils');
const api = require('../../api');

const request_promise = util.promisify(request);

var test_file = '/tmp/test_upgrade';
let rpc_validation_disabled = false;
const ext_regex = /^\.[A-Za-z0-9_]{1,4}$/;

module.exports = {
    upload_and_upgrade: upload_and_upgrade,
    wait_for_server: wait_for_server,
    get_agent_setup: get_agent_setup,
    upload_file: upload_file,
    download_file: download_file,
    verify_upload_download: verify_upload_download,
    generate_random_file: generate_random_file,
    wait_on_agents_upgrade: wait_on_agents_upgrade,
    calc_md5: calc_md5,
    disable_rpc_validation: disable_rpc_validation
};

function disable_rpc_validation() {
    rpc_validation_disabled = true;
}

function upload_and_upgrade(ip, upgrade_pack, dont_verify_version) {
    throw new Error('DEPRECATED - this upgrade flow is not relevant anymore');
}

async function wait_for_server(ip, wait_for_version) {
    const url = `http://${ip}:8080/version`;
    for (;;) {
        try {
            console.log('waiting for Web Server to start');
            const { statusCode, body } = await request_promise({
                method: 'get',
                url,
                strictSSL: false,
            });
            if (statusCode !== 200) {
                throw new Error(`wait_for_server: GET ${url} FAILED:` +
                    ` statusCode ${statusCode} body ${body}`);
            }
            if (wait_for_version && body !== wait_for_version) {
                throw new Error(`wait_for_server: version is ${body}` +
                    ` wait for version ${wait_for_version}`);
            }
            console.log('Web Server started. version is: ' + body);
            return body;
        } catch (err) {
            console.log('not up yet...', err.message);
            await P.delay(5000);
        }
    }
}

function get_agent_setup(ip) {
    return P.ninvoke(request, 'get', {
            url: 'https://' + ip + ':8443/public/noobaa-setup.exe',
            rejectUnauthorized: false,
        })
        .then(function(response) {
            console.log('Download of noobaa-setup was successful');

        })
        .then(null, function(err) {
            console.error('Download of noobaa-setup failed', err);
            throw new Error('Download of noobaa-setup failed ' + err);
        });
}

function upload_file(ip, path, bucket, key, timeout, throw_on_error) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //upload the file
            return P.fcall(function() {
                    return ec2_wrap.put_object(ip, path, bucket, key, timeout, throw_on_error);
                })
                .then(function() {
                    console.log('Upload file successfully');
                })
                .then(null, function(err) {
                    console.error('Error in upload_file', err);
                    throw new Error('Error in upload_file ' + err);
                });
        })
        .then(null, function(err) {
            console.error('Error in verify_demo_system', err, err.stack);
            throw new Error('Error in verify_demo_system ' + err);
        });
}

function download_file(ip, path) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //download the file
            return P.fcall(function() {
                    return ec2_wrap.get_object(ip, path);
                })
                .then(function() {
                    console.log('Download file successfully');

                })
                .then(null, function(err) {
                    console.error('Error in download_file', err);
                    throw new Error('Error in download_file ' + err);
                });
        })
        .then(null, function(err) {
            console.error('Error in verify_demo_system', err);
            throw new Error('Error in verify_demo_system ' + err);
        });
}

function verify_upload_download(ip, path) {
    var orig_md5;
    var down_path = path + '_download';
    return P.resolve(calc_md5(path))
        .then(function(md5) {
            orig_md5 = md5;
            return upload_file(ip, path);
        })
        .catch(function(err) {
            console.warn('Failed to upload file', path, 'with err', err, err.stack);
        })
        .then(function() {
            return download_file(ip, down_path);
        })
        .catch(function(err) {
            console.warn('Failed to download file with err', err, err.stack);
        })
        .then(function() {
            return P.resolve(calc_md5(down_path));
        })
        .then(function(md5) {
            if (md5 === orig_md5) {
                console.log('Original and downloaded file MDs are the same');
                return P.resolve();
            } else {
                console.warn('Original and downloaded file MDs are different');
                return P.reject();
            }
        });
}


async function generate_random_file(size_mb, extension) {
    extension = extension || '.dat';
    if (!extension.startsWith('.')) extension = '.' + extension;
    if (!ext_regex.test(extension)) throw new Error('bad extension');
    var suffix = Date.now() + '.' + Math.round(Math.random() * 1000) + extension;
    var fname = test_file + suffix;
    var dd_cmd;

    if (process.platform === 'darwin') {
        dd_cmd = 'dd if=/dev/urandom of=' + fname + ' count=' + size_mb + ' bs=1m';
    } else if (process.platform === 'linux') {
        dd_cmd = 'dd if=/dev/urandom of=' + fname + ' count=' + size_mb + ' bs=1M';
    }

    await os_utils.exec(dd_cmd);
    return fname;
}

function get_rpc_client(ip) {
    let rpc = api.new_rpc();
    if (rpc_validation_disabled) {
        rpc.disable_validation();
    }
    let client = rpc.new_client({
        address: 'ws://' + ip + ':8080'
    });
    return client;
}

function wait_on_agents_upgrade(ip) {
    const client = get_rpc_client(ip);
    var sys_ver;

    return P.fcall(function() {
            var auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return P.resolve(client.system.read_system({}))
                .then(function(res) {
                    sys_ver = res.version;
                });
        })
        .catch(function(error) {
            console.warn('Failed with', error, error.stack);
            throw error;
        })
        .then(function() {
            //Loop on list_agents until all agents version was updated
            //Timeout at 10 minutes
            var old_agents = true;
            var wait_time = 0;
            return P.delay(5000).then(function() {
                return P.pwhile(
                    function() {
                        return old_agents;
                    },
                    function() {
                        return P.resolve(client.node.list_nodes({
                                query: {
                                    online: true,
                                }
                            }))
                            .then(function(res) {
                                old_agents = false;
                                _.each(res.nodes, function(n) {
                                    if (n.version !== sys_ver) {
                                        old_agents = true;
                                    }
                                });
                                if (old_agents) {
                                    if (wait_time >= 120) {
                                        throw new Error('Timeout while waiting for agents to upgrade');
                                    }
                                    console.log('waiting for agents to upgrade');
                                    wait_time += 5;
                                    return P.delay(5000);
                                }
                            });
                    });
            });
        });
}

async function calc_md5(path) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        fs.createReadStream(path)
            .on('error', reject)
            .pipe(hash)
            .on('error', reject)
            .on('finish', () => resolve(hash.digest('hex')));
    });
}

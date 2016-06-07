"use strict";

var _ = require('lodash');
var request = require('request');
var fs = require('fs');
var crypto = require('crypto');
var os = require('os');
var P = require('../../util/promise');
var ec2_wrap = require('../../deploy/ec2_wrapper');
var promise_utils = require('../../util/promise_utils');
var api = require('../../api');

var test_file = '/tmp/test_upgrade';
var rpc = api.new_rpc();

module.exports = {
    upload_and_upgrade: upload_and_upgrade,
    get_agent_setup: get_agent_setup,
    upload_file: upload_file,
    download_file: download_file,
    verify_upload_download: verify_upload_download,
    generate_random_file: generate_random_file,
    wait_on_agents_upgrade: wait_on_agents_upgrade,
    calc_md5: calc_md5,
};


function upload_and_upgrade(ip, upgrade_pack) {
    console.log('Upgrading the machine');

    var filename;
    if (upgrade_pack.indexOf('/') !== -1) {
        filename = upgrade_pack.substring(upgrade_pack.indexOf('/'));
    } else {
        filename = upgrade_pack;
    }

    var formData = {
        upgrade_file: {
            value: fs.createReadStream(upgrade_pack),
            options: {
                filename: filename,
                contentType: 'application/x-gzip'
            }
        }
    };

    return P.ninvoke(request, 'post', {
            url: 'http://' + ip + ':8080/upgrade',
            formData: formData,
            rejectUnauthorized: false,
        })
        .then(function(httpResponse, body) {
            console.log('Upload package successful');
            var isNotListening = true;
            return P.delay(10000).then(function() {
                return promise_utils.pwhile(
                    function() {
                        return isNotListening;
                    },
                    function() {
                        return P.ninvoke(request, 'get', {
                            url: 'http://' + ip + ':8080/',
                            rejectUnauthorized: false,
                        }).spread(function(res, body) {
                            console.log('Web Server started after upgrade');
                            isNotListening = false;
                        }, function(err) {
                            console.log('waiting for Web Server to start');
                            return P.delay(10000);
                        });
                    });
            }).then(function() {
                isNotListening = true;
                return P.delay(60000).then(function() {
                    return promise_utils.pwhile(
                        function() {
                            return isNotListening;
                        },
                        function() {
                            return P.ninvoke(request, 'get', {
                                url: 'http://' + ip + ':8080/',
                                rejectUnauthorized: false,
                            }).spread(function(res, body) {
                                console.log('S3 server started after upgrade');
                                isNotListening = false;
                            }, function(err) {
                                console.log('waiting for S3 server to start');
                                return P.delay(10000);
                            });
                        });
                });
            });
        })
        .then(null, function(err) {
            console.error('Upload package failed', err, err.stack);
            throw new Error('Upload package failed ' + err);
        });
}

function get_agent_setup(ip) {
    return P.ninvoke(request, 'get', {
            url: 'https://' + ip + ':8443/public/noobaa-setup.exe',
            rejectUnauthorized: false,
        })
        .then(function(response) {
            console.log('Download of noobaa-setup was successful');
            return;
        })
        .then(null, function(err) {
            console.error('Download of noobaa-setup failed', err);
            throw new Error('Download of noobaa-setup failed ' + err);
        });
}

function upload_file(ip, path, bucket, key) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //upload the file
            return P.fcall(function() {
                    return ec2_wrap.put_object(ip, path, bucket, key);
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
                    return;
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
    return P.when(calc_md5(path))
        .then(function(md5) {
            orig_md5 = md5;
            return upload_file(ip, path);
        })
        .fail(function(err) {
            console.warn('Failed to upload file', path, 'with err', err, err.stack);
        })
        .then(function() {
            return download_file(ip, down_path);
        })
        .fail(function(err) {
            console.warn('Failed to download file with err', err, err.stack);
        })
        .then(function() {
            return P.when(calc_md5(down_path));
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

function generate_random_file(size_mb) {
    var suffix = Date.now() + '.' + Math.round(Math.random() * 1000) + '.dat';
    var fname = test_file + suffix;
    var dd_cmd;

    if (os.type() === 'Darwin') {
        dd_cmd = 'dd if=/dev/urandom of=' + fname + ' count=' + size_mb + ' bs=1m';
    } else if (os.type() === 'Linux') {
        dd_cmd = 'dd if=/dev/urandom of=' + fname + ' count=' + size_mb + ' bs=1M';
    }

    return promise_utils.promised_exec(dd_cmd)
        .then(function() {
            return fname;
        });
}

function wait_on_agents_upgrade(ip) {
    var client = rpc.new_client({
        address: 'ws://' + ip + ':8080'
    });
    var sys_ver;

    return P.fcall(function() {
            var auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return P.when(client.system.read_system({}))
                .then(function(res) {
                    sys_ver = res.version;
                });
        })
        .fail(function(error) {
            console.warn('Failed with', error, error.stack);
            throw error;
        })
        .then(function() {
            //Loop on list_agents until all agents version was updated
            //Timeout at 10 minutes
            var old_agents = true;
            var wait_time = 0;
            return P.delay(5000).then(function() {
                return promise_utils.pwhile(
                    function() {
                        return old_agents;
                    },
                    function() {
                        return P.when(client.node.list_nodes({
                                query: {
                                    online: true,
                                }
                            }))
                            .then(function(nodes) {
                                old_agents = false;
                                _.each(nodes.nodes, function(n) {
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

function calc_md5(path) {
    var hash = crypto.createHash('md5');
    var stream = fs.createReadStream(path);

    stream.on('data', function(data) {
        hash.update(data, 'utf8');
    });

    stream.on('end', function() {
        return P.resolve(hash.digest('hex'));
    });
}

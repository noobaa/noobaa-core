'use strict';

var fs = require('fs');
var net = require('net');
var crypto = require('crypto');
var stream = require('stream');

var PORT = 4747;
var file_name = process.argv[2];
var hash_type = 'sha1';
var hash_len = 20;
var cipher_type = 'aes-256-ctr';
var cipher_key = 'stam';

if (file_name) {
    run_sender(file_name);
} else {
    run_receiver();
}

function run_sender(file_name) {
    var conn = net.connect(PORT);
    var hash = crypto.createHash(hash_type);
    fs.createReadStream(file_name, {
            highWaterMark: 1024 * 1024
        })
        .pipe(new stream.Transform({
            transform: function(chunk, encoding, next) {
                var cipher = crypto.createCipher(cipher_type, cipher_key);
                var hdr = new Buffer(4);
                var bulk = cipher.update(chunk);
                var fin = cipher.final();
                hdr.writeUInt32BE(bulk.length + fin.length, 0);
                this.push(hdr);
                this.push(bulk);
                this.push(fin);
                hash.update(chunk);
                next();
            },
            flush: function(done) {
                var last_hdr = new Buffer(4);
                last_hdr.writeUInt32BE(0xFFFFFFFF, 0);
                this.push(last_hdr);
                this.push(hash.digest());
                done();
            }
        }))
        .pipe(conn);
}

function run_receiver() {
    var server = net.createServer(function(conn) {
        var hash = crypto.createHash(hash_type);
        var bytes = 0;
        var start_time = process.hrtime();
        var hdr = null;
        var hash_val = null;
        conn.on('readable', function() {
                while (true) {
                    if (!hdr) {
                        hdr = conn.read(4);
                        if (!hdr) {
                            break;
                        }
                    }
                    var len = hdr.readUInt32BE(0);
                    if (len === 0xFFFFFFFF) {
                        if (hash_val) {
                            conn.emit('error', new Error('TCP already received hash'));
                            return;
                        }
                        hash_val = conn.read(hash_len);
                        if (!hash_val) {
                            break;
                        }
                        hdr = null;
                    } else if (len > 16 * 1024 * 1024) {
                        conn.emit('error', new Error('TCP received message too big ' + len));
                        return;
                    } else {
                        var bulk = conn.read(len);
                        if (!bulk) {
                            break;
                        }
                        hdr = null;

                        var decipher = crypto.createDecipher(cipher_type, cipher_key);
                        var data = decipher.update(bulk);
                        var fin = decipher.final();
                        hash.update(data);
                        hash.update(fin);
                        bytes += data.length;
                        bytes += fin.length;
                    }
                }
            })
            .on('end', function() {
                var took = process.hrtime(start_time);
                var took_sec = took[0] + (took[1] / 1e9);
                var took_str = (took_sec).toFixed(2) + ' seconds';
                var size_str;
                if (bytes > 1024 * 1024) {
                    size_str = (bytes / 1024 / 1024).toFixed(1) + ' MB';
                } else {
                    size_str = bytes + ' Bytes';
                }
                var speed_str = (bytes / 1024 / 1024 / took_sec).toFixed(1) + ' MB/s';
                var my_hash_val = hash.digest('hex');
                if (my_hash_val !== hash_val.toString('hex')) {
                    console.error('HASH mismatch', my_hash_val, 'expeced', hash_val.toString('hex'));
                }
                console.log(size_str, took_str, speed_str, 'HASH', my_hash_val);
            });
    });
    server.listen(PORT, function() {
        console.log('Listening on port', PORT);
    });
}

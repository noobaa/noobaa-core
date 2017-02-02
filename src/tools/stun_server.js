/* Copyright (C) 2016 NooBaa */
'use strict';

let dgram = require('dgram');
let stun = require('../rpc/stun');
let argv = require('minimist')(process.argv);

argv.port = argv.port || 3478;
let socket = dgram.createSocket('udp4');
socket.on('message', on_message);
socket.on('listening', on_listening);
socket.bind(argv.port);

function on_listening() {
    console.log('STUN SERVER listening on port', argv.port);
}

function on_message(buffer, rinfo) {
    if (!stun.is_stun_packet(buffer)) {
        console.log('NON STUN MESSAGE', buffer.toString(), 'from', rinfo);
        return;
    }
    console.log('STUN', stun.get_method_name(buffer), 'from', rinfo.address + ':' + rinfo.port);
    var method = stun.get_method_field(buffer);
    if (method === stun.METHODS.REQUEST) {
        var reply = stun.new_packet(stun.METHODS.SUCCESS, [{
            type: stun.ATTRS.XOR_MAPPED_ADDRESS,
            value: {
                family: 'IPv4',
                port: rinfo.port,
                address: rinfo.address
            }
        }], buffer);
        socket.send(reply, 0, reply.length, rinfo.port, rinfo.address);
    }
}

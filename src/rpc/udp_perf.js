'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var dbg = require('noobaa-util/debug_module')(__filename);
var UdpConnection = require('./udp_connection');
var argv = require('minimist')(process.argv);

var DEFAULT_PORT = 5800;

/**
 *
 * a udp protocol performance tool, run from command line with flags:
 *
 *      server: node udp_perf
 *
 *      client: node udp_perf -c 127.0.0.1 --mtu 16000 -s 100
 *
 * TODO add a way to print usage
 *
 */

// set debug level for all the rpc modules
dbg.set_level(argv.d, __dirname);

var isClient = !!argv.c;
var localPort = isClient ? 0 : DEFAULT_PORT;

var conn = new UdpConnection(localPort);
conn.on('channel', function(channel) {
    if (!isClient) {
        serverMain(channel);
    }
});
if (isClient) {
    conn.on('ready', clientMain);
}

function clientMain() {
    var remoteAddr = argv.c || '127.0.0.1';
    var remotePort = parseInt(argv.p, 10) || DEFAULT_PORT;
    var messageSize = parseInt(argv.m, 10) || 128 * 1024;
    var sendSize = (parseInt(argv.s, 10) || 0) * 1024 * 1024;
    var receiveSize = (parseInt(argv.r, 10) || 0) * 1024 * 1024;
    var MTU = parseInt(argv.mtu, 10);
    var RTT = parseInt(argv.rtt, 10);
    var channel = conn.getChannel(remotePort, remoteAddr);
    if (MTU) {
        channel.MTU = MTU;
    }
    if (RTT) {
        channel.RTT = RTT;
    }

    return Q.fcall(function() {
            // first message is the spec of the test to create the connection
            var remoteSpec = {
                sendSize: receiveSize,
                receiveSize: sendSize,
                messageSize: messageSize,
                MTU: MTU,
                RTT: RTT,
            };
            dbg.log('SEND SPEC');
            return channel.sendMessage(new Buffer(JSON.stringify(remoteSpec)));
        })
        .then(function() {
            dbg.log('WAIT SPEC ACK');
            return channel.waitForMessage();
        })
        .then(function(buffer) {
            channel.disableQueue();
            var spec = {
                sendSize: sendSize,
                receiveSize: receiveSize,
                messageSize: messageSize,
            };
            return runSpec(channel, spec);
        })
        .then(function() {
            dbg.log('CLIENT DONE');
            conn.close();
        }, function(err) {
            dbg.error('CLIENT ERROR', err.stack || err);
            conn.close();
        });
}

function serverMain(channel) {
    // receive the test spec message
    var spec;
    return Q.fcall(function() {
            dbg.log('WAIT FOR SPEC');
            return channel.waitForMessage();
        })
        .then(function(buffer) {
            channel.disableQueue();
            // parse and send back the spec message to let the client know we can start
            spec = JSON.parse(buffer.toString());
            dbg.log('RECEIVED SPEC');
            if (spec.MTU) {
                channel.MTU = spec.MTU;
            }
            if (spec.RTT) {
                channel.RTT = spec.RTT;
            }
            return channel.sendMessage(buffer);
        })
        .then(function() {
            return runSpec(channel, spec);
        })
        .then(function() {
            dbg.log('SERVER DONE');
            channel.close();
        }, function(err) {
            dbg.log('SERVER ERROR', err.stack || err);
            channel.close();
        });
}

function runSpec(channel, spec) {
    dbg.log('RUN SPEC', spec);
    channel.enableReporter();
    return Q.all([
        waitForReceiveBytes(channel, spec.receiveSize),
        sendOnChannel(channel, spec.sendSize, spec.messageSize)
    ]);
}

function waitForReceiveBytes(channel, receiveSize) {
    if (channel.receiveBytes >= receiveSize) {
        dbg.log('RECEIVE DONE', channel.receiveBytes);
        return;
    }
    return Q.delay(1).then(waitForReceiveBytes.bind(null, channel, receiveSize));
}

function sendOnChannel(channel, sendSize, messageSize) {
    var buffer = new Buffer(messageSize);
    return sendNext();

    function sendNext() {
        if (channel.sendBytes >= sendSize) {
            dbg.log('SEND DONE', channel.sendBytes);
            return;
        }
        return channel.sendMessage(buffer).then(sendNext);
    }
}

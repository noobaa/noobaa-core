// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var buf = require('../util/buffer_utils');
var _ = require('lodash');
var Q = require('q');
var ice_api = require('../util/ice_api');
var assert = require("assert");
var ice_lib = require('../util/ice_lib');
var sinon     = require('sinon');

describe('create buffer to send', function() {

    it('create test', function() {

        var block = new Buffer('stam','utf-8');
        var res = ice_api.createBufferToSend(block, 2, '45344');

        var bff = buf.toBuffer(res);
        var req = (bff.readInt32LE(0)).toString();
        var part = bff.readInt8(32);

        assert.equal(req, '45344');
        assert.equal(part, 2);

        var afterBuf = bff.slice(40, bff.length);
        var strVal = afterBuf.toString();
        assert.equal(strVal, 'stam');

    });

});

describe('write buffer to socket', function() {

    it('write test', function() {

        var block = new Buffer('stam','utf-8');

        var channel = new Buffer(0);
        channel.offset = 0;
        channel.send = function(data) {
            var bff = buf.toBuffer(data);
            channel = Buffer.concat([channel, bff]);
        };

        ice_api.writeBufferToSocket(channel, block, '45344');

        var req = (channel.readInt32LE(0)).toString();
        var part = channel.readInt8(32);

        assert.equal(req, '45344');
        assert.equal(part, 0);

        var afterBuf = channel.slice(40, channel.length);
        var strVal = afterBuf.toString();
        assert.equal(strVal, 'stam');

    });

});

describe('on ice message', function() {

    it('get string', function(done) {

        var result;

        var message = {
            req: '43544',
            body: 'dfgdfgdfg'
        };

        var channel = {
            myId: 1,
            peerId: 2,
            msgs: {},
            handleRequestMethod: function(channel, data) {
                result = data;
                assert.equal(result.req, message.req);
                assert.equal(result.body, message.body);
                done();
            }
        };

        var event = {
            data: JSON.stringify(message)
        };

        ice_api.onIceMessage(null, channel, event);
    });

    it('get buffer', function(done) {

        var result;
        var requestId = '43544';
        var body = 'dfgdfgdfg';

        var block = new Buffer('stam','utf-8');

        var channel = {
            myId: 1,
            peerId: 2,
            msgs: {},
            handleRequestMethod: function(channel, message) {
                var msgObj = channel.msgs[requestId];
                result = msgObj.peer_msg;
                result.data = msgObj.buffer;

                assert.equal(result.req, requestId);
                assert.equal(result.body, body);

                var strVal = result.data.toString();
                assert.equal(strVal, 'stamstam');
                done();
            }
        };

        var message = {
            req: requestId,
            body: body,
            size: block.length*2
        };

        var event = {
            data: JSON.stringify(message)
        };

        ice_api.onIceMessage(null, channel, event);

        var blockEvent = ice_api.createBufferToSend(block, 0, requestId);
        event = {
            data: buf.toArrayBuffer(blockEvent)
        };

        ice_api.onIceMessage(null, channel, event);

        blockEvent = ice_api.createBufferToSend(block, 1, requestId);
        event = {
            data: buf.toArrayBuffer(blockEvent)
        };
        ice_api.onIceMessage(null, channel, event);

    });



    it('test ws', function() {

        // create mock for web sockets
        var wsMock = function(addr) {
            this.ws = {
                msgsSent: [],
                msgsRec: []
            };

            this.ws.send = function(msg) {
                this.msgsSent.push(msg);
            };

            console.log('creating dummy ws for addr '+addr);
            return this.ws;
        };

        var rewire = require('rewire');
        var ice_lib = rewire('../util/ice_lib');
        ice_lib.__set__({
            'WebSocket': wsMock
        });

        var agentId = '45y45y54y45';

        var p2p_context = {
            iceSockets: {}
        };

        // open mock web socket to signaling server
        var socket = ice_lib.setup(function(p2p_context, channel, event) {
            console.log('got event '+event.data+' from peer '+channel.peerId);
        }, agentId, function(channel, message) {
            console.log('got message '+message+' from peer '+channel.peerId);
        });

        // chk onopen sends required message
        socket.ws.onopen();
        assert.ok(socket.alive_interval);
        assert.ok(socket.ws.msgsSent[0].indexOf('sigType') >= 0);
        assert.equal(socket.idInServer,agentId);

        // clear keep alive interval and stale conns one
        clearInterval(socket.alive_interval);
        clearInterval(socket.stale_conn_interval);

        // chk that when id msg received from server it is ignored for agent
        socket.ws.onmessage({sigType: 'id', id: 'ytytytytyt'});
        assert.equal(socket.idInServer,agentId);

        // test send message to peer
        ice_lib.sendWSMessage(socket, '6y6y6yy6', '7777', {df: 'hh', ba: '434'});
        assert.ok(socket.ws.msgsSent[1].indexOf('sigType') >= 0);
        assert.ok(socket.ws.msgsSent[1].indexOf('ice') >= 0);
        assert.ok(socket.ws.msgsSent[1].indexOf('434') >= 0);

        // chk that when request of no specific type arrives it goes to the right method
        socket.handleRequestMethod = function(ws, message) {
            console.log('got msg '+message);
            ws.msgsRec.push(message);
        };
        socket.ws.onmessage({sigType: 'blat', requestId: 'blat'});
        assert.ok(socket.ws.msgsRec[0].sigType === 'blat');

        // get ice connection to peer of which and ice connection already exists
        var peerId = '9i9i9i9';
        var reqId = '999';
        p2p_context.iceSockets[peerId] = {
            peerConn: 1,
            dataChannel: 2,
            usedBy: {}
        };
        ice_lib.initiateIce(p2p_context, socket, peerId, true, reqId);
        assert.ok(socket.icemap[reqId].peerId === peerId);
        assert.ok(socket.icemap[reqId].isInitiator);
        assert.ok(socket.icemap[reqId].requestId === reqId);
        assert.ok(p2p_context.iceSockets[peerId].usedBy[reqId] === 1);
    });

});
// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var buf = require('../util/buffer_utils');
var _ = require('lodash');
var Q = require('q');
var ice_api = require('../util/ice_api');
var assert = require("assert");

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

});
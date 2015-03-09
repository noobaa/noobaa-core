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

        var windowMock = {};
        windowMock.RTCPeerConnection = function() {
            var conn = {
                candidates: 0,
                offers: 0,
                dataChannels: 0,
                remoteDesk: 0,
                localDesk: 0,
                answers: 0,
                createDataChannel: function () {
                    this.dataChannels += 1;
                    return {
                        close: function () {}
                    };
                },
                createOffer: function (descCB) {
                    this.offers += 1;
                    descCB('desc');
                },
                addIceCandidate: function () {
                    this.candidates += 1;
                    return {};
                },
                setRemoteDescription: function () {
                    this.remoteDesk += 1;
                    return {};
                },
                createAnswer: function (descCB) {
                    this.answers += 1;
                    descCB('desc');
                },
                setLocalDescription: function () {
                    this.localDesk += 1;
                    return {};
                }
            };
            return conn;
        };

        var rewire = require('rewire');
        var ice_lib = rewire('../util/ice_lib');
        ice_lib.__set__({
            'WebSocket': wsMock
        });
        global.window = windowMock;
        global.RTCIceCandidate = sinon.spy();
        global.RTCSessionDescription = sinon.spy();


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
        assert.ok(socket.alive_interval, 'ws onopen issue - keep alive not set');
        assert.ok(socket.ws.msgsSent[0].indexOf('sigType') >= 0, 'ws onopen issue - msg not sent');
        assert.equal(socket.idInServer,agentId, 'ws onopen issue - id not set');

        // clear keep alive interval and stale conns one
        clearInterval(socket.alive_interval);
        clearInterval(socket.stale_conn_interval);

        // chk that when id msg received from server it is ignored for agent
        socket.ws.onmessage({sigType: 'id', id: 'ytytytytyt'});
        assert.equal(socket.idInServer,agentId, 'id sent from server should be ignored by agent');

        // test send message to peer
        ice_lib.sendWSMessage(socket, '6y6y6yy6', '7777', {df: 'hh', ba: '434'});
        assert.ok(socket.ws.msgsSent[1].indexOf('sigType') >= 0, 'sendWSMessage issue - didnt send with sigType');
        assert.ok(socket.ws.msgsSent[1].indexOf('ice') >= 0, 'sendWSMessage issue - didnt send with ice');
        assert.ok(socket.ws.msgsSent[1].indexOf('434') >= 0, 'sendWSMessage issue - didnt send with body');

        // chk that when request of no specific type arrives it goes to the right method
        socket.handleRequestMethod = function(ws, message) {
            console.log('got msg '+message);
            ws.msgsRec.push(message);
        };
        socket.ws.onmessage({sigType: 'blat', requestId: 'blat'});
        assert.ok(socket.ws.msgsRec[0].sigType === 'blat', 'onmessage issue - didnt receive');

        // get ice connection to peer of which and ice connection already exists
        var peerId = '9i9i9i9';
        var reqId = '999';
        p2p_context.iceSockets[peerId] = {
            peerConn: 1,
            dataChannel: 2,
            usedBy: {}
        };
        ice_lib.initiateIce(p2p_context, socket, peerId, true, reqId);
        assert.ok(socket.icemap[reqId].peerId === peerId,'initiateIce issue - peer id not marked');
        assert.ok(socket.icemap[reqId].isInitiator,'initiateIce issue - initiator not marked');
        assert.ok(socket.icemap[reqId].requestId === reqId,'initiateIce issue - req id not marked');
        assert.ok(p2p_context.iceSockets[peerId].usedBy[reqId] === 1,'initiateIce issue - used by not marked');

        // get ice connection to peer - new
        peerId = '9i9i888';
        reqId = '888';
        assert(!socket.icemap[reqId], 'request used before ?');
        ice_lib.initiateIce(p2p_context, socket, peerId, true, reqId);
        assert.ok(socket.ws.msgsSent[2].indexOf('sigType') >= 0,'cant find accept msg sig type');
        assert.ok(socket.ws.msgsSent[2].indexOf('accept') >= 0,'cant find accept msg type');
        assert(socket.icemap[reqId].peerConn.offers === 1, 'ice offer not called during initiateIce');

        // candidate ws msg handling
        assert(socket.icemap[reqId].peerConn.candidates === 0, 'addIceCandidate called before ?');
        socket.ws.onmessage({sigType: 'ice', requestId: reqId, from: peerId, to: agentId, data: {type: 'candidate', candidate:'gaga'}});
        assert(socket.icemap[reqId].peerConn.candidates === 1, 'addIceCandidate not called');
        assert(global.RTCIceCandidate.calledOnce, 'global.RTCIceCandidate not called');

        // offer ws msg handling
        assert(socket.icemap[reqId].peerConn.answers === 0, 'ice offer answer called before: '+socket.icemap[reqId].peerConn.offers+' should be 0');
        socket.ws.onmessage({sigType: 'ice', requestId: reqId, from: peerId, to: agentId, data: {type: 'offer', offer:'gaga'}});
        assert(socket.icemap[reqId].peerConn.answers === 1, 'ice answer not called');
        assert(global.RTCSessionDescription.calledOnce, 'global.RTCSessionDescription not called');

        // answer ws msg handling
        assert(socket.icemap[reqId].peerConn.remoteDesk === 1, 'ice set remote desc called before: '+socket.icemap[reqId].peerConn.remoteDesk+' should be 1');
        socket.ws.onmessage({sigType: 'ice', requestId: reqId, from: peerId, to: agentId, data: {type: 'answer', answer:'gaga'}});
        assert(socket.icemap[reqId].peerConn.remoteDesk === 2, 'ice handle answer not called');
        assert(global.RTCSessionDescription.calledTwice, 'global.RTCSessionDescription not called');

        // test onopen of dataChannel
        socket.icemap[reqId].dataChannel.onopen();
        assert.ok(p2p_context.iceSockets[peerId].usedBy[reqId] === 1,'channel open issue - used by not marked');

        // test peer conn onicecandidate
        socket.icemap[reqId].peerConn.onicecandidate({candidate: {
                sdpMLineIndex: 1,
                sdpMid: 2,
                candidate: 'fgfgfhf'
            }
        });
        var int1 = setInterval(function() {
            if (socket.ws.msgsSent[3]) {
                assert.ok(socket.ws.msgsSent[3].indexOf('sigType') >= 0,'cant find onicecandidate msg sig type');
                clearInterval(int1); int1 = null;
            }
        },1000);
        int1.unref();

        // check close
        ice_lib.closeIce(socket, reqId, socket.icemap[reqId].dataChannel);
        assert.ok(socket.icemap[reqId].done, 'close ice didnt mark req as done is: '+socket.icemap[reqId].done);
        assert.ok(!p2p_context.iceSockets[peerId].usedBy[reqId], 'close ice didnt delete used by');
        ice_lib.closeSignaling(socket);

    });

    it('test ws req', function(done) {

        var int1, int2, int3;
        var ice_lib;
        var socket;

        function clearIntervalsAndEnd() {
            try {clearInterval(int1);} catch (err) {}
            try {clearInterval(int2);} catch (err) {}
            try {clearInterval(int3);} catch (err) {}

            ice_lib.closeSignaling(socket);
        }

        try {
            // create mock for web sockets
            var wsMock = function(addr) {
                this.ws = {
                    msgsSent: [],
                    msgsRec: []
                };

                this.ws.send = function(msg) {
                    this.msgsSent.push(msg);
                    //console.log('test ws req got MSG '+require('util').inspect(this.msgsSent));
                };

                console.log('creating dummy ws for addr '+addr);
                return this.ws;
            };

            var rewire = require('rewire');
            ice_lib = rewire('../util/ice_lib');
            ice_lib.__set__({
                'WebSocket': wsMock
            });

            var peerId = 'rgg4YYYYYYYh45h5';
            var reqId = '88888';

            var p2p_context = {
                iceSockets: {}
            };

            // open mock web socket to signaling server
            socket = ice_lib.setup(function(p2p_context, channel, event) {
                console.log('got event '+event.data+' from peer '+channel.peerId);
            }, null, function(channel, message) {
                console.log('got message '+message+' from peer '+channel.peerId);
            });

            // clear keep alive interval and stale conns one
            clearInterval(socket.alive_interval); socket.alive_interval = null;
            clearInterval(socket.stale_conn_interval); socket.stale_conn_interval = null;

            // add socket to context
            p2p_context.wsClientSocket = {ws_socket: socket, lastTimeUsed: new Date().getTime(), interval: {}};


            assert(!socket.icemap[reqId], 'request used before ?');
            ice_lib.initiateIce(p2p_context, socket, peerId, true, reqId);
            socket.icemap[reqId].dataChannel.onopen();

            // test send ws request
            var requestId;

            int1 = setInterval(function() {
                if (socket.conn_defer) {
                    socket.conn_defer.resolve();
                    clearInterval(int1); int1 = null;
                }
            },1000);
            int1.unref();

            int2 = setInterval(function() {
                if (socket.ws.msgsSent[0]) {
                    var msgIndex = (socket.ws.msgsSent[1] ? 1 :0);
                    assert.ok(socket.ws.msgsSent[msgIndex].indexOf('sigType') >= 0,'cant find sendWSRequest msg sig type '+require('util').inspect(socket.ws.msgsSent));
                    assert.ok(socket.ws.msgsSent[msgIndex].indexOf('replicate') >= 0,'cant find sendWSRequest msg type replicate '+require('util').inspect(socket.ws.msgsSent));
                    var msgSent = JSON.parse(socket.ws.msgsSent[msgIndex]);
                    requestId = msgSent.requestId;
                    clearInterval(int2); int2 = null;
                }
            },1000);
            int2.unref();

            int3 = setInterval(function() {
                if (requestId && socket.action_defer[requestId]) {
                    socket.action_defer[requestId].resolve('{status: 200}');
                    clearInterval(int3); int3 = null;
                }
            },1000);
            int3.unref();

            return Q.fcall(function() {
                return ice_api.sendWSRequest(p2p_context, peerId, {method: 'GET', path: '/replicate/block/4t5t54t4', body: 'my body'});
            }).then(function(res) {
                assert.ok(res.indexOf('200') >= 0, 'sendWSRequest failed res is: '+res);
                clearIntervalsAndEnd();
            }).then(null, function(err) {
                console.error('WS test ws req (sendWSRequest) threw an ex '+err);
                clearIntervalsAndEnd();
                assert.fail();
            }).nodeify(done);
        } catch (ex) {
            console.error('WS test ws req threw an ex: '+ex);
            clearIntervalsAndEnd();
            assert.fail();
        }

    });

    it('test ice req', function(done) {

        var int1, int2, int3;
        var ice_lib;
        var socket;

        function clearIntervalsAndEnd() {
            try {clearInterval(int1);} catch (err) {}
            try {clearInterval(int2);} catch (err) {}
            try {clearInterval(int3);} catch (err) {}

            ice_lib.closeSignaling(socket);
        }

        try {
            // create mock for web sockets
            var wsMock = function(addr) {
                this.ws = {
                    msgsSent: [],
                    msgsRec: []
                };

                this.ws.send = function(msg) {
                    this.msgsSent.push(msg);
                    //console.log('test ws req got MSG '+require('util').inspect(this.msgsSent));
                };

                console.log('creating dummy ws for addr '+addr);
                return this.ws;
            };

            var rewire = require('rewire');
            ice_lib = rewire('../util/ice_lib');
            ice_lib.__set__({
                'WebSocket': wsMock
            });

            var peerId = 'rgg4g5545hh45h5';
            var agentId = 'rdgdgerg4egegr';
            var requestId;

            var p2p_context = {
                iceSockets: {}
            };

            // add socket to context
            p2p_context.iceSockets[peerId] = {
                peerConn: {},
                dataChannel: {
                    myId: agentId,
                    msgsSent: [],
                    msgsRec: [],
                    send: function(msg) {
                        this.msgsSent.push(msg);
                        //console.log('test ice req got MSG '+require('util').inspect(this.msgsSent));
                        if (msg.indexOf('/read') > 0) {
                            int3 = setInterval(function() {
                                if (requestId) {
                                    ice_api.onIceMessage(p2p_context, p2p_context.iceSockets[peerId].dataChannel, {
                                        data: JSON.stringify({
                                            req: requestId,
                                            body: 'dhttrtrhrth',
                                            status: 200
                                        })
                                    });
                                    clearInterval(int3); int3 = null;
                                }
                            }, 1000); int3.unref();
                        }
                    },
                    msgs: {}
                },
                usedBy: {}
            };

            // open mock web socket to signaling server
            socket = ice_lib.setup(function(p2p_context, channel, event) {
                console.log('got event '+event.data+' from peer '+channel.peerId);
            }, agentId, function(channel, message) {
                console.log('got message '+message+' from peer '+channel.peerId);
            });

            // clear keep alive interval and stale conns one
            clearInterval(socket.alive_interval); socket.alive_interval = null;
            clearInterval(socket.stale_conn_interval); socket.stale_conn_interval = null;

            int1 = setInterval(function() {
                if (socket.conn_defer) {
                    socket.conn_defer.resolve();
                    clearInterval(int1); int1 = null;
                }
            },1000);
            int1.unref();

            int2 = setInterval(function() {
                if (p2p_context.iceSockets[peerId] && p2p_context.iceSockets[peerId].usedBy &&
                    Object.keys(p2p_context.iceSockets[peerId].usedBy).length === 1) {
                    requestId = Object.keys(p2p_context.iceSockets[peerId].usedBy)[0];
                    socket.icemap[requestId].connect_defer.resolve(p2p_context.iceSockets[peerId].dataChannel);
                    clearInterval(int2); int2 = null;
                }
            },1000);
            int2.unref();

            return Q.fcall(function() {
                var options = {body:'thfhf',path:'/read',method:'GET'};
                return ice_api.sendRequest(p2p_context, socket, peerId, options);
            }).then(function(res) {
                console.log('sendICERequest res is '+require('util').inspect(res));
                assert.ok(res.status === 200, 'sendICERequest failed res is: '+res);
                clearIntervalsAndEnd();
            }).then(null, function(err) {
                console.error('ICE test ice req (sendICERequest) threw an ex '+err);
                clearIntervalsAndEnd();
                assert.fail();
            }).nodeify(done);
        } catch (ex) {
            console.error('ICE test ice req threw an ex: '+ex+' ; '+ex.stack);
            clearIntervalsAndEnd();
            assert.fail();
        }

    });

});
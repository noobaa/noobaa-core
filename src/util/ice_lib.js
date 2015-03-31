'use strict';

var WebSocket = require('ws');
var Q = require('q');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');
var zlib = require('zlib');
var _ = require('lodash');
var Semaphore = require('noobaa-util/semaphore');
var buf = require('./buffer_utils');
var promise_utils = require('./promise_utils');

var configuration = config.ice_servers;

var optionalRtpDataChannels = {
    optional: [{
        RtpDataChannels: false
    }]
};

module.exports = {};

/********************************
 * connection to signaling server
 ********************************/

function keepalive(socket) {
    dbg.log3('send keepalive from '+socket.idInServer);
    try {
        socket.ws.send(JSON.stringify({sigType: 'keepalive', from: socket.idInServer}));
    } catch (ex) {
        dbg.error('keepalive error '+ ex);
    }
}

function disconnect(socket) {
    dbg.log0('called disconnect ws');
    if (!socket.ws) {return;}
    dbg.log0('called disconnect ws - clear interval and close');
    try {
        socket.ws.close();
    } catch (ignore) {
        // do nothing
    }
    try {
        clearInterval(socket.alive_interval);
        socket.ws = null;
        socket.alive_interval = null;
    } catch (ex) {
        dbg.error('failed disconnect ws '+ ex.stack);
    }
}

function closeWSContext(socket) {
    var currWs = socket.p2p_context.wsClientSocket;
    dbg.log0('onclose ws context');
    if (currWs.interval) {
        clearInterval(currWs.interval);
    }
    if (currWs.ws_socket) {
        disconnect(currWs.ws_socket);
    }
    delete socket.p2p_context.wsClientSocket;
}

var connect = function (socket) {
    dbg.log0('do CLIENT connect is agent: ' + socket.isAgent + " current id: " + socket.idInServer);

    if (!socket.isAgent) {
        socket.conn_defer = Q.defer();
    }

    try {
        var ws = new WebSocket(config.address);

        ws.onopen = function () {

            dbg.log0('ws open connect is agent: ' + socket.isAgent + " current id: " + socket.idInServer);

            if (socket.isAgent) {
                ws.send(JSON.stringify({sigType: 'id', id: socket.idInServer}));
            }

            socket.alive_interval = setInterval(function () {
                keepalive(socket);
            }, config.alive_delay);

            };

        ws.onmessage = function (msgRec) {

            //dbg.log0('#### got msg '+require('util').inspect(msgRec));

            if (typeof msgRec === 'string' || msgRec instanceof String) {
                try {
                    msgRec = JSON.parse(msgRec);
                } catch (ex) {
                    dbg.log0('problem parsing msg '+msgRec);
                }
            }

            var message;
            if (msgRec.sigType) {
                message = msgRec;
            } else if (msgRec.data) {
                if (typeof msgRec.data === 'string' || msgRec.data instanceof String) {
                    message = JSON.parse(msgRec.data);
                } else {
                    message = msgRec.data;
                }
            } else {
                dbg.log0('cant find msg '+msgRec);
            }

            if (message.sigType === 'id') {
                if (socket.isAgent) {
                    dbg.log3('id '+ message.id+' from server ignored, i am '+socket.idInServer);
                } else {
                    dbg.log2('got ws id from server id ' + message.id);
                    socket.idInServer = message.id;
                    if (socket.conn_defer) {
                        socket.conn_defer.resolve();
                    }
                }
            } else if (message.sigType === 'ice') {
                if (typeof message.data === 'string' || message.data instanceof String) {
                    var buf = new Buffer(message.data, 'binary');
                    zlib.gunzip(buf, function (err, msgData) {
                        msgData = JSON.parse(msgData);
                        dbg.log0('Got ice from ' + message.from + ' to ' + message.to + ' data ' + msgData + (err ? ' gzip error '+err : '')+' i am '+socket.idInServer);
                        signalingMessageCallback(socket, message.from, msgData, message.requestId);
                    });
                } else {
                    dbg.log2('Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                    signalingMessageCallback(socket, message.from, message.data, message.requestId);
                }
            } else if (message.sigType === 'accept') {
                dbg.log2('Got accept ' + message + ' from '+message.from+' to '+message.to+' i am '+socket.idInServer);
                initiateIce(socket.p2p_context ,socket, message.from, false, message.requestId);
            } else if (message.sigType === 'keepalive') {
                dbg.log3('Got keepalive from ' + message.from);
            } else if (message.sigType && message.requestId) {
                dbg.log0('Got ' + message.sigType + ' from web server '+message.from+' to '+message.to+' i am '+socket.idInServer);
                if (message.sigType === 'response' && message.status && message.status === 500) {
                    if (socket.p2p_context && socket.p2p_context.iceSockets && socket.p2p_context.iceSockets[message.from]
                        && socket.p2p_context.iceSockets[message.from].connect_defer) {
                        socket.p2p_context.iceSockets[message.from].connect_defer.reject(message);
                        socket.p2p_context.iceSockets[message.from].connect_defer = null;
                    } else if (socket.icemap && socket.icemap[message.requestId] && socket.icemap[message.requestId].connect_defer) {
                        socket.icemap[message.requestId].connect_defer.reject(message);
                        socket.icemap[message.requestId].connect_defer = null;
                    } else if (socket.action_defer && socket.action_defer[message.requestId]) {
                        socket.action_defer[message.requestId].reject(message);
                    } else {
                        dbg.log0('got bad conn sig message that cant handle ' + require('util').inspect(message));
                    }
                } else if (socket.action_defer && socket.action_defer[message.requestId]) {
                    socket.action_defer[message.requestId].resolve(message);
                    delete socket.action_defer[message.requestId];
                } else {
                    socket.handleRequestMethod(socket, ws, message);
                }
            } else {
                dbg.error('unknown sig message ' + require('util').inspect(message));
                try {
                    dbg.error('unknown sig message 2 ' + JSON.stringify(message));
                } catch (ex) {
                    dbg.error('unknown sig message 3 ' + message);
                }
            }
        };

        ws.onerror = function (err) {
            dbg.error('onerror ws ' + require('util').inspect(err)+' ; '+err.stack);

            if (socket.conn_defer) {
                socket.conn_defer.reject();
            }

            if (socket.action_defer) {
                socket.action_defer.reject();
            }

            if (socket.isAgent) {
                dbg.log0('onerror ws agent');
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, config.reconnect_delay);
            } else if (socket.p2p_context && socket.p2p_context.wsClientSocket) {
                closeWSContext(socket);
            } else {
                dbg.log0('onerror ws - disconnect not agent & no context');
                disconnect(socket);
            }

        };

        ws.onclose = function () {
            dbg.log0('onclose ws');
            if (socket.isAgent) {
                dbg.log0('onclose ws agent');
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, config.reconnect_delay);
            } else if (socket.p2p_context && socket.p2p_context.wsClientSocket) {
                closeWSContext(socket);
            } else {
                dbg.log0('onclose ws - disconnect not agent & no context');
                disconnect(socket);
            }
        };

        socket.ws = ws;
    } catch (ex) {
        dbg.error('ice_lib.connect ERROR '+ ex+' ; ' + ex.stack);
    }

    return socket;
};

function sendMessage(socket, peerId, requestId, message) {
    dbg.log0('Client sending message: '+ message + ' to peer '+peerId+' for req '+requestId+' i am '+socket.idInServer
            +' init: '+(socket.icemap[requestId] ? socket.icemap[requestId].isInitiator : 'N/A'));

    var toSend = {
        sigType: 'ice',
        from: socket.idInServer,
        to: peerId,
        requestId: requestId
    };

    if (typeof message === 'string' || message instanceof String) {
        var buf = new Buffer(message, 'utf-8');
        zlib.gzip(buf, function (err, result) {
            result = result.toString('binary');
            if (err) {
                dbg.log0('sending ice msg gzip error '+err);
            }
            toSend.data = result;
            socket.ws.send(JSON.stringify(toSend));
        });
    } else {
        toSend.data = message;
        socket.ws.send(JSON.stringify(toSend));
    }
}
module.exports.sendWSMessage = sendMessage;

/********************************
 * handle stale connections
 ********************************/
function staleConnChk(socket) {

    if (!config.doStaleCheck) {
        return;
    }

    dbg.log2('RUNNING staleConnChk ICE');

    var now = (new Date()).getTime();
    var toDel = [];
    var requestId;
    var peerId;
    var pos;
    var timePassed;
    var channel;
    var peerObj;

    try {
        if (socket && socket.icemap) {
            for (requestId in socket.icemap) {
                timePassed = now - socket.icemap[requestId].created.getTime();
                dbg.log2('chk stale connections requests to peer ' + socket.icemap[requestId].peerId + ' time passed ' +
                timePassed+' for req '+requestId+' is done '+socket.icemap[requestId].done);
                if (timePassed > config.connection_data_stale && socket.icemap[requestId].done) {
                    toDel.push(requestId);
                } else if (timePassed > config.connection_data_stale * 2) {
                    toDel.push(requestId);
                }
            }

            for (pos in toDel) {
                requestId = toDel[pos];
                peerId = socket.icemap[requestId].peerId;
                dbg.log0('remove stale connections data to peer ' + peerId+' for request '+requestId);

                if (socket && socket.p2p_context && socket.p2p_context.iceSockets && socket.p2p_context.iceSockets[peerId]) {
                    peerObj = socket.p2p_context.iceSockets[peerId];
                    channel = peerObj.dataChannel;
                    if (channel && channel.msgs && channel.msgs[requestId]) {
                        dbg.log0('remove stale connections msgs&usedBy to peer ' + peerId+' for request '+requestId);
                        delete channel.msgs[requestId];
                        delete peerObj.usedBy[requestId];
                    }
                }
                delete socket.icemap[requestId];
            }
        }
    } catch (ex) {
        dbg.error('Error on staleConnChk of icemap ex '+ex+' ; '+ex.stack);
    }

    try {
        if (socket && socket.p2p_context && socket.p2p_context.iceSockets) {
            now = (new Date()).getTime();
            toDel = [];


            for (peerId in socket.p2p_context.iceSockets) {
                timePassed = now - socket.p2p_context.iceSockets[peerId].lastUsed;
                dbg.log2('chk stale connections to peer '+peerId+' time passed '+timePassed+
                ' used by '+require('util').inspect(socket.p2p_context.iceSockets[peerId].usedBy));
                if (timePassed > config.connection_data_stale &&
                    Object.keys(socket.p2p_context.iceSockets[peerId].usedBy).length === 0) {
                    toDel.push(peerId);
                }
            }

            for (pos in toDel) {
                peerId = toDel[pos];
                dbg.log2( 'remove stale ice connections to peer ' + peerId);
                if (socket.p2p_context.iceSockets[peerId].dataChannel) {
                    try {socket.p2p_context.iceSockets[peerId].dataChannel.close();} catch (err){}
                }
                if (socket.p2p_context.iceSockets[peerId].peerConn) {
                    try{socket.p2p_context.iceSockets[peerId].peerConn.close();} catch (err){}
                }
                delete socket.p2p_context.iceSockets[peerId];
            }
        }
    } catch (ex) {
        dbg.error('Error on staleConnChk of p2p_context iceSockets ex '+ex+' ; '+ex.stack);
    }
}

/* /////////////////////////////////////////// */
/* ICE */
/* /////////////////////////////////////////// */
function initiateIce(p2p_context, socket, peerId, isInitiator, requestId) {
    var channelObj;
    try {
        socket.icemap[requestId] = {
            peerId: peerId,
            isInitiator: isInitiator,
            requestId: requestId,
            created: new Date()
        };
        channelObj = socket.icemap[requestId];

        // TODO this next part may ignore a received context and it's unclear what context to use
        if (socket.p2p_context) {
            dbg.log0('initiateIce: using socket.p2p_context '+requestId);
            p2p_context = socket.p2p_context;
        } else {
            dbg.log0('initiateIce: setting p2p_context to socket.p2p_context '+requestId);
            socket.p2p_context = p2p_context;
        }
        if (p2p_context && !p2p_context.iceSockets) {
            p2p_context.iceSockets = {};
        }

        if (isInitiator && p2p_context) {
            if (!p2p_context.iceSockets[peerId]) {
                p2p_context.iceSockets[peerId] = {
                    lastUsed: (new Date()).getTime(),
                    usedBy: {},
                    status: 'new'
                };
            }
            if (!p2p_context.iceSockets[peerId].sem) {
                p2p_context.iceSockets[peerId].sem = new Semaphore(1);
            }
            if (!p2p_context.iceSockets[peerId].connect_defer) {
                p2p_context.iceSockets[peerId].connect_defer = Q.defer();
                if (p2p_context.iceSockets[peerId].status === 'start') {
                    p2p_context.iceSockets[peerId].status = 'new';
                }
            }
        }

        if (isInitiator) {
            if (p2p_context) {
                return p2p_context.iceSockets[peerId].sem.surround(function() {

                    try {
                        if (p2p_context.iceSockets[peerId].status === 'open') {
                            var state = p2p_context.iceSockets[peerId].dataChannel.readyState;
                            if (state && (state === 'closing' || state === 'closed')) {
                                dbg.log0('state of ice conn to peer ' + peerId+ ' is: '+state+' force close');
                                forceCloseIce(p2p_context, peerId, channelObj, socket);
                            }
                        }

                        if (p2p_context.iceSockets[peerId].status === 'new') {
                            dbg.log0('send accept to peer ' + peerId+ ' with req '+requestId+ ' from '+socket.idInServer);
                            socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
                            createPeerConnection(socket, requestId, configuration);
                            p2p_context.iceSockets[peerId].status = 'start';
                            channelObj.connect_defer = p2p_context.iceSockets[peerId].connect_defer;
                        } else if (p2p_context.iceSockets[peerId].status === 'open') {
                            dbg.log0('initiateIce: status open '+requestId);
                            channelObj.dataChannel = p2p_context.iceSockets[peerId].dataChannel;
                            channelObj.peerConn = p2p_context.iceSockets[peerId].peerConn;
                            p2p_context.iceSockets[peerId].lastUsed = (new Date()).getTime();
                            p2p_context.iceSockets[channelObj.peerId].usedBy[requestId] = 1;
                            channelObj.connect_defer = Q.defer();
                            channelObj.connect_defer.resolve(channelObj.dataChannel);
                        } else if (p2p_context.iceSockets[peerId].status === 'start') {
                            dbg.log0('initiateIce: status start '+requestId);
                            channelObj.connect_defer = p2p_context.iceSockets[peerId].connect_defer;
                            p2p_context.iceSockets[peerId].lastUsed = (new Date()).getTime();
                            p2p_context.iceSockets[peerId].usedBy[requestId] = 1;
                            channelObj.peerConn = p2p_context.iceSockets[peerId].peerConn;
                        }
                        return channelObj.connect_defer.promise;
                    } catch (err) {
                        dbg.error('Error on initiateIce sem.surround',err,err.stack);
                        throw err;
                    }

                });
            } else {
                channelObj.connect_defer = Q.defer();
                dbg.log0('send accept to peer (no context) ' + peerId+ ' with req '+requestId+ ' from '+socket.idInServer);
                socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
                createPeerConnection(socket, requestId, configuration);
                return (channelObj.connect_defer ? channelObj.connect_defer.promise : null);
            }
        }

        // not isInitiator
        createPeerConnection(socket, requestId, configuration);
    } catch (ex) {
        dbg.error('Error on initiateIce '+(isInitiator ? 'to' : 'for')+' peer '+peerId+' ex ',ex,ex.stack,channelObj);
        throw ex;
    }

}
module.exports.initiateIce = initiateIce;

function chkChannelState(channel, requestId) {
    var state = channel.readyState;
    if (state && (state === 'closing' || state === 'closed')) {
        dbg.error('ERROR writing to channel for request '+requestId+' and peer '+channel.peerId +' channel state is '+state);
        throw new Error('ERROR writing to channel state is '+state);
    }
}
module.exports.chkChannelState = chkChannelState;

function createBufferToSend(block, seq, reqId) {
    try {
        var bufToSend = new Buffer(config.iceBufferMetaPartSize);
        reqId = parseInt(reqId, 10);
        bufToSend.writeInt32LE(reqId,0);
        bufToSend.writeInt32LE(seq,4);
        bufToSend = buf.addToBuffer(bufToSend, block);
        return buf.toArrayBuffer(bufToSend);
    } catch (err) {
        dbg.error('error in createBufferToSend for req '+reqId+' err: '+err+' '+err.stack);
        throw err;
    }
}
module.exports.createBufferToSend = createBufferToSend;

/**
 *
 * writeToChannel
 *
 * channel.bufferedAmount is the only congestion control interface
 * that we have in JS, so we poll it.
 * it increases as we send more on the channel before it has a chance
 * to flush to the socket so we need the current stack to return and release the cpu.
 */
function writeToChannel(socket, channel, data, requestId) {

    var startTime = Date.now();
    var lastTimeLogged = startTime;

    function describe(currentTime) {
        return 'peer ' + channel.peerId + ' req ' + requestId +
            ' wait so far ' + (currentTime - startTime) + 'ms' +
            ' bufferedAmount ' + channel.bufferedAmount +
            (channel.throttled ? ' throttled' : '') +
            ' throttle waits ' + channel.throttle_num_waits;
    }

    function send_if_not_congested() {
        var currentTime = Date.now();

        if (currentTime - startTime > config.channel_send_timeout) {
            dbg.error('writeToChannel: WAITED TOO MUCH', describe(currentTime));
            var err = new Error('writeToChannel: WAITED TOO MUCH');
            err.DO_NOT_RETRY = true;
            throw err;
        }

        if (currentTime - lastTimeLogged > 1000) {
            lastTimeLogged = currentTime;
            dbg.log0('writeToChannel: in progress ', describe(currentTime));
        }

        // check channel readyState and throw if closed
        // don't retry here if channel is closed,
        // also make sure to check that before checking the bufferedAmount
        // because the amount seem to have a case of remain not zero after channel is closed.
        try {
            chkChannelState(channel, requestId);
        } catch (err) {
            err.DO_NOT_RETRY = true;
            throw err;
        }

        // throw if bufferedAmount is not zero, to be handled by the retry
        if (channel.bufferedAmount > config.channel_buffer_start_throttle ||
            (channel.throttled && channel.bufferedAmount > config.channel_buffer_stop_throttle)) {
            channel.throttled = true;
            channel.throttle_num_waits = (channel.throttle_num_waits || 0) + 1;
            throw new Error('writeToChannel: WAITING ' + describe(currentTime));
        } else {
            channel.throttled = false;
        }

        try {
            // error injection - change to true to test
            if (false) { // do not commit this as true !!
                if (Math.random() < 0.01) {
                    dbg.error('writeToChannel: ERROR INJECTION ', describe(currentTime));
                    throw new Error('writeToChannel: ERROR INJECTION');
                }
            }
            channel.send(data);
        } catch (err) {
            // don't retry if send fails,
            // no reason why retry will help,
            // most likely the channel was closed
            dbg.log2('writeToChannel: DO_NOT_RETRY ',err, describe(currentTime));
            err.DO_NOT_RETRY = true;
            throw err;
        }
    }

    // setup a semaphore(1) on the channel to avoid pegging the bufferedAmount checks
    // and to make all senders wait in ordered queue. like europeans.
    channel.write_sem = channel.write_sem || new Semaphore(1);
    return channel.write_sem.surround(function() {
        // use retry with delay between attempts to send
        return promise_utils.retry(
            config.channel_send_congested_attempts,
            config.channel_send_congested_delay,
            send_if_not_congested)
            .then(null, function(err) {
                if (err.DO_NOT_RETRY) {
                    dbg.error('writeToChannel: ERROR (do not retry)', err.stack || err, requestId);
                } else {
                    dbg.error('writeToChannel: ERROR (retries exhausted)', err.stack || err, requestId);
                }
                // close this channel
                var channelObj = socket && socket.icemap ? socket.icemap[requestId] : null;
                forceCloseIce(socket.p2p_context, channel.peerId, channelObj, socket);
                throw err;
            });
    });
}
module.exports.writeToChannel = writeToChannel;

function isRequestEnded(p2p_context, requestId, channel) {
    if (channel && channel.msgs && channel.msgs[requestId]) {
        return false;
    }

    if (p2p_context && p2p_context.socket && p2p_context.socket.icemap) {
        var channelObj = p2p_context.socket.icemap[requestId];
        if (channelObj) {
            return channelObj.done;
        }
    }

    return false;
}
module.exports.isRequestEnded = isRequestEnded;

function closeIce(socket, requestId, dataChannel, dontClose) {

    if (!config.doStaleCheck) {
        return;
    }

    try {
        if (dataChannel && dataChannel.msgs && dataChannel.msgs[requestId]) {
            delete dataChannel.msgs[requestId];
        }

        var peerId;
        if (dataChannel) {
            peerId = dataChannel.peerId;
        }

        var obj;
        var channelObj = socket && socket.icemap ? socket.icemap[requestId] : null;
        if (channelObj) {
            channelObj.done = true;
            if (!peerId) {
                peerId = channelObj.peerId;
            }
        }

        obj = socket && socket.p2p_context && socket.p2p_context.iceSockets ? socket.p2p_context.iceSockets[peerId] : null;

        if (obj && obj.dataChannel === dataChannel) {
            obj.lastUsed = (new Date()).getTime();
            delete obj.usedBy[requestId];
        } else if (socket && !socket.p2p_context && !dontClose) {
            if (channelObj && channelObj.peerConn) {
                channelObj.peerConn.close();
            }
            if (dataChannel) {
                dbg.log0('Closing the ice socket to peer ' +dataChannel.peerId);
                dataChannel.close();
            }
            disconnect(socket);
        }
    } catch (ex) {
        dbg.error('Error on close ice socket for request '+requestId,ex,ex.stack);
    }
}
module.exports.closeIce = closeIce;

function forceCloseIce(p2p_context, peerId, channelObj, socket) {

    var context = p2p_context;
    if (!context && socket) {
        context = socket.p2p_context;
    }

    if (context && context.iceSockets && context.iceSockets[peerId] &&
        context.iceSockets[peerId].dataChannel) {
        dbg.log0('forceCloseIce peer '+peerId);
        context.iceSockets[peerId].dataChannel.close();
        context.iceSockets[peerId].peerConn.close();

        if (socket && socket.icemap && context.iceSockets[peerId].usedBy) {
            var req;
            for (req in context.iceSockets[peerId].usedBy) {
                if (socket.icemap[req]) {
                    dbg.log0('mark peer '+peerId+' req '+req+' as done so will be removed');
                    socket.icemap[req].done = true;
                }
            }
        }

        delete context.iceSockets[peerId];
    } else if (channelObj && channelObj.dataChannel) {
        dbg.log0('forceCloseIce (no context) peer '+peerId);
        channelObj.dataChannel.close();
        channelObj.peerConn.close();
        channelObj.done = true;
    } else {
        dbg.log0('forceCloseIce nothing to close - peer '+peerId);
    }
}

function logError(err) {
    dbg.error('logError called: '+ err);
}

function onLocalSessionCreated(socket, requestId, desc) {
    dbg.log0('local session created:'+ desc);
    var channelObj = socket.icemap[requestId];

    if (!channelObj || channelObj.done) {
        dbg.error('PROBLEM onLocalSessionCreated no channel or already done !!!');
        return;
    }

    try {
        channelObj.peerConn.setLocalDescription(desc, function () {
            dbg.log3('sending local desc:' + require('util').inspect(channelObj.peerConn.localDescription));
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        dbg.log0('Ex on local session ' + ex);
        if (channelObj && channelObj.connect_defer) {
            channelObj.connect_defer.reject();
            channelObj.connect_defer = null;
        }
    }
}

function handleCngSDP(desc) {
    try {
        var newDesc = desc;
        var split = desc.sdp.split("b=AS:30");
        if (split.length > 1) {
            newDesc.sdp = split[0] + "b=AS:1638400" + split[1];
            dbg.log3('cng desc from ---- '+desc +' ----- to ------ '+newDesc);
        }
        return newDesc;
    } catch (err) {
        dbg.error('PROBLEM handleCngSDP '+err+' '+err.stack+' ;; '+require('util').inspect(desc));
        return desc;
    }
}

function createPeerConnection(socket, requestId, config) {
    var channelObj = socket.icemap[requestId];
    if (!channelObj || channelObj.done) {
        dbg.error('PROBLEM Creating Peer connection no channel or already done !!!');
        return;
    }

    try {
        dbg.log2('Creating Peer connection as initiator ' + channelObj.isInitiator + ' config: ' + config);

        var FuncPerrConn = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

        try {
            channelObj.peerConn = new FuncPerrConn(config, optionalRtpDataChannels);
        } catch (ex) {
            dbg.error('prob win create '+ex.stack);
        }

        // send any ice candidates to the other peer
        channelObj.peerConn.onicecandidate = function (event) {
            var candidateMsg;
            if (event.candidate) {

                try {
                    candidateMsg = JSON.stringify({
                        type: 'candidate',
                        label: event.candidate.sdpMLineIndex,
                        id: event.candidate.sdpMid,
                        candidate: event.candidate.candidate
                    });

                    dbg.log3(channelObj.peerId+' onIceCandidate event: '+
                    require('util').inspect(event.candidate.candidate) +
                        ' state is '+(event.target ? event.target.iceGatheringState : 'N/A'));

                    sendMessage(socket, channelObj.peerId, channelObj.requestId, candidateMsg);
                } catch (ex) {
                    dbg.log0('candidates issue '+ex+' ; '+ex.stack);
                }

            } else {
                try {
                    dbg.log3(channelObj.peerId+' End of candidates. state is '+(event.target ? event.target.iceGatheringState : 'N/A')); // complete
                    if (channelObj.peerConn.candidates) {
                        for (candidateMsg in channelObj.peerConn.candidates) {
                            dbg.log2(channelObj.peerId+' send onIceCandidate event: '+ channelObj.peerConn.candidates[candidateMsg]);
                            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.candidates[candidateMsg]);
                        }
                    }
                } catch (ex) {
                    dbg.log0('all candidates issue '+ex+' ; '+ex.stack);
                }
            }
        };

        channelObj.peerConn.oniceconnectionstatechange = function(evt) {
            /*
             failed:
             The ICE agent is finished checking all candidate pairs and failed to find a connection for at least one component. Connections may have been found for some components.
             disconnected:
             Liveness checks have failed for one or more components. This is more aggressive than failed and may trigger intermittently (and resolve itself without action) on a flaky network.
             closed:
             The ICE agent has shut down and is no longer responding to STUN requests.
             */
            if (evt.target && evt.target.iceConnectionState &&
                'checking' !== evt.target.iceConnectionState &&
                'connected' !== evt.target.iceConnectionState &&
                'completed' !== evt.target.iceConnectionState
            ) {
                dbg.log0(channelObj.peerId+" NOTICE ICE connection state change: " + evt.target.iceConnectionState);
                if ('disconnected' === evt.target.iceConnectionState || 'failed' === evt.target.iceConnectionState) {
                    forceCloseIce(socket.p2p_context, channelObj.peerId, channelObj, socket);
                }
            }
        };

        channelObj.peerConn.signalingstatechange = function(evt) {
            dbg.log0(channelObj.peerId+" NOTICE ICE signalingstatechange: " + require('util').inspect(evt));
        };

        channelObj.peerConn.onidpassertionerror = function(evt) {
            dbg.log0(channelObj.peerId+" NOTICE ICE onidpassertionerror: " + require('util').inspect(evt));
        };

        channelObj.peerConn.onidpvalidationerror = function(evt) {
            dbg.log0(channelObj.peerId+" NOTICE ICE onidpvalidationerror: " + require('util').inspect(evt));
        };

        channelObj.peerConn.onremovestream = function(evt) {
            dbg.log0('onremovestream Data Channel req '+requestId+' evt '+require('util').inspect(evt));
        };

        if (channelObj.isInitiator) {
            dbg.log3('Creating Data Channel req '+requestId);
            try {
                var dtConfig = {
                    // we don't require strict ordering since we collect packets
                    // and assmble the entire message anyhow for multiplexing.
                    ordered: false,

                    // you can only specify maxRetransmits or maxPacketLifeTime, not both,
                    // and by passing any of these properties it will cause the channel to be
                    // in unreliable mode.
                    // we use an unreliable channel with retransmissions for when
                    // a packet is not delivered and avoid waiting for timeouts
                    // and sending the entire request from scratch.
                    maxRetransmits: 5
                    // maxPacketLifeTime: 3000,
                };
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa", dtConfig);
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                dbg.error('Ex on Creating Data Channel ' + ex);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
            }

            dbg.log3('Creating an offer req '+requestId);
            var mediaConstraints = {
                mandatory: {
                    OfferToReceiveAudio: false,
                    OfferToReceiveVideo: false
                }
            };
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    desc = handleCngSDP(desc);
                    dbg.log3('Creating an offer ' + require('util').inspect(desc));
                    return onLocalSessionCreated(socket, requestId, desc);
                }, logError, mediaConstraints); // TODO ? mediaConstraints
            } catch (ex) {
                dbg.error('Ex on Creating an offer ' + ex.stack);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
            }
        }

        channelObj.peerConn.ondatachannel = function (event) {
            dbg.log0('ondatachannel:'+ event.channel);
            try {
                channelObj.dataChannel = event.channel;
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                dbg.error('Ex on ondatachannel ' + ex.stack);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
            }
        };
    } catch (ex) {
        dbg.error('Ex on createPeerConnection ' + ex.stack);
        if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
    }
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelObj = socket.icemap[requestId];
    if (!channelObj || channelObj.done) {

        // got candidate for peer conn after finished request but has context - handle anyway
        if (socket && socket.p2p_context && message.type === 'candidate') {
            channelObj = socket.p2p_context.iceSockets[peerId];
        }

        if (!channelObj || channelObj.done) {
            dbg.error('problem NO channelObj or already done for req '+requestId+' and peer '+peerId);
            return;
        }
    }

    var Desc = RTCSessionDescription;
    var Candidate = RTCIceCandidate;

    if (message.type === 'offer') {
        dbg.log3('Got offer. Sending answer to peer. ' + peerId + ' and channel ' + requestId);

        try {
            channelObj.peerConn.setRemoteDescription(new Desc(message), function () {
                dbg.log3('remote desc set for peer '+peerId+' is '+require('util').inspect(message));
            }, logError);
            channelObj.peerConn.createAnswer(function (desc) {
                desc = handleCngSDP(desc);
                dbg.log3('createAnswer for peer '+peerId+' is '+require('util').inspect(desc));
                return onLocalSessionCreated(socket, requestId, desc);
            }, logError);
        } catch (ex) {
            dbg.error('problem in offer ' + ex.stack);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
        }

    } else if (message.type === 'answer') {
        try {
            dbg.log0('Got answer.' + peerId + ' and channel ' + requestId+' is '+require('util').inspect(message));
            channelObj.peerConn.setRemoteDescription(new Desc(message), function () {
                dbg.log3('remote desc set for peer '+peerId+' is '+require('util').inspect(message));
            }, logError);
        } catch (ex) {
            dbg.error('problem in answer ' + ex);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
        }

    } else if (message.type === 'candidate') {
        try {
            dbg.log3('Got candidate.' + peerId + ' and channel ' + requestId+' ; '+require('util').inspect(message));
            if (channelObj && !channelObj.done) {
                channelObj.peerConn.addIceCandidate(new Candidate({candidate: message.candidate}));
            } else {
                dbg.log0('Got candidate.' + peerId + ' and channel ' + requestId + ' CANNOT HANDLE connection removed/done');
            }
        } catch (ex) {
            dbg.error('problem in candidate from req '+ requestId +' ex:' + ex+ ', msg was: '+message.candidate);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject(); channelObj.connect_defer = null;}
        }
    } else if (message === 'bye') {
        dbg.log3('Got bye.');
    }
}

function onIceMessage(socket, channel) {
    return function onmessage(event) {
        return channel.callbackOnPeerMsg(socket, channel, event);
    };
}

function onDataChannelCreated(socket, requestId, channel) {

    try {
        dbg.log3('onDataChannelCreated:'+ channel);

        channel.onopen = function () {

            var channelObj = socket.icemap[requestId];
            channel.msgs = {};

            if (socket.p2p_context) {

                if (!socket.p2p_context.iceSockets) {
                    socket.p2p_context.iceSockets = {};
                }

                if (!socket.p2p_context.iceSockets[channelObj.peerId]) {
                    socket.p2p_context.iceSockets[channelObj.peerId] = {
                        lastUsed: (new Date()).getTime(),
                        usedBy: {}
                    };
                }

                socket.p2p_context.iceSockets[channelObj.peerId].peerConn = channelObj.peerConn;
                socket.p2p_context.iceSockets[channelObj.peerId].dataChannel = channelObj.dataChannel;
                socket.p2p_context.iceSockets[channelObj.peerId].usedBy[requestId] = 1;
                socket.p2p_context.iceSockets[channelObj.peerId].status = 'open';


                var req;
                for (req in socket.p2p_context.iceSockets[channelObj.peerId].usedBy) {
                    if (socket.icemap[req]) {
                        socket.icemap[req].dataChannel = channelObj.dataChannel;
                    }
                }

            }

            dbg.log0('ICE CHANNEL opened ' + channelObj.peerId+' i am '+socket.idInServer + ' for request '+requestId);

            channel.peerId = channelObj.peerId;
            channel.myId = socket.idInServer;
            channel.callbackOnPeerMsg = socket.callbackOnPeerMsg;
            channel.handleRequestMethod = socket.handleRequestMethod;

            if (channelObj.connect_defer) {
                dbg.log3('connect defer - resolve',channel.peerId);
                channelObj.connect_defer.resolve(channelObj.dataChannel);
                channelObj.connect_defer = null;
            } else {
                dbg.log3('no connect defer',channel.peerId);
            }
        };

        channel.onmessage = onIceMessage(socket, channel);

        channel.onleave = function (userid) {
            dbg.error('ICE CHANNEL onleave !!!! this ever called ??? ' + channel.peerId+ ' userid: '+userid);
        };

        channel.onclose = function () {
            dbg.log0('ICE CHANNEL closed ' + channel.peerId);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
                socket.icemap[requestId].connect_defer = null;
            }
            if (socket.icemap[requestId]) {
                socket.icemap[requestId].done = true;
            }

            var iceSocketObj = socket.p2p_context && socket.p2p_context.iceSockets[channel.peerId];
            if (iceSocketObj) {
                if (iceSocketObj.peerConn) {
                    try {iceSocketObj.peerConn.close(); } catch (err)  {}
                }
                delete socket.p2p_context.iceSockets[channel.peerId];
            }
        };

        channel.onerror = function (err) {
            dbg.error('CHANNEL ERROR ' + channel.peerId + ' ' + err);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
                socket.icemap[requestId].connect_defer = null;
            }
            if (socket.icemap[requestId]) {
                socket.icemap[requestId].done = true;
            }

            if (socket.p2p_context && socket.p2p_context.iceSockets[channel.peerId]) {
                delete socket.p2p_context.iceSockets[channel.peerId].usedBy[requestId];
            }
        };

    } catch (ex) {
        dbg.error('Ex on onDataChannelCreated ' + ex);

        if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
            socket.icemap[requestId].connect_defer.reject();
            socket.icemap[requestId].connect_defer = null;
        }
    }
}

module.exports.closeSignaling = function closeSignaling(socket) {
    if (!socket.isAgent) {
        try {
            disconnect(socket);
            clearInterval(socket.stale_conn_interval);
            socket.stale_conn_interval = null;
        } catch (err) {
            dbg.error('Ex on closeSignaling ' + err);
        }
    }
};

module.exports.setup = function setup(msgCallback, agentId, handleRequestMethod) {

    var socket = {
        idInServer: agentId,
        isAgent: agentId ? true : false,
        icemap: {},
        callbackOnPeerMsg: msgCallback,
        handleRequestMethod: handleRequestMethod
    };

    socket.stale_conn_interval = setInterval(function(){staleConnChk(socket);}, config.check_stale_conns);

    return connect(socket);

};

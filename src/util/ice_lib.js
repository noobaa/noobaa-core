'use strict';

var WebSocket = require('ws');
var Q = require('q');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');
var zlib = require('zlib');
var _ = require('lodash');

var configuration = {
    'iceServers': [{'url': config.stun}]
};

module.exports = {};

function writeLog(socket, msg) {
    if (socket.isAgent) {
        console.error(msg);
    } else {
        dbg.log0(msg);
    }
}

/********************************
 * connection to signaling server
 ********************************/

function keepalive(socket) {
    dbg.log0('send keepalive from '+socket.idInServer);
    try {
        socket.ws.send(JSON.stringify({sigType: 'keepalive'}));
    } catch (ex) {
        writeLog(socket, 'keepalive err '+ ex);
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
        writeLog(socket, 'failed disconnect ws '+ ex.stack);
    }
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
                    writeLog(socket, 'problem parsing msg '+msgRec);
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
                writeLog(socket, 'cant find msg '+msgRec);
            }

            if (message.sigType === 'id') {
                if (socket.isAgent) {
                    dbg.log3('id '+ message.id+' from server ignored, i am '+socket.idInServer);
                } else {
                    dbg.log3('id ' + message.id);
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
                    dbg.log3('Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                    signalingMessageCallback(socket, message.from, message.data, message.requestId);
                }
            } else if (message.sigType === 'accept') {
                dbg.log3('Got accept ' + message + ' from '+message.from+' to '+message.to+' i am '+socket.idInServer);
                initiateIce(socket.p2p_context ,socket, message.from, false, message.requestId);
            } else if (message.sigType === 'keepalive') {
                dbg.log3('Got keepalive from ' + message.from);
            } else if (message.sigType && message.requestId) {
                dbg.log3('Got ' + message.sigType + ' from web server '+message.from+' to '+message.to+' i am '+socket.idInServer);
                if (socket.action_defer && socket.action_defer[message.requestId]) {
                    socket.action_defer[message.requestId].resolve(message);
                    delete socket.action_defer[message.requestId];
                } else {
                    socket.handleRequestMethod(ws, message);
                }
            } else {
                writeLog(socket, 'unknown sig message ' + require('util').inspect(message));
                try {
                    writeLog(socket, 'unknown sig message 2 ' + JSON.stringify(message));
                } catch (ex) {
                    writeLog(socket, 'unknown sig message 3 ' + message);
                }
            }
        };

        ws.onerror = function (err) {
            writeLog(socket, 'on error ws ' + err+' ; '+err.stack);

            if (socket.conn_defer) {
                socket.conn_defer.reject();
            }

            if (socket.action_defer) {
                socket.action_defer.reject();
            }

            setTimeout(
                function () {
                    reconnect(socket);
                }, config.reconnect_delay);
            };

        ws.onclose = function () {
            writeLog(socket, 'onclose ws');
            if (socket.isAgent) {
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, config.reconnect_delay);
            }
        };

        socket.ws = ws;
    } catch (ex) {
        writeLog(socket, 'ice_lib.connect ERROR '+ ex+' ; ' + ex.stack);
    }

    return socket;
};

function reconnect(socket) {
    disconnect(socket);
    connect(socket);
}

var sendMessage = function sendMessage(socket, peerId, requestId, message) {
    dbg.log0('Client sending message: '+ message);

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
                console.error('sending ice msg gzip error '+err);
            }
            toSend.data = result;
            socket.ws.send(JSON.stringify(toSend));
        });
    } else {
        toSend.data = message;
        socket.ws.send(JSON.stringify(toSend));
    }
};
module.exports.sendWSMessage = sendMessage;

/********************************
 * handle stale connections
 ********************************/
function staleConnChk(socket) {

    var now = (new Date()).getTime();
    var toDel = [];
    var iceObjChk, iceToDel;
    try {
        for (iceObjChk in socket.icemap) {
            //dbg.log0('chk connections to peer ' + socket.icemap[iceObjChk].peerId + ' from ' + socket.icemap[iceObjChk].created.getTime());
            if (now - socket.icemap[iceObjChk].created.getTime() > config.connection_data_stale && socket.icemap[iceObjChk].done) {
                toDel.push(iceObjChk);
            }
        }

        for (iceToDel in toDel) {
            dbg.log0('remove stale connections to peer ' + socket.icemap[toDel[iceToDel]].peerId);
            delete socket.icemap[toDel[iceToDel]];
        }
    } catch (ex) {
        console.error('Error on staleConnChk of icemap ex '+ex+' ; '+ex.stack);
    }

    try {
        if (socket.p2p_context && socket.p2p_context.iceSockets) {
            now = (new Date()).getTime();
            toDel = [];

            for (iceObjChk in socket.p2p_context.iceSockets) {
                if (now - socket.p2p_context.iceSockets[iceObjChk].lastUsed > config.connection_data_stale &&
                    (_.isEmpty(socket.p2p_context.iceSockets[iceObjChk].usedBy))) {
                    toDel.push(iceObjChk);
                }
            }

            for (iceToDel in toDel) {
                dbg.log0('remove stale ice connections to peer ' + toDel[iceToDel]);
                socket.p2p_context.iceSockets[toDel[iceToDel]].dataChannel.close();
                delete socket.p2p_context.iceSockets[toDel[iceToDel]];
            }
        }
    } catch (ex) {
        console.error('Error on staleConnChk of p2p_context iceSockets ex '+ex+' ; '+ex.stack);
    }
}

/* /////////////////////////////////////////// */
/* ICE */
/* /////////////////////////////////////////// */
var initiateIce = function initiateIce(p2p_context, socket, peerId, isInitiator, requestId) {

    try {
        socket.icemap[requestId] = {
            peerId: peerId,
            isInitiator: isInitiator,
            requestId: requestId,
            created: new Date()
        };

        socket.p2p_context = p2p_context;
        if (p2p_context && !p2p_context.iceSockets) {
            p2p_context.iceSockets = {};
        }

        var channelObj = socket.icemap[requestId];

        if (isInitiator) {
            channelObj.connect_defer = Q.defer();
            if (!p2p_context || !p2p_context.iceSockets[peerId]) {
                dbg.log3('send accept to peer ' + peerId+ ' with req '+requestId+ ' from '+socket.idInServer);
                socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
                createPeerConnection(socket, requestId, configuration);
            } else {
                channelObj.peerConn = p2p_context.iceSockets[peerId].peerConn;
                channelObj.dataChannel = p2p_context.iceSockets[peerId].dataChannel;
                channelObj.connect_defer.resolve(channelObj.dataChannel);

                p2p_context.iceSockets[peerId].lastUsed = (new Date()).getTime();
                p2p_context.iceSockets[channelObj.peerId].usedBy[requestId] = 1;
            }
            return channelObj.connect_defer.promise;
        }

        // not isInitiator
        createPeerConnection(socket, requestId, configuration);
    } catch (ex) {
        console.error('Error on initiateIce '+(isInitiator ? 'to' : 'for')+' peer '+peerId+' ex '+ex+' ; '+ex.stack);
        throw ex;
    }

};
module.exports.initiateIce = initiateIce;

var closeIce = function closeIce(socket, requestId, dataChannel) {

    try {
        delete dataChannel.msgs[requestId];

        var channelObj = socket.icemap[requestId];
        channelObj.done = true;
        var obj = socket.p2p_context ? socket.p2p_context.iceSockets[channelObj.peerId] : null;

        if (obj && obj.dataChannel === dataChannel) {
            obj.lastUsed = (new Date()).getTime();
            delete socket.p2p_context.iceSockets[channelObj.peerId].usedBy[requestId];
        } else if (dataChannel) {
            dataChannel.close();
        }
    } catch (ex) {
       console.error('Error on close ice socket for request '+requestId+' ex '+ex);
    }
};
module.exports.closeIce = closeIce;

function logError(err) {
    console.error('logError called: '+ err);
}

function onLocalSessionCreated(socket, requestId, desc) {
    dbg.log3('local session created:'+ desc);
    var channelObj = socket.icemap[requestId];

    if (!channelObj || channelObj.done) {
        dbg.log0('PROBLEM onLocalSessionCreated no channel or already done !!!');
        return;
    }

    try {
        channelObj.peerConn.setLocalDescription(desc, function () {
            dbg.log3('sending local desc:' + channelObj.peerConn.localDescription);
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        writeLog(socket, 'Ex on local session ' + ex);
        if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
    }
}

function createPeerConnection(socket, requestId, config) {
    var channelObj = socket.icemap[requestId];
    if (!channelObj || channelObj.done) {
        dbg.log0('PROBLEM Creating Peer connection no channel or already done !!!');
        return;
    }

    try {
        dbg.log3('Creating Peer connection as initiator ' + channelObj.isInitiator + ' config: ' + config);

        var FuncPerrConn = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

        try {
            channelObj.peerConn = new FuncPerrConn(config);
        } catch (ex) {
            writeLog(socket, 'prob win create '+ex.stack);
        }

        // send any ice candidates to the other peer
        channelObj.peerConn.onicecandidate = function (event) {
            if (event.candidate) {

                dbg.log3(channelObj.peerId+' onIceCandidate event: '+
                    require('util').inspect(event.candidate.candidate) +
                    ' state is '+(event.target ? event.target.iceGatheringState : 'N/A'));


                sendMessage(socket, channelObj.peerId, channelObj.requestId, JSON.stringify({
                    type: 'candidate',
                    label: event.candidate.sdpMLineIndex,
                    id: event.candidate.sdpMid,
                    candidate: event.candidate.candidate
                }));
            } else {
                dbg.log3(channelObj.peerId+' End of candidates. state is '+(event.target ? event.target.iceGatheringState : 'N/A'));
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
            if (evt.target && evt.target.iceConnectionState === 'failed') {
                dbg.log0(channelObj.peerId+" NOTICE ICE connection state change: " + evt.target.iceConnectionState);
            }
        };

        if (channelObj.isInitiator) {
            dbg.log3('Creating Data Channel');
            try {
                //var dtConfig = {ordered: true, reliable: true, maxRetransmits: 5};
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa"); // TODO  ? dtConfig
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeLog(socket, 'Ex on Creating Data Channel ' + ex);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
            }

            dbg.log3('Creating an offer');
            /*var mediaConstraints = {
                mandatory: {
                    OfferToReceiveAudio: false,
                    OfferToReceiveVideo: false
                }
            };*/
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    return onLocalSessionCreated(socket, requestId, desc);
                }, logError); // TODO ? mediaConstraints
            } catch (ex) {
                writeLog(socket, 'Ex on Creating an offer ' + ex.stack);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
            }
        }

        channelObj.peerConn.ondatachannel = function (event) {
            dbg.log3('ondatachannel:'+ event.channel);
            try {
                channelObj.dataChannel = event.channel;
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeLog(socket, 'Ex on ondatachannel ' + ex.stack);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
            }
        };
    } catch (ex) {
        writeLog(socket, 'Ex on createPeerConnection ' + ex.stack);
        if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
    }
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelObj = socket.icemap[requestId];
    if (!channelObj || channelObj.done) {
        dbg.log0('problem NO channelObj or already done for req '+requestId+' and peer '+peerId);
        return;
    }

    var Desc = RTCSessionDescription;
    var Candidate = RTCIceCandidate;

    if (message.type === 'offer') {
        dbg.log3('Got offer. Sending answer to peer. ' + peerId + ' and channel ' + requestId);

        try {
            channelObj.peerConn.setRemoteDescription(new Desc(message), function () {
                dbg.log3('remote desc set for peer '+peerId);
            }, logError);
            channelObj.peerConn.createAnswer(function (desc) {
                return onLocalSessionCreated(socket, requestId, desc);
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in offer ' + ex.stack);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
        }

    } else if (message.type === 'answer') {
        try {
            dbg.log3('Got answer.' + peerId + ' and channel ' + requestId);
            channelObj.peerConn.setRemoteDescription(new Desc(message), function () {
                dbg.log3('remote desc set for peer '+peerId);
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in answer ' + ex);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
        }

    } else if (message.type === 'candidate') {
        try {
            dbg.log3('Got candidate.' + peerId + ' and channel ' + requestId);
            if (channelObj && !channelObj.done) {
                channelObj.peerConn.addIceCandidate(new Candidate({candidate: message.candidate}));
            } else {
                dbg.log0('Got candidate.' + peerId + ' and channel ' + requestId + ' CANNOT HANDLE connection removed/done');
            }
        } catch (ex) {
            writeLog(socket, 'problem in candidate fro req '+ requestId +' ex:' + ex+ ', msg was: '+message.candidate);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
        }
    } else if (message === 'bye') {
        dbg.log0('Got bye.');
    }
}

function onIceMessage(socket, channel) {
    return function onmessage(event) {
        return channel.callbackOnPeerMsg(socket.p2p_context, channel, event);
    };
}

function onDataChannelCreated(socket, requestId, channel) {

    try {
        dbg.log3('onDataChannelCreated:'+ channel);

        channel.onopen = function () {

            var channelObj = socket.icemap[requestId];
            channel.msgs = {};

            if (socket.p2p_context) {

                if (socket.p2p_context && !socket.p2p_context.iceSockets) {
                    socket.p2p_context.iceSockets = {};
                }

                socket.p2p_context.iceSockets[channelObj.peerId] = {
                    peerConn: channelObj.peerConn,
                    dataChannel : channelObj.dataChannel,
                    lastUsed: (new Date()).getTime(),
                    usedBy: {}
                };
                socket.p2p_context.iceSockets[channelObj.peerId].usedBy[requestId] = 1;
            }

            dbg.log0('ICE CHANNEL opened ' + channelObj.peerId+' i am '+socket.idInServer + ' for request '+requestId);

            channel.peerId = channelObj.peerId;
            channel.myId = socket.idInServer;
            channel.callbackOnPeerMsg = socket.callbackOnPeerMsg;
            channel.handleRequestMethod = socket.handleRequestMethod;

            if (channelObj.connect_defer) {
                dbg.log3('connect defer - resolve');
                channelObj.connect_defer.resolve(channelObj.dataChannel);
            } else {
                dbg.log3('no connect defer');
            }
        };

        channel.onmessage = onIceMessage(socket, channel);

        channel.onclose = function () {
            dbg.log0('ICE CHANNEL closed ' + channel.peerId);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            socket.icemap[requestId].done = true;

            if (socket.p2p_context && socket.p2p_context.iceSockets[channel.peerId]) {
                delete socket.p2p_context.iceSockets[channel.peerId];
            }
        };

        channel.onerror = function (err) {
            writeLog(socket, 'CHANNEL ERR ' + channel.peerId + ' ' + err);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            socket.icemap[requestId].done = true;

            if (socket.p2p_context && socket.p2p_context.iceSockets[channel.peerId]) {
                delete socket.p2p_context.iceSockets[channel.peerId].usedBy[requestId];
            }
        };

    } catch (ex) {
        writeLog(socket, 'Ex on onDataChannelCreated ' + ex);

        if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
            socket.icemap[requestId].connect_defer.reject();
        }
    }
}

module.exports.isRequestAlive = function isRequestAlive(p2p_context, peerId, requestId) {
    if (requestId && p2p_context && p2p_context.iceSockets && p2p_context.iceSockets[peerId]
        && p2p_context.iceSockets[peerId].lastUsed
        && ((new Date()).getTime() -  p2p_context.iceSockets[peerId].lastUsed > config.connection_default_timeout)
        && !p2p_context.iceSockets[peerId].usedBy[requestId]) {
        return false;
    }
    return true;
};

module.exports.closeSignaling = function closeSignaling(socket) {
    if (!socket.isAgent) {
        try {
            disconnect(socket);
            clearInterval(socket.stale_conn_interval);
            socket.stale_conn_interval = null;
        } catch (err) {
            writeLog(socket, 'Ex on closeSignaling ' + err);
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
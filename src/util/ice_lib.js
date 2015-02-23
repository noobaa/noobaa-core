var WebSocket = require('ws');
var Q = require('q');
var rand = require('./random_utils');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');
var zlib = require('zlib');

var configuration = {
    'iceServers': [{'url': config.stun}]
};

var exports = module.exports = {};

/********************************
 * connection to signaling server
 ********************************/
var connect = function (socket) {
    dbg.log0('do CLIENT connect is agent: ' + socket.isAgent + " current id: " + socket.idInServer);

    if (!socket.isAgent) {
        socket.conn_defer = Q.defer();
    }

    try {
        var ws = new WebSocket(config.address);

        ws.onopen = (function () {


            if (socket.isAgent) {
                ws.send(JSON.stringify({sigType: 'id', id: socket.idInServer}));
            }

            socket.alive_interval = setInterval(function () {
                keepalive(socket);
            }, config.alive_delay);

            });

        ws.onmessage = (function (msgRec) {

            //dbg.log0('#### got msg '+require('util').inspect(msgRec));

            if (typeof msgRec == 'string' || msgRec instanceof String) {
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
                if (typeof msgRec.data == 'string' || msgRec.data instanceof String) {
                    message = JSON.parse(msgRec.data);
                } else {
                    message = msgRec.data;
                }
            } else {
                writeLog(socket, 'cant find msg '+msgRec);
            }

            if (message.sigType === 'id') {
                if (socket.isAgent) {
                    dbg.log0('id '+ message.id+' from server ignored, i am '+socket.idInServer);
                } else {
                    dbg.log0('id ' + message.id);
                    socket.idInServer = message.id;
                    if (socket.conn_defer) {
                        socket.conn_defer.resolve();
                    }
                }
            } else if (message.sigType === 'ice') {
                if (typeof message.data == 'string' || message.data instanceof String) {
                    var buf = new Buffer(message.data, 'binary');
                    zlib.gunzip(buf, function (err, msgData) {
                        msgData = JSON.parse(msgData);
                        dbg.log0('Got ice from ' + message.from + ' to ' + message.to + ' data ' + msgData + (err ? ' gzip error '+err : '')+' i am '+socket.idInServer);
                        signalingMessageCallback(socket, message.from, msgData, message.requestId);
                    });
                } else {
                    dbg.log0('Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                    signalingMessageCallback(socket, message.from, message.data, message.requestId);
                }
            } else if (message.sigType === 'accept') {
                dbg.log0('Got accept ' + message + ' from '+message.from+' to '+message.to+' i am '+socket.idInServer);
                initiateIce(socket, message.from, false, message.requestId);
            } else if (message.sigType === 'keepalive') {
                // nothing
            } else {
                writeLog(socket, 'unknown sig message ' + require('util').inspect(message));
                try {
                    writeLog(socket, 'unknown sig message 2 ' + JSON.stringify(message));
                } catch (ex) {
                    writeLog(socket, 'unknown sig message 3 ' + message);
                }
            }
        });

        ws.onerror = (function (err) {
            writeLog(socket, 'error ' + err);
            setTimeout(
                function () {
                    reconnect(socket);
                }, config.reconnect_delay);
            });

        ws.onclose = (function () {
            writeLog(socket, 'close');
            if (socket.isAgent) {
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, config.reconnect_delay);
            }
        });

        socket.ws = ws;
    } catch (ex) {
        writeLog(socket, 'ice_lib.connect ERROR '+ ex+' ; ' + ex.stack);
    }

    return socket;
};

function keepalive(socket) {
    dbg.log0('send keepalive from '+socket.idInServer);
    try {
        socket.ws.send(JSON.stringify({sigType: 'keepalive'}));
    } catch (ex) {
        writeLog(socket, 'keepalive err', ex);
    }
}

function reconnect(socket) {
    disconnect(socket);
    connect(socket);
}

function disconnect(socket) {
    dbg.log0('called disconnect ws');
    if (!socket.ws) return;
    dbg.log0('called disconnect ws - clear interval and close');
    try {
        ws.close();
    } catch (err) {
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

function sendMessage(socket, peerId, requestId, message) {
    dbg.log0('Client sending message: '+ message);

    var toSend = {
        sigType: 'ice',
        from: socket.idInServer,
        to: peerId,
        requestId: requestId
    };

    if (typeof message == 'string' || message instanceof String) {
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
}

/********************************
 * handle stale connections
 ********************************/
function staleConnChk(socket) {
    var now = (new Date()).getTime();
    var toDel = [];
    for (var iceObjChk in socket.icemap) {
        dbg.log0('chk connections to peer ' + socket.icemap[iceObjChk].peerId + ' from ' + socket.icemap[iceObjChk].created.getTime());
        if (now - socket.icemap[iceObjChk].created.getTime() > config.connection_data_stale || socket.icemap[iceObjChk].done) {
            toDel.push(iceObjChk);
        }
    }

    for (var iceToDel in toDel) {
        dbg.log0('remove stale connections to peer ' + socket.icemap[toDel[iceToDel]].peerId);
        delete socket.icemap[toDel[iceToDel]];
    }
}

/* /////////////////////////////////////////// */
/* ICE */
/* /////////////////////////////////////////// */
var initiateIce = function initiateIce(socket, peerId, isInitiator, requestId) {

    socket.icemap[requestId] = {
        "peerId": peerId,
        "isInitiator": isInitiator,
        "requestId": requestId,
        "created": new Date()
    };

    var channelObj = socket.icemap[requestId];

    if (isInitiator) {
        dbg.log0('send accept to peer ' + peerId+ ' with req '+requestId+ ' from '+socket.idInServer);
        socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
        createPeerConnection(socket, requestId, configuration);
        channelObj.connect_defer = Q.defer();
        return channelObj.connect_defer.promise;
    } else {
        createPeerConnection(socket, requestId, configuration);
    }
};

function logError(err) {
    console.error(err.toString(), err);
}

function writeLog(socket, msg) {
    if (socket.isAgent) {
        console.error(msg);
    } else {
        console.log(msg);
    }
}

function createPeerConnection(socket, requestId, config) {
    var channelObj = socket.icemap[requestId];
    if (!channelObj) {
        dbg.log0('PROBLEM Creating Peer connection no channel !!!ß');
    }

    try {
        dbg.log0('Creating Peer connection as initiator ' + channelObj.isInitiator + ' config: ' + config);

        var funcPerrConn = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

        try {
            channelObj.peerConn = new funcPerrConn(config);
        } catch (ex) {
            writeLog(socket, 'prob win create '+ex.stack);
        }

        // send any ice candidates to the other peer
        channelObj.peerConn.onicecandidate = function (event) {
            if (event.candidate) {
                dbg.log0(channelObj.peerId+' onIceCandidate event: '+
                    require('util').inspect(event.candidate.candidate) +
                    ' state is '+event.target.iceGatheringState);
                sendMessage(socket, channelObj.peerId, channelObj.requestId, JSON.stringify({
                    type: 'candidate',
                    label: event.candidate.sdpMLineIndex,
                    id: event.candidate.sdpMid,
                    candidate: event.candidate.candidate
                }));
            } else {
                dbg.log0(channelObj.peerId+' End of candidates. state is '+event.target.iceGatheringState);
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
            if (evt.target.iceConnectionState === 'failed') {
                dbg.log0(channelObj.peerId+" NOTICE ICE connection state change: " + evt.target.iceConnectionState);
            }
        };

        if (channelObj.isInitiator) {
            dbg.log0('Creating Data Channel');
            try {
                var dtConfig = {ordered: true, reliable: true, maxRetransmits: 5};
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa"); // TODO  ? dtConfig
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeLog(socket, 'Ex on Creating Data Channel ' + ex);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }

            dbg.log0('Creating an offer');
            var mediaConstraints = {
                mandatory: {
                    OfferToReceiveAudio: false,
                    OfferToReceiveVideo: false
                }
            };
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    return onLocalSessionCreated(socket, requestId, desc);
                }, logError); // TODO ? mediaConstraints
            } catch (ex) {
                writeLog(socket, 'Ex on Creating an offer ' + ex.stack);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }
        }

        channelObj.peerConn.ondatachannel = function (event) {
            dbg.log0('ondatachannel:'+ event.channel);
            try {
                channelObj.dataChannel = event.channel;
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeLog(socket, 'Ex on ondatachannel ' + ex.stack);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }
        };
    } catch (ex) {
        writeLog(socket, 'Ex on createPeerConnection ' + ex.stack);
        if (channelObj.connect_defer) channelObj.connect_defer.reject();
    }
}

function onLocalSessionCreated(socket, requestId, desc) {
    dbg.log0('local session created:'+ desc);
    var channelObj = socket.icemap[requestId];
    try {
        channelObj.peerConn.setLocalDescription(desc, function () {
            dbg.log0('sending local desc:' + channelObj.peerConn.localDescription);
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        writeLog(socket, 'Ex on local session ' + ex);
        if (channelObj.connect_defer) channelObj.connect_defer.reject();
    }
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelObj = socket.icemap[requestId];
    if (!channelObj) {
        //dbg.log0('problem NO channelObj for req '+requestId+' and peer '+peerId);
    }

    if (message.type === 'offer') {
        dbg.log0('Got offer. Sending answer to peer. ' + peerId + ' and channel ' + requestId);

        try {
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
            channelObj.peerConn.createAnswer(function (desc) {
                return onLocalSessionCreated(socket, requestId, desc);
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in offer ' + ex.stack);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'answer') {
        try {
            dbg.log0('Got answer.' + peerId + ' and channel ' + requestId);
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in answer ' + ex);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'candidate') {
        try {
            dbg.log0('Got candidate.' + peerId + ' and channel ' + requestId);
            if (channelObj && !channelObj.done) {
                channelObj.peerConn.addIceCandidate(new RTCIceCandidate({candidate: message.candidate}));
            } else {
                dbg.log0('Got candidate.' + peerId + ' and channel ' + requestId + ' CANNOT HANDLE connection removed/done');
            }
        } catch (ex) {
            writeLog(socket, 'problem in candidate fro req '+ requestId +' ex:' + ex+ ', msg was: '+message.candidate);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }
    } else if (message === 'bye') {
        dbg.log0('Got bye.');
    }
}

function onDataChannelCreated(socket, requestId, channel) {

    try {
        dbg.log0('onDataChannelCreated:'+ channel);

        channel.onopen = function () {

            var channelObj = socket.icemap[requestId];

            dbg.log0('ICE CHANNEL opened ' + channelObj.peerId+' i am '+socket.idInServer + ' for request '+requestId);

            channel.peerId = channelObj.peerId;
            channel.myId = socket.idInServer;
            channel.callbackOnPeerMsg = socket.callbackOnPeerMsg;
            channel.handleRequestMethod = socket.handleRequestMethod;

            if (channelObj.connect_defer) {
                dbg.log0('connect defer - resolve');
                channelObj.connect_defer.resolve(channelObj.dataChannel);
            } else {
                dbg.log0('no connect defer');
            }
        };

        channel.onmessage = onIceMessage(channel);

        channel.onclose = function () {
            dbg.log0('ICE CHANNEL closed ' + channel.peerId);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            socket.icemap[requestId].done = true;
        };

        channel.onerror = function (err) {
            writeLog(socket, 'CHANNEL ERR ' + channel.peerId + ' ' + err);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            socket.icemap[requestId].done = true;
        };

    } catch (ex) {
        writeLog(socket, 'Ex on onDataChannelCreated ' + ex);

        if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
            socket.icemap[requestId].connect_defer.reject();
        }
    }
}

function onIceMessage(channel) {
    return function onmessage(event) {
        return channel.callbackOnPeerMsg(channel, event);
    }
}

exports.closeSignaling = function closeSignaling(socket) {
    if (!socket.isAgent) {
        try {
            disconnect(socket);
            clearInterval(socket.stale_conn_interval);
            socket.stale_conn_interval = null;
        } catch (err) {
            writeLog(socket, 'Ex on closeSignaling ' + ex);
        }
    }
};

exports.setup = function setup(msgCallback, agentId, handleRequestMethod) {

    var socket = {
        idInServer: agentId,
        isAgent: agentId ? true : false,
        icemap: {},
        callbackOnPeerMsg: msgCallback
    };

    socket.stale_conn_interval = setInterval(function(){staleConnChk(socket);}, config.check_stale_conns);
    socket.handleRequestMethod = handleRequestMethod;

    return connect(socket);

};

exports.initiateIce = initiateIce;
var WebSocket = require('ws');
var Q = require('q');
var rand = require('./random_utils');

var configuration = {
    'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]
};

var exports = module.exports = {};

var params = {
    address: 'ws://127.0.0.1:5000', // wss://noobaa-signaling.herokuapp.com  ws://127.0.0.1:5000
    alive_delay: 10000,
    reconnect_delay: 5 * 1000,
    connection_data_stale: 5 * 60 * 1000,
    check_stale_conns: 5 * 60 * 1000
};

var callbackOnPeerMsg;

function Socket(idInServer) {
    var self = this;
    self.idInServer = idInServer;
    self.isAgent = idInServer ? true : false;
    self.icemap = {};
}

/********************************
 * connection to signaling server
 ********************************/
var connect = function (socket) {
    writeLog(socket, 'do CLIENT connect is agent: ' + socket.isAgent + " current id: " + socket.idInServer);

    if (!socket.isAgent) {
        socket.conn_defer = Q.defer();
    }

    try {
        var ws = new WebSocket(params.address);

        ws.onopen = (function () {


            if (socket.isAgent) {
                ws.send(JSON.stringify({sigType: 'id', id: socket.idInServer}));
            }

            socket.alive_interval = setInterval(function () {
                keepalive(socket);
            }, params.alive_delay);

            });

        ws.onmessage = (function (msgRec) {

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
                    writeLog(socket, 'id from server ignored');
                } else {
                    writeLog(socket, 'id ' + message.id);
                    socket.idInServer = message.id;
                    if (socket.conn_defer) {
                        socket.conn_defer.resolve();
                    }
                }
            } else if (message.sigType === 'ice') {
                writeLog(socket, 'Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                signalingMessageCallback(socket, message.from, message.data, message.requestId);
            } else if (message.sigType === 'accept') {
                writeLog(socket, 'Got accept ' + message);
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
                }, params.reconnect_delay);
            });

        ws.onclose = (function () {
            writeLog(socket, 'close');
            if (socket.isAgent) {
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, params.reconnect_delay);
            }
        });

        socket.ws = ws;
    } catch (ex) {
        writeLog(socket, 'ice_lib.connect ERROR '+ ex+' ; ' + ex.stack);
    }

    return socket;
};

function keepalive(socket) {
    writeLog(socket, 'send keepalive from '+socket.idInServer);
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
    writeLog(socket, 'called disconnect ws');
    if (!socket.ws) return;
    writeLog(socket, 'called disconnect ws - clear interval and close');
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
    writeLog(socket, 'Client sending message: '+ message);
    socket.ws.send(JSON.stringify({
        sigType: 'ice',
        from: socket.idInServer,
        to: peerId,
        requestId: requestId,
        data: message
    }));
}

/********************************
 * handle stale connections
 ********************************/
function staleConnChk(socket) {
    writeLog(socket, 'looking for stale ice connections to remove');
    var now = (new Date()).getTime();
    var toDel = [];
    for (var iceObjChk in socket.icemap) {
        writeLog(socket, 'chk connections to peer ' + socket.icemap[iceObjChk].peerId + ' from ' + socket.icemap[iceObjChk].created.getTime());
        if (now - socket.icemap[iceObjChk].created.getTime() > params.connection_data_stale) {
            toDel.push(iceObjChk);
        }
    }

    for (var iceToDel in toDel) {
        writeLog(socket, 'remove stale connections to peer ' + socket.icemap[toDel[iceToDel]].peerId);
        delete socket.icemap[toDel[iceToDel]];
    }
}

/* /////////////////////////////////////////// */
/* ICE */
/* /////////////////////////////////////////// */
var initiateIce = function initiateIce(socket, peerId, isInitiator, requestId) {

    var channelId = rand.getRandomInt(10000, 90000);

    socket.icemap[channelId] = {
        "channelId": channelId,
        "peerId": peerId,
        "isInitiator": isInitiator,
        "requestId": requestId,
        "created": new Date()
    };

    if (isInitiator) {
        writeLog(socket, 'send accept to peer ' + peerId);
        socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
    }

    createPeerConnection(socket, channelId, configuration);

    if (isInitiator) {
        socket.icemap[channelId].connect_defer = Q.defer();
        return socket.icemap[channelId].connect_defer.promise;
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

function createPeerConnection(socket, channelId, config) {
    var channelObj = socket.icemap[channelId];

    try {
        writeLog(socket, 'Creating Peer connection as initiator ' + channelObj.isInitiator + ' config: ' + config);

        var funcPerrConn = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

        try {
            channelObj.peerConn = new funcPerrConn(config);
        } catch (ex) {
            writeLog(socket, 'prob win create '+ex.stack);
        }

        // send any ice candidates to the other peer
        channelObj.peerConn.onicecandidate = function (event) {
            writeLog(socket, 'onIceCandidate event:'+ event);
            if (event.candidate) {
                sendMessage(socket, channelObj.peerId, channelObj.requestId, {
                    type: 'candidate',
                    label: event.candidate.sdpMLineIndex,
                    id: event.candidate.sdpMid,
                    candidate: event.candidate.candidate
                });
            } else {
                writeLog(socket, 'End of candidates.');
            }
        };

        if (channelObj.isInitiator) {
            writeLog(socket, 'Creating Data Channel');
            try {
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa");
                onDataChannelCreated(socket, channelId, channelObj.dataChannel);
            } catch (ex) {
                writeLog(socket, 'Ex on Creating Data Channel ' + ex);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }

            writeLog(socket, 'Creating an offer');
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    return onLocalSessionCreated(socket, channelId, desc);
                }, logError);
            } catch (ex) {
                writeLog(socket, 'Ex on Creating an offer ' + ex.stack);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }
        }



        channelObj.peerConn.ondatachannel = function (event) {
            writeLog(socket, 'ondatachannel:'+ event.channel);
            try {
                channelObj.dataChannel = event.channel;
                onDataChannelCreated(socket, channelId, channelObj.dataChannel);
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

function onLocalSessionCreated(socket, channelId, desc) {
    writeLog(socket, 'local session created:'+ desc);
    var channelObj = socket.icemap[channelId];
    try {
        channelObj.peerConn.setLocalDescription(desc, function () {
            writeLog(socket, 'sending local desc:'+ channelObj.peerConn.localDescription);
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        writeLog(socket, 'Ex on local session ' + ex);
        if (channelObj.connect_defer) channelObj.connect_defer.reject();
    }
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelId;
    for (var iceObj in socket.icemap) {
        if (socket.icemap[iceObj].peerId === peerId && socket.icemap[iceObj].requestId === requestId) {
            channelId = iceObj;
            break;
        }
    }
    var channelObj = socket.icemap[channelId];

    if (message.type === 'offer') {
        writeLog(socket, 'Got offer. Sending answer to peer. ' + peerId + ' and channel ' + channelId);

        try {
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, channelId, configuration);
            }
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
            channelObj.peerConn.createAnswer(function (desc) {
                return onLocalSessionCreated(socket, channelId, desc);
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in offer ' + ex.stack);
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'answer') {
        try {
            writeLog(socket, 'Got answer.' + peerId + ' and channel ' + channelId);
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, channelId, configuration);
            }
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in answer ' + ex);
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'candidate') {
        try {
            writeLog(socket, 'Got candidate.' + peerId + ' and channel ' + channelId);
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, channelId, configuration);
            }
            channelObj.peerConn.addIceCandidate(new RTCIceCandidate({candidate: message.candidate}));
        } catch (ex) {
            writeLog(socket, 'problem in candidate ' + ex);
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }
    } else if (message === 'bye') {
        writeLog(socket, 'Got bye.');
    }
}

function onDataChannelCreated(socket, channelId, channel) {

    try {
        writeLog(socket, 'onDataChannelCreated:'+ channel);

        channel.onopen = function () {

            var channelObj = socket.icemap[channelId];

            writeLog(socket, 'CHANNEL opened!!! ' + channelObj.peerId);

            channel.peerId = channelObj.peerId;
            channel.myId = socket.idInServer;

            if (channelObj.connect_defer) {
                writeLog(socket, 'connect defer - resolve');
                channelObj.connect_defer.resolve(channelObj.dataChannel);
            } else {
                writeLog(socket, 'no connect defer');
            }
            delete socket.icemap[channelId];
        };

        channel.onmessage = onIceMessage(channel);

        channel.onclose = function () {
            writeLog(socket, 'CHANNEL closed!!! ' + channel.peerId);
            if (socket.icemap[channelId] && socket.icemap[channelId].connect_defer) {
                socket.icemap[channelId].connect_defer.reject();
            }
            delete socket.icemap[channelId];
        };

        channel.onerror = function (err) {
            writeLog(socket, 'CHANNEL ERR ' + channel.peerId + ' ' + err);
            if (socket.icemap[channelId] && socket.icemap[channelId].connect_defer) {
                socket.icemap[channelId].connect_defer.reject();
            }
            delete socket.icemap[channelId];
        };

    } catch (ex) {
        writeLog(socket, 'Ex on onDataChannelCreated ' + ex);

        if (socket.icemap[channelId] && socket.icemap[channelId].connect_defer) {
            socket.icemap[channelId].connect_defer.reject();
        }
    }
}

function onIceMessage(channel) {
    return function onmessage(event) {
        return callbackOnPeerMsg(channel, event);
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

exports.setup = function setup(msgCallback, agentId) {

    var socket = new Socket(agentId);

    callbackOnPeerMsg = msgCallback;

    socket.stale_conn_interval = setInterval(function(){staleConnChk(socket);}, params.check_stale_conns);

    return connect(socket);

};

exports.initiateIce = initiateIce;
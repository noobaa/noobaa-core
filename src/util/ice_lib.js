var WebSocket = require('ws');
var Q = require('q');
var rand = require('./random_utils');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');

var configuration = {
    'iceServers': [{'url': config.stun}]
};

var exports = module.exports = {};

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
                    dbg.log0('id from server ignored');
                } else {
                    dbg.log0('id ' + message.id);
                    socket.idInServer = message.id;
                    if (socket.conn_defer) {
                        socket.conn_defer.resolve();
                    }
                }
            } else if (message.sigType === 'ice') {
                dbg.log0('Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                signalingMessageCallback(socket, message.from, message.data, message.requestId);
            } else if (message.sigType === 'accept') {
                dbg.log0('Got accept ' + message);
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
    var now = (new Date()).getTime();
    var toDel = [];
    for (var iceObjChk in socket.icemap) {
        dbg.log0('chk connections to peer ' + socket.icemap[iceObjChk].peerId + ' from ' + socket.icemap[iceObjChk].created.getTime());
        if (now - socket.icemap[iceObjChk].created.getTime() > config.connection_data_stale) {
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

    var channelObj = getChannelObj(socket, peerId, requestId, isInitiator);

    if (isInitiator) {
        dbg.log0('send accept to peer ' + peerId);
        socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
    }

    createPeerConnection(socket, requestId, configuration);

    if (isInitiator) {
        channelObj.connect_defer = Q.defer();
        return channelObj.connect_defer.promise;
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
                dbg.log0('onIceCandidate event:'+ require('util').inspect(event.candidate.candidate));
                sendMessage(socket, channelObj.peerId, channelObj.requestId, {
                    type: 'candidate',
                    label: event.candidate.sdpMLineIndex,
                    id: event.candidate.sdpMid,
                    candidate: event.candidate.candidate
                });
            } else {
                dbg.log0('End of candidates.');
            }
        };

        /*channelObj.peerConn.oniceconnectionstatechange = function(evt) {
            // checking / connected / completed
            dbg.log0(channelObj.peerId+" ICE connection state change: " + evt.target.iceConnectionState);
        };*/

        if (channelObj.isInitiator) {
            dbg.log0('Creating Data Channel');
            try {
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa");
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeLog(socket, 'Ex on Creating Data Channel ' + ex);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }

            dbg.log0('Creating an offer');
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    return onLocalSessionCreated(socket, requestId, desc);
                }, logError);
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
            dbg.log0('sending local desc:'+ channelObj.peerConn.localDescription);
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        writeLog(socket, 'Ex on local session ' + ex);
        if (channelObj.connect_defer) channelObj.connect_defer.reject();
    }
}

function getChannelObj(socket, peerId, requestId, isInitiator) {
    if (!socket.icemap[requestId]) {

        if (!isInitiator) {
            console.error('#### in socket ' + socket.idInServer + ' cant find channel for peer ' + peerId + ' and req ' + requestId + ' in map -> create');
        }

        socket.icemap[requestId] = {
            "peerId": peerId,
            "isInitiator": (isInitiator ? isInitiator : false),
            "requestId": requestId,
            "created": new Date()
        };
    } else if (isInitiator) {
        socket.icemap[requestId].isInitiator = true;
    }
    return socket.icemap[requestId];
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelObj = getChannelObj(socket, peerId, requestId);

    if (message.type === 'offer') {
        dbg.log0('Got offer. Sending answer to peer. ' + peerId + ' and channel ' + requestId);

        try {
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, requestId, configuration);
            }
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
            channelObj.peerConn.createAnswer(function (desc) {
                return onLocalSessionCreated(socket, requestId, desc);
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in offer ' + ex.stack);
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'answer') {
        try {
            dbg.log0('Got answer.' + peerId + ' and channel ' + requestId);
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, requestId, configuration);
            }
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
        } catch (ex) {
            writeLog(socket, 'problem in answer ' + ex);
            if (channelObj && channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'candidate') {
        try {
            dbg.log0('Got candidate.' + peerId + ' and channel ' + requestId);
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, requestId, configuration);
            }
            channelObj.peerConn.addIceCandidate(new RTCIceCandidate({candidate: message.candidate}));
        } catch (ex) {
            writeLog(socket, 'problem in candidate ' + ex+ ', msg was: '+message.candidate);
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

            dbg.log0('ICE CHANNEL opened!!! ' + channelObj.peerId);

            channel.peerId = channelObj.peerId;
            channel.myId = socket.idInServer;

            if (channelObj.connect_defer) {
                dbg.log0('connect defer - resolve');
                channelObj.connect_defer.resolve(channelObj.dataChannel);
            } else {
                dbg.log0('no connect defer');
            }
            delete socket.icemap[requestId];
        };

        channel.onmessage = onIceMessage(channel);

        channel.onclose = function () {
            dbg.log0('ICE CHANNEL closed!!! ' + channel.peerId);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            delete socket.icemap[requestId];
        };

        channel.onerror = function (err) {
            writeLog(socket, 'CHANNEL ERR ' + channel.peerId + ' ' + err);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            delete socket.icemap[requestId];
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

    socket.stale_conn_interval = setInterval(function(){staleConnChk(socket);}, config.check_stale_conns);

    return connect(socket);

};

exports.initiateIce = initiateIce;
var WebSocket = require('ws');
var Q = require('q');
var rand = require('./random_utils');

var configuration = {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};

var exports = module.exports = {};

var params = {
    address: 'ws://127.0.0.1:5000', // wss://stormy-ravine-6974.herokuapp.com
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
var connect = function(socket) {
    console.log('do CLIENT connect ' + (socket.isAgent ? socket.idInServer : ""));

    socket.ws = new WebSocket(params.address)
        .on('connect', function () {
        })
        .on('open', function () {
            if (socket.isAgent) {
                socket.ws.send(JSON.stringify({type: 'id', id: socket.idInServer}));
            }

            try {
                socket.alive_interval = setInterval(keepalive(socket), params.alive_delay);
            } catch (ex) {
                console.error("prob vvvvvvv");
            }

        })
        .on('message', function (data) {

            var message = JSON.parse(data);

            if (message.type === 'id') {
                console.log('Got id ' + message);
                if (socket.isAgent) {
                    console.log('id from server ignored');
                } else {
                    console.log('id ' + message.id);
                    socket.idInServer = message.id;
                    if (socket.ws.conn_defer) {socket.ws.conn_defer.resolve();}
                }
            } else if (message.type === 'ice') {
                console.log('Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                signalingMessageCallback(socket, message.from, message.data, message.requestId);
            } else if (message.type === 'accept') {
                console.log('Got accept ' + message);
                initiateIce(socket, message.from, false, message.requestId);
            } else if (message.type === 'keepalive') {
                // nothing
            } else {
                console.log('message ' + data);
            }
        })
        .on('error', function (err) {
            console.log('error ' + err);
            try {setTimeout(reconnect(socket), params.reconnect_delay);} catch (ex) {console.error("prob bbbbbbbb");}
        })
        .on('close', function () {
            console.log('close');
            disconnect(socket);
            try {setTimeout(connect(socket), params.reconnect_delay);} catch (ex) {console.error("prob nnnnnnnn");}
        });

    if (!socket.isAgent) {
        socket.ws.conn_defer = Q.defer();
    }
    return socket;
};

function keepalive(socket) {
    //console.error('send keepalive');
    try{socket.ws.send(JSON.stringify({type: 'keepalive'}));} catch (ex) {console.error('keepalive err', ex);}
}

function reconnect(socket) {
    disconnect(socket);
    connect(socket);
}

function disconnect(socket) {
    console.log('called disconnect');
    if (!socket.ws) return;
    clearInterval(socket.alive_interval);
    socket.ws = null;
    socket.alive_interval = null;
}

function sendMessage(socket, peerId, requestId, message){
    console.log('Client sending message: ', message);
    socket.ws.send(JSON.stringify({type: 'ice', from: socket.idInServer, to: peerId, requestId: requestId, data: message}));
}

/********************************
 * handle stale connections
 ********************************/
function staleConnChk (socket) {
    console.log('looking for stale connections to remove');
    var now = (new Date()).getTime();
    var toDel = [];
    for (var iceObjChk in socket.icemap) {
        console.log('chk connections to peer '+socket.icemap[iceObjChk].peerId + ' from '+socket.icemap[iceObjChk].created.getTime());
        if (now - socket.icemap[iceObjChk].created.getTime() > params.connection_data_stale) {
            toDel.push(iceObjChk);
        }
    }

    for (var iceToDel in toDel) {
        console.log('remove stale connections to peer '+socket.icemap[toDel[iceToDel]].peerId);
        delete socket.icemap[toDel[iceToDel]];
    }
}

/* /////////////////////////////////////////// */
/* ICE */
/* /////////////////////////////////////////// */
var initiateIce = function initiateIce(socket, peerId, isInitiator, requestId) {

    var channelId = rand.getRandomInt(10000,90000);

    socket.icemap[channelId] = {
        "channelId": channelId,
        "peerId": peerId,
        "isInitiator": isInitiator,
        "requestId": requestId,
        "created": new Date()
    };

    if (isInitiator) {
        console.log('send accept to peer '+peerId);
        socket.ws.send(JSON.stringify({type: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
    }

    createPeerConnection(socket, channelId, configuration);

    if (isInitiator) {
        socket.icemap[channelId].connect_defer = Q.defer();
        return socket.icemap[channelId].connect_defer.promise;
    }
};

function logError(err) {
    console.log(err.toString(), err);
}

function createPeerConnection(socket, channelId, config) {
    var channelObj = socket.icemap[channelId];
    try {
        console.log('Creating Peer connection as initiator '+ channelObj.isInitiator + ' config: '+ config);

        channelObj.peerConn = new require('shell').webkitRTCPeerConnection(config);

        // send any ice candidates to the other peer
        channelObj.peerConn.onicecandidate = function (event) {
            console.log('onIceCandidate event:', event);
            if (event.candidate) {
                sendMessage(channelObj.peerId, channelObj.requestId, {
                    type: 'candidate',
                    label: event.candidate.sdpMLineIndex,
                    id: event.candidate.sdpMid,
                    candidate: event.candidate.candidate
                });
            } else {
                console.log('End of candidates.');
            }
        };

        if (channelObj.isInitiator) {
            console.log('Creating Data Channel');
            try {
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa");
                onDataChannelCreated(socket, channelId, channelObj.dataChannel);
            } catch (ex) {
                console.log('Ex on Creating Data Channel ' + ex);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }

            console.log('Creating an offer');
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    return onLocalSessionCreated(socket, channelId, desc);
                }, logError);
            } catch (ex) {
                console.log('Ex on Creating an offer ' + ex);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }
        }
        channelObj.peerConn.ondatachannel = function (event) {
            console.log('ondatachannel:', event.channel);
            try {
                channelObj.dataChannel = event.channel;
                onDataChannelCreated(socket, channelId, channelObj.dataChannel);
            } catch (ex) {
                console.log('Ex on ondatachannel ' + ex);
                if (channelObj.connect_defer) channelObj.connect_defer.reject();
            }
        };
    } catch (ex) {
        console.log('Ex on createPeerConnection '+ex);
        if (channelObj.connect_defer) channelObj.connect_defer.reject();
    }
}

function onLocalSessionCreated(socket, channelId, desc) {
    console.log('local session created:', desc);
    var channelObj = socket.icemap[channelId];
    try {
        channelObj.peerConn.setLocalDescription(desc, function () {
            console.log('sending local desc:', channelObj.peerConn.localDescription);
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        console.log('Ex on local session '+ex);
        if (channelObj.connect_defer) channelObj.connect_defer.reject();
    }
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelId;
    for (var iceObj in icemap) {
        if (socket.icemap[iceObj].peerId === peerId && socket.icemap[iceObj].requestId === requestId) {
            channelId = iceObj;
            break;
        }
    }
    var channelObj = socket.icemap[channelId];

    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer. '+peerId+' and channel '+channelId);

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
            console.log('problem in offer '+ex.stack);
            if (channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'answer') {
        try {
            console.log('Got answer.'+peerId+' and channel '+channelId);
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, channelId, configuration);
            }
            channelObj.peerConn.setRemoteDescription(new RTCSessionDescription(message), function () {
            }, logError);
        } catch (ex) {
            console.log('problem in answer '+ex);
            if (channelObj.connect_defer) channelObj.connect_defer.reject();
        }

    } else if (message.type === 'candidate') {
        try {
            console.log('Got candidate.'+peerId+' and channel '+channelId);
            if (channelObj.peerConn) {
            } else {
                createPeerConnection(socket, channelId, configuration);
            }
            channelObj.peerConn.addIceCandidate(new RTCIceCandidate({candidate: message.candidate}));
        } catch (ex) {
            console.log('problem in candidate '+ex);
            if (channelObj.connect_defer) channelObj.connect_defer.reject();
        }
    } else if (message === 'bye') {
        console.log('Got bye.');
    }
}

function onDataChannelCreated(socket, channelId, channel) {

    try {
        console.log('onDataChannelCreated:', channel);

        channel.onopen = function () {

            var channelObj = socket.icemap[channelId];

            console.log('CHANNEL opened!!! ' + channelObj.peerId);

            channel.peerId = channelObj.peerId;

            if (channelObj.connect_defer) {
                console.log('connect defer - resolve');
                channelObj.connect_defer.resolve(channelObj.dataChannel);
            } else {
                console.log('no connect defer');
            }
            delete socket.icemap[channelId];
        };

        channel.onmessage = onIceMessage(channel);

        channel.onclose = function () {
            console.log('CHANNEL closed!!! '+ channel.peerId);
            if (socket.icemap[channelId] && socket.icemap[channelId].connect_defer) socket.icemap[channelId].connect_defer.reject();
            delete socket.icemap[channelId];
        };

        channel.onerror= function (err) {
            console.log('CHANNEL ERR '+channel.peerId+' ' + err);
            if (socket.icemap[channelId] && socket.icemap[channelId].connect_defer) socket.icemap[channelId].connect_defer.reject();
            delete socket.icemap[channelId];
        };

    } catch (ex) {
        console.log('Ex on onDataChannelCreated '+ex);

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
        disconnect(socket);
        clearInterval(socket.stale_conn_interval);
        socket.stale_conn_interval = null;
    }
};

exports.setup = function setup(msgCallback, agentId) {

    var socket = new Socket(agentId);

    callbackOnPeerMsg = msgCallback;

    try {
        socket.stale_conn_interval = setInterval(staleConnChk(socket), params.check_stale_conns);
    } catch (ex) {
        console.error("prob ccccccc");
    }


    return connect(socket);

};

exports.initiateIce = initiateIce;
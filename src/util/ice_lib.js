'use strict';

var WebSocket = require('ws');
var Q = require('q');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');
var zlib = require('zlib');
var _ = require('lodash');
var Semaphore = require('noobaa-util/semaphore');

var configuration = config.ice_servers;

function writeToLog(level, msg) {
    var timeStr = '';
    if (level === 0) {
        dbg.log0(timeStr+' '+msg);
    } else if (level === 1) {
        dbg.log1(timeStr+' '+msg);
    } else if (level === 2) {
        dbg.log2(timeStr+' '+msg);
    } else if (level === 3) {
        dbg.log3(timeStr+' '+msg);
    } else {
        timeStr = (new Date()).toString();
        console.error(timeStr+' '+msg);
    }
}

module.exports = {};

/********************************
 * connection to signaling server
 ********************************/

function keepalive(socket) {
    writeToLog(3, 'send keepalive from '+socket.idInServer);
    try {
        socket.ws.send(JSON.stringify({sigType: 'keepalive'}));
    } catch (ex) {
        writeToLog(-1, 'keepalive err '+ ex);
    }
}

function disconnect(socket) {
    writeToLog(0, 'called disconnect ws');
    if (!socket.ws) {return;}
    writeToLog(0, 'called disconnect ws - clear interval and close');
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
        writeToLog(-1, 'failed disconnect ws '+ ex.stack);
    }
}

var connect = function (socket) {
    writeToLog(0, 'do CLIENT connect is agent: ' + socket.isAgent + " current id: " + socket.idInServer);

    if (!socket.isAgent) {
        socket.conn_defer = Q.defer();
    }

    try {
        var ws = new WebSocket(config.address);

        ws.onopen = function () {

            writeToLog(0, 'ws open connect is agent: ' + socket.isAgent + " current id: " + socket.idInServer);

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
                    writeToLog(-1, 'problem parsing msg '+msgRec);
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
                writeToLog(-1, 'cant find msg '+msgRec);
            }

            if (message.sigType === 'id') {
                if (socket.isAgent) {
                    writeToLog(3, 'id '+ message.id+' from server ignored, i am '+socket.idInServer);
                } else {
                    writeToLog(2, 'got ws id from server id ' + message.id);
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
                        writeToLog(0, 'Got ice from ' + message.from + ' to ' + message.to + ' data ' + msgData + (err ? ' gzip error '+err : '')+' i am '+socket.idInServer);
                        signalingMessageCallback(socket, message.from, msgData, message.requestId);
                    });
                } else {
                    writeToLog(2, 'Got ice from ' + message.from + ' to ' + message.to + ' data ' + message.data);
                    signalingMessageCallback(socket, message.from, message.data, message.requestId);
                }
            } else if (message.sigType === 'accept') {
                writeToLog(2, 'Got accept ' + message + ' from '+message.from+' to '+message.to+' i am '+socket.idInServer);
                initiateIce(socket.p2p_context ,socket, message.from, false, message.requestId);
            } else if (message.sigType === 'keepalive') {
                writeToLog(3, 'Got keepalive from ' + message.from);
            } else if (message.sigType && message.requestId) {
                writeToLog(0, 'Got ' + message.sigType + ' from web server '+message.from+' to '+message.to+' i am '+socket.idInServer);
                if (socket.action_defer && socket.action_defer[message.requestId]) {
                    socket.action_defer[message.requestId].resolve(message);
                    delete socket.action_defer[message.requestId];
                } else {
                    socket.handleRequestMethod(ws, message);
                }
            } else {
                writeToLog(-1, 'unknown sig message ' + require('util').inspect(message));
                try {
                    writeToLog(-1,  'unknown sig message 2 ' + JSON.stringify(message));
                } catch (ex) {
                    writeToLog(-1,  'unknown sig message 3 ' + message);
                }
            }
        };

        ws.onerror = function (err) {
            writeToLog(-1,  'onerror ws ' + err+' ; '+err.stack);

            if (socket.conn_defer) {
                socket.conn_defer.reject();
            }

            if (socket.action_defer) {
                socket.action_defer.reject();
            }

            if (socket.isAgent) {
                writeToLog(-1,  'onerror ws agent');
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, config.reconnect_delay);
            } else if (socket.p2p_context && socket.p2p_context.wsClientSocket) {
                var currWs = socket.p2p_context.wsClientSocket;
                writeToLog(-1,  'onerror ws context');
                if (currWs.interval) {
                    clearInterval(currWs.interval);
                }
                if (currWs.ws_socket && currWs.ws_socket.alive_interval) {
                    clearInterval(currWs.ws_socket.alive_interval);
                    currWs.ws_socket.alive_interval = null;
                }
                delete socket.p2p_context.wsClientSocket;
            } else {
                writeToLog(-1,  'onerror ws - disconnect');
                disconnect(socket);
            }

        };

        ws.onclose = function () {
            writeToLog(-1,  'onclose ws');
            if (socket.isAgent) {
                writeToLog(-1,  'onclose ws agent');
                disconnect(socket);
                setTimeout(
                    function () {
                        connect(socket);
                    }, config.reconnect_delay);
            } else if (socket.p2p_context && socket.p2p_context.wsClientSocket) {
                var currWs = socket.p2p_context.wsClientSocket;
                writeToLog(-1,  'onclose ws context');
                if (currWs.interval) {
                    clearInterval(currWs.interval);
                }
                if (currWs.ws_socket && currWs.ws_socket.alive_interval) {
                    clearInterval(currWs.ws_socket.alive_interval);
                    currWs.ws_socket.alive_interval = null;
                }
                delete socket.p2p_context.wsClientSocket;
            } else {
                writeToLog(-1,  'onclose ws - doing nothing');
            }
        };

        socket.ws = ws;
    } catch (ex) {
        writeToLog(-1,  'ice_lib.connect ERROR '+ ex+' ; ' + ex.stack);
    }

    return socket;
};

function reconnect(socket) {
    disconnect(socket);
    connect(socket);
}

var sendMessage = function sendMessage(socket, peerId, requestId, message) {
    writeToLog(0, 'Client sending message: '+ message + ' to peer '+peerId+' for req '+requestId+' i am '+socket.idInServer+' init: '+socket.icemap[requestId].isInitiator);

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

    if (!config.doStaleCheck) {
        return;
    }

    writeToLog(2,'RUNNING staleConnChk ICE');

    var now = (new Date()).getTime();
    var toDel = [];
    var requestId;
    var peerId;
    var pos;
    var timePassed;
    try {
        for (requestId in socket.icemap) {
            timePassed = now - socket.icemap[requestId].created.getTime();
            writeToLog(2,'chk stale connections requests to peer ' + socket.icemap[requestId].peerId + ' time passed ' +
            timePassed+' for req '+requestId+' is done '+socket.icemap[requestId].done);
            if (timePassed > config.connection_data_stale && socket.icemap[requestId].done) {
                toDel.push(requestId);
            }
        }

        for (pos in toDel) {
            requestId = toDel[pos];
            writeToLog(0, 'remove stale connections data to peer ' + socket.icemap[requestId].peerId+' for request '+requestId);
            delete socket.icemap[requestId];
        }
    } catch (ex) {
        console.error('Error on staleConnChk of icemap ex '+ex+' ; '+ex.stack);
    }

    try {
        if (socket.p2p_context && socket.p2p_context.iceSockets) {
            now = (new Date()).getTime();
            toDel = [];


            for (peerId in socket.p2p_context.iceSockets) {
                timePassed = now - socket.p2p_context.iceSockets[peerId].lastUsed;
                    writeToLog(2,'chk stale connections to peer '+peerId+' time passed '+timePassed+
                ' used by '+require('util').inspect(socket.p2p_context.iceSockets[peerId].usedBy));
                if (timePassed > config.connection_data_stale &&
                    Object.keys(socket.p2p_context.iceSockets[peerId].usedBy).length === 0) {
                    toDel.push(peerId);
                }
            }

            for (pos in toDel) {
                peerId = toDel[pos];
                writeToLog(0, 'remove stale ice connections to peer ' + peerId);
                if (socket.p2p_context.iceSockets[peerId].dataChannel) {
                    socket.p2p_context.iceSockets[peerId].dataChannel.close();
                }
                if (socket.p2p_context.iceSockets[peerId].peerConn) {
                    socket.p2p_context.iceSockets[peerId].peerConn.close();
                }
                delete socket.p2p_context.iceSockets[peerId];
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
            }
        }

        var channelObj = socket.icemap[requestId];

        if (isInitiator) {
            if (p2p_context) {
                return p2p_context.iceSockets[peerId].sem.surround(function() {

                    if (p2p_context.iceSockets[peerId].status === 'open') {
                        var state = p2p_context.iceSockets[peerId].dataChannel.readyState;
                        if (state && (state === 'closing' || state === 'closed')) {
                            writeToLog(0, 'state of ice conn to peer ' + peerId+ ' is: '+state+' force close');
                            forceCloseIce(p2p_context, peerId, channelObj, socket);
                        }
                    }

                    if (p2p_context.iceSockets[peerId].status === 'new') {
                        writeToLog(0, 'send accept to peer ' + peerId+ ' with req '+requestId+ ' from '+socket.idInServer);
                        socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
                        createPeerConnection(socket, requestId, configuration);
                        p2p_context.iceSockets[peerId].status = 'start';
                        channelObj.connect_defer = p2p_context.iceSockets[peerId].connect_defer;
                    } else if (p2p_context.iceSockets[peerId].status === 'open') {
                        channelObj.dataChannel = p2p_context.iceSockets[peerId].dataChannel;
                        channelObj.peerConn = p2p_context.iceSockets[peerId].peerConn;
                        p2p_context.iceSockets[peerId].lastUsed = (new Date()).getTime();
                        p2p_context.iceSockets[channelObj.peerId].usedBy[requestId] = 1;
                        channelObj.connect_defer = Q.defer();
                        channelObj.connect_defer.resolve(channelObj.dataChannel);
                    } else if (p2p_context.iceSockets[peerId].status === 'start') {
                        channelObj.connect_defer = p2p_context.iceSockets[peerId].connect_defer;
                        p2p_context.iceSockets[peerId].lastUsed = (new Date()).getTime();
                        p2p_context.iceSockets[peerId].usedBy[requestId] = 1;
                        channelObj.peerConn = p2p_context.iceSockets[peerId].peerConn;
                    }
                    return channelObj.connect_defer.promise;
                });
            } else {
                channelObj.connect_defer = Q.defer();
                writeToLog(0, 'send accept to peer (no context) ' + peerId+ ' with req '+requestId+ ' from '+socket.idInServer);
                socket.ws.send(JSON.stringify({sigType: 'accept', from: socket.idInServer, to: peerId, requestId: requestId}));
                createPeerConnection(socket, requestId, configuration);
                return channelObj.connect_defer.promise;
            }
        }

        // not isInitiator
        createPeerConnection(socket, requestId, configuration);
    } catch (ex) {
        console.error('Error on initiateIce '+(isInitiator ? 'to' : 'for')+' peer '+peerId+' ex '+ex+' ; '+ex.stack);
        throw ex;
    }

};
module.exports.initiateIce = initiateIce;

var writeToChannel = function writeToChannel(channel, data, requestId) {
    var state = channel.readyState;
    if (state && (state === 'closing' || state === 'closed')) {
        console.error('ERROR writing to channel for request '+requestId+' and peer '+channel.peerId +' channel state is '+state);
        throw new Error('ERROR writing to channel state is '+state);
    }
    writeToLog(3,'channel buffer amount on before send for req '+requestId+' is '+channel.bufferedAmount);
    channel.send(data);
    writeToLog(3,'channel buffer amount on after send for req '+requestId+' is '+channel.bufferedAmount);
};
module.exports.writeToChannel = writeToChannel;


var isRequestEnded = function isRequestEnded(p2p_context, requestId, channel) {
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
};
module.exports.isRequestEnded = isRequestEnded;

var closeIce = function closeIce(socket, requestId, dataChannel) {

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
        var channelObj = socket.icemap[requestId];
        if (channelObj) {
            channelObj.done = true;
            if (!peerId) {
                peerId = channelObj.peerId;
            }
        }

        obj = socket.p2p_context ? socket.p2p_context.iceSockets[peerId] : null;

        if (obj && obj.dataChannel === dataChannel) {
            obj.lastUsed = (new Date()).getTime();
            delete obj.usedBy[requestId];
        } else if (socket && !socket.p2p_context && dataChannel) {
            console.error('Closing the ice socket to peer ' +dataChannel.peerId);
            if (channelObj && channelObj.peerConn) {
                channelObj.peerConn.close();
            }
            dataChannel.close();
        }
    } catch (ex) {
       console.error('Error on close ice socket for request '+requestId+' ex '+ex);
    }
};
module.exports.closeIce = closeIce;

var forceCloseIce = function forceCloseIce(p2p_context, peerId, channelObj, socket) {

    var context = p2p_context;
    if (!context && socket) {
        context = socket.p2p_context;
    }

    if (context && context.iceSockets && context.iceSockets[peerId] &&
        context.iceSockets[peerId].dataChannel) {
        console.error('forceCloseIce peer '+peerId);
        context.iceSockets[peerId].dataChannel.close();
        context.iceSockets[peerId].peerConn.close();

        if (socket && socket.icemap && context.iceSockets[peerId].usedBy) {
            for (var req in context.iceSockets[peerId].usedBy) {
                if (socket.icemap[req]) {
                    console.error('mark peer '+peerId+' req '+req+' as done so will be removed');
                    socket.icemap[req].done = true;
                }
            }
        }

        delete context.iceSockets[peerId];
    } else if (channelObj && channelObj.dataChannel) {
        console.error('forceCloseIce (no context) peer '+peerId);
        channelObj.dataChannel.close();
        channelObj.peerConn.close();
        channelObj.done = true;
    } else {
        console.error('forceCloseIce nothing to close - peer '+peerId);
    }
};
module.exports.forceCloseIce = forceCloseIce;

function logError(err) {
    console.error('logError called: '+ err);
}

function onLocalSessionCreated(socket, requestId, desc) {
    writeToLog(2, 'local session created:'+ desc);
    var channelObj = socket.icemap[requestId];

    if (!channelObj || channelObj.done) {
        writeToLog(-1, 'PROBLEM onLocalSessionCreated no channel or already done !!!');
        return;
    }

    try {
        channelObj.peerConn.setLocalDescription(desc, function () {
            writeToLog(2, 'sending local desc:' + channelObj.peerConn.localDescription);
            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.localDescription);
        }, logError);
    } catch (ex) {
        writeToLog(-1, 'Ex on local session ' + ex);
        if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
    }
}

function createPeerConnection(socket, requestId, config) {
    var channelObj = socket.icemap[requestId];
    if (!channelObj || channelObj.done) {
        writeToLog(-1, 'PROBLEM Creating Peer connection no channel or already done !!!');
        return;
    }

    try {
        writeToLog(2, 'Creating Peer connection as initiator ' + channelObj.isInitiator + ' config: ' + config);

        var FuncPerrConn = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

        try {
            channelObj.peerConn = new FuncPerrConn(config);
        } catch (ex) {
            writeToLog(-1,  'prob win create '+ex.stack);
        }

        // send any ice candidates to the other peer
        channelObj.peerConn.onicecandidate = function (event) {
            var candidateMsg;
            if (event.candidate) {

                try {
                    //if (!channelObj.peerConn.candidates) {
                    //    channelObj.peerConn.candidates = [];
                    //}

                    candidateMsg = JSON.stringify({
                        type: 'candidate',
                        label: event.candidate.sdpMLineIndex,
                        id: event.candidate.sdpMid,
                        candidate: event.candidate.candidate
                    });

                    //if (candidateMsg.indexOf('tcp') >= 0) {
                        writeToLog(2, channelObj.peerId+' onIceCandidate event: '+
                        require('util').inspect(event.candidate.candidate) +
                        ' state is '+(event.target ? event.target.iceGatheringState : 'N/A'));

                        sendMessage(socket, channelObj.peerId, channelObj.requestId, candidateMsg);
                    //} else {
                    //    channelObj.peerConn.candidates.push(candidateMsg);
                    //}
                } catch (ex) {
                    console.error('candidates issue '+ex+' ; '+ex.stack);
                }

            } else {
                try {
                    writeToLog(2, channelObj.peerId+' End of candidates. state is '+(event.target ? event.target.iceGatheringState : 'N/A')); // complete
                    if (channelObj.peerConn.candidates) {
                        for (candidateMsg in channelObj.peerConn.candidates) {
                            writeToLog(2, channelObj.peerId+' send onIceCandidate event: '+ channelObj.peerConn.candidates[candidateMsg]);
                            sendMessage(socket, channelObj.peerId, channelObj.requestId, channelObj.peerConn.candidates[candidateMsg]);
                        }
                    }
                } catch (ex) {
                    console.error('all candidates issue '+ex+' ; '+ex.stack);
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
                writeToLog(0,channelObj.peerId+" NOTICE ICE connection state change: " + evt.target.iceConnectionState);
                if ('disconnected' === evt.target.iceConnectionState || 'failed' === evt.target.iceConnectionState) {
                    forceCloseIce(socket.p2p_context, channelObj.peerId, channelObj, socket);
                }
            }
        };

        channelObj.peerConn.signalingstatechange = function(evt) {
            writeToLog(0,channelObj.peerId+" NOTICE ICE signalingstatechange: " + require('util').inspect(evt));
        };

        channelObj.peerConn.onidpassertionerror = function(evt) {
            writeToLog(0,channelObj.peerId+" NOTICE ICE onidpassertionerror: " + require('util').inspect(evt));
        };

        channelObj.peerConn.onidpvalidationerror = function(evt) {
            writeToLog(0,channelObj.peerId+" NOTICE ICE onidpvalidationerror: " + require('util').inspect(evt));
        };

        channelObj.peerConn.onremovestream = function(evt) {
            writeToLog(0,'onremovestream Data Channel req '+requestId+' evt '+require('util').inspect(evt));
        };

        if (channelObj.isInitiator) {
            writeToLog(3,'Creating Data Channel req '+requestId);
            try {
                // you can only specify maxRetransmits or maxRetransmitTime, not both
                var dtConfig = {ordered: true, reliable: true, maxRetransmits: 5};//, maxRetransmitTime: 3000};
                channelObj.dataChannel = channelObj.peerConn.createDataChannel("noobaa", dtConfig); // TODO  ? dtConfig
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeToLog(-1, 'Ex on Creating Data Channel ' + ex);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
            }

            writeToLog(3, 'Creating an offer req '+requestId);
            var mediaConstraints = {
                mandatory: {
                    OfferToReceiveAudio: false,
                    OfferToReceiveVideo: false
                }
            };
            try {
                channelObj.peerConn.createOffer(function (desc) {
                    return onLocalSessionCreated(socket, requestId, desc);
                }, logError, mediaConstraints); // TODO ? mediaConstraints
            } catch (ex) {
                writeToLog(-1,  'Ex on Creating an offer ' + ex.stack);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
            }
        }

        channelObj.peerConn.ondatachannel = function (event) {
            writeToLog(-1, 'ondatachannel:'+ event.channel);
            try {
                channelObj.dataChannel = event.channel;
                onDataChannelCreated(socket, requestId, channelObj.dataChannel);
            } catch (ex) {
                writeToLog(-1, 'Ex on ondatachannel ' + ex.stack);
                if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
            }
        };
    } catch (ex) {
        writeToLog(-1, 'Ex on createPeerConnection ' + ex.stack);
        if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
    }
}

function signalingMessageCallback(socket, peerId, message, requestId) {

    var channelObj = socket.icemap[requestId];
    if (!channelObj || channelObj.done) {
        writeToLog(-1, 'problem NO channelObj or already done for req '+requestId+' and peer '+peerId);
        return;
    }

    var Desc = RTCSessionDescription;
    var Candidate = RTCIceCandidate;

    if (message.type === 'offer') {
        writeToLog(2, 'Got offer. Sending answer to peer. ' + peerId + ' and channel ' + requestId);

        try {
            channelObj.peerConn.setRemoteDescription(new Desc(message), function () {
                writeToLog(2, 'remote desc set for peer '+peerId);
            }, logError);
            channelObj.peerConn.createAnswer(function (desc) {
                return onLocalSessionCreated(socket, requestId, desc);
            }, logError);
        } catch (ex) {
            writeToLog(-1,  'problem in offer ' + ex.stack);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
        }

    } else if (message.type === 'answer') {
        try {
            writeToLog(2, 'Got answer.' + peerId + ' and channel ' + requestId);
            channelObj.peerConn.setRemoteDescription(new Desc(message), function () {
                writeToLog(2, 'remote desc set for peer '+peerId);
            }, logError);
        } catch (ex) {
            writeToLog(-1,  'problem in answer ' + ex);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
        }

    } else if (message.type === 'candidate') {
        try {
            writeToLog(2, 'Got candidate.' + peerId + ' and channel ' + requestId+' ; '+require('util').inspect(message));
            if (channelObj && !channelObj.done) {
                channelObj.peerConn.addIceCandidate(new Candidate({candidate: message.candidate}));
            } else {
                writeToLog(0, 'Got candidate.' + peerId + ' and channel ' + requestId + ' CANNOT HANDLE connection removed/done');
            }
        } catch (ex) {
            writeToLog(-1,  'problem in candidate from req '+ requestId +' ex:' + ex+ ', msg was: '+message.candidate);
            channelObj = socket.icemap[requestId];
            if (channelObj && channelObj.connect_defer) {channelObj.connect_defer.reject();}
        }
    } else if (message === 'bye') {
        writeToLog(2, 'Got bye.');
    }
}

function onIceMessage(socket, channel) {
    return function onmessage(event) {
        return channel.callbackOnPeerMsg(socket.p2p_context, channel, event);
    };
}

function onDataChannelCreated(socket, requestId, channel) {

    try {
        writeToLog(2, 'onDataChannelCreated:'+ channel);

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


                for (var req in socket.p2p_context.iceSockets[channelObj.peerId].usedBy) {
                    if (socket.icemap[req]) {
                        socket.icemap[req].dataChannel = channelObj.dataChannel;
                    }
                }

            }

            writeToLog(0,'ICE CHANNEL opened ' + channelObj.peerId+' i am '+socket.idInServer + ' for request '+requestId);

            channel.peerId = channelObj.peerId;
            channel.myId = socket.idInServer;
            channel.callbackOnPeerMsg = socket.callbackOnPeerMsg;
            channel.handleRequestMethod = socket.handleRequestMethod;

            if (channelObj.connect_defer) {
                writeToLog(3, 'connect defer - resolve');
                channelObj.connect_defer.resolve(channelObj.dataChannel);
            } else {
                writeToLog(3, 'no connect defer');
            }
        };

        channel.onmessage = onIceMessage(socket, channel);

        channel.onleave = function (userid) {
            console.error('ICE CHANNEL onleave !!!! this ever called ??? ' + channel.peerId+ ' userid: '+userid);
        };

        channel.onclose = function () {
            console.error('ICE CHANNEL closed ' + channel.peerId);
            writeToLog(0,'ICE CHANNEL closed ' + channel.peerId);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
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

        channel.onleave = function () {
            console.error('ICE CHANNEL onleave ' + channel.peerId);
        };

        channel.onerror = function (err) {
            console.error('ICE CHANNEL err ' + channel.peerId);
            writeToLog(0,socket, 'CHANNEL ERR ' + channel.peerId + ' ' + err);
            if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
                socket.icemap[requestId].connect_defer.reject();
            }
            if (socket.icemap[requestId]) {
                socket.icemap[requestId].done = true;
            }

            if (socket.p2p_context && socket.p2p_context.iceSockets[channel.peerId]) {
                delete socket.p2p_context.iceSockets[channel.peerId].usedBy[requestId];
            }
        };

    } catch (ex) {
        writeToLog(-1,  'Ex on onDataChannelCreated ' + ex);

        if (socket.icemap[requestId] && socket.icemap[requestId].connect_defer) {
            socket.icemap[requestId].connect_defer.reject();
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
            writeToLog(-1, 'Ex on closeSignaling ' + err);
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

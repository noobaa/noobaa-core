var wrtc = require('../../../../node-webrtc');
// var wrtc = require('wrtc');

global.window = {
    // Firefox does not trigger "negotiationneeded"
    // this is a workaround to make simple-peer trigger the negotiation
    mozRTCPeerConnection: wrtc.RTCPeerConnection,

    RTCPeerConnection: wrtc.RTCPeerConnection,
    RTCSessionDescription: wrtc.RTCSessionDescription,
    RTCIceCandidate: wrtc.RTCIceCandidate,
};

require('./client');

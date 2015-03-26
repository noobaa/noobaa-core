var wrtc = require('wrtc');

global.window = {
    RTCPeerConnection: wrtc.RTCPeerConnection,
    RTCSessionDescription: wrtc.RTCSessionDescription,
    RTCIceCandidate: wrtc.RTCIceCandidate,
    // Firefox does not trigger "negotiationneeded"
    // this is a workaround to make simple-peer trigger the negotiation
    mozRTCPeerConnection: wrtc.RTCPeerConnection,
};

require('./client');

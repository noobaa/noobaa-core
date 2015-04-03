/* jshint browser:true */
'use strict';

var wrtc;

if (global.window) {
    wrtc = {
        RTCPeerConnection: window.RTCPeerConnection ||
            window.mozRTCPeerConnection ||
            window.webkitRTCPeerConnection,
        RTCSessionDescription: window.RTCSessionDescription,
        RTCIceCandidate: window.RTCIceCandidate,
    };
} else {
    wrtc = require('../../../node-webrtc');
    global.window = {
        RTCPeerConnection: wrtc.RTCPeerConnection,
        RTCSessionDescription: wrtc.RTCSessionDescription,
        RTCIceCandidate: wrtc.RTCIceCandidate,
        // Firefox does not trigger "negotiationneeded"
        // this is a workaround to make simple-peer trigger the negotiation
        mozRTCPeerConnection: wrtc.RTCPeerConnection,
        webkitRTCPeerConnection: wrtc.RTCPeerConnection,
    };
}

module.exports = wrtc;

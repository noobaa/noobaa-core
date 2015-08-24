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
    };
}

module.exports = wrtc;

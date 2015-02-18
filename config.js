var config = {};

// SIGNALING AND ICE (on heroku: ws://noobaa-signaling.herokuapp.com)
config.address = 'ws://127.0.0.1:5000';
config.alive_delay = 10 * 1000;
config.reconnect_delay = 5000;
config.connection_data_stale = 5 * 60 * 1000;
config.check_stale_conns = 5 * 60 * 1000;
config.stun='stun:stun.l.google.com:19302';
config.chunk_size = 60 * 1000;

module.exports = config;


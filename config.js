var config = {};

// SIGNALING AND ICE
config.address = 'ws://10.0.0.3:5002'; // (on heroku: ws://noobaa-signaling.herokuapp.com)
config.alive_delay = 10 * 1000;
config.reconnect_delay = 5000;
config.connection_data_stale = 60 * 1000;
config.check_stale_conns = 60 * 1000;
config.stun='stun:stun.l.google.com:19302';
config.chunk_size = 60 * 1000;
config.doDedup = false;
config.buildWorkerOn = false;
config.connection_default_timeout = 60 * 1000;
config.get_response_default_timeout = 15 * 1000;

config.use_ws_when_possible = true;
config.use_ice_when_possible = true;

// ACTION CONCURRENCY
config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 16;
config.READ_RANGE_CONCURRENCY = 8;
config.REPLICATE_CONCURRENCY = 32;

// WEB SERVER
config.web_address = 'http://10.0.0.3:5001';
config.web_address_heroku = 'https://noobaa-core.herokuapp.com';

module.exports = config;


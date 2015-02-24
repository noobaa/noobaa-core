var config = {};

// SIGNALING AND ICE (on heroku: ws://noobaa-signaling.herokuapp.com)
config.address = 'ws://127.0.0.1:5000';
config.alive_delay = 10 * 1000;
config.reconnect_delay = 5000;
config.connection_data_stale = 1 * 60 * 1000;
config.check_stale_conns = 1 * 60 * 1000;
config.stun='stun:stun.l.google.com:19302';
config.chunk_size = 60 * 1000;
config.doDedup = false;
config.buildWorkerOn = false;

config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 16;
config.READ_RANGE_CONCURRENCY = 8;
config.REPLICATE_CONCURRENCY = 32;

config.web_address = 'http://127.0.0.1:5001';
config.web_address_heroku = 'https://noobaa-core.herokuapp.com';

module.exports = config;


'use strict';

module.exports = {
    send: send,
    connect: noop,
    authenticate: noop,
    close: noop,
};

function send(conn, msg) {
    conn.emit('message', msg);
}

function noop() {}

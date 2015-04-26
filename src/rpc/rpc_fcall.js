'use strict';

module.exports = {
    reusable: true,
    connect: noop,
    close: noop,
    send: send,
    authenticate: noop,
};

function send(conn, msg) {
    setImmediate(function() {
        conn.receive(msg);
    });
}

function noop() {}

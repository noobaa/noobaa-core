'use strict';

module.exports = {
    send: send,
    connect: noop,
    authenticate: noop,
    close: noop,
    reusable: true,
};

function send(conn, msg) {
    setImmediate(function() {
        conn.receive(msg);
    });
}

function noop() {}

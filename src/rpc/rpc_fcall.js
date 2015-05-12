'use strict';

module.exports = {
    connect: connect,
    close: close,
    send: send,
    authenticate: authenticate,
};

function connect(conn, options) {
    // noop
}

function close(conn) {
    // noop
}

function send(conn, msg) {
    setImmediate(function() {
        conn.receive(msg);
    });
}

function authenticate(conn, auth_token) {
    // noop
}

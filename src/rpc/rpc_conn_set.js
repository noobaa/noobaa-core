/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);

const CLOSE_LISTENER_SYMBOL = Symbol('CLOSE_LISTENER_SYMBOL');

class RpcConnSet {

    constructor(name) {
        this.name = name;
        this.set = new Set();
    }

    add(conn) {
        if (conn.is_closed()) {
            dbg.warn(this.name, 'ignore closed connection', conn.connid);
            return;
        }
        if (this.set.has(conn)) {
            dbg.log1(this.name, 'already registered', conn.connid);
            return;
        }
        dbg.log1(this.name, 'adding connection', conn.connid);
        this.set.add(conn);
        const close_listener = () => this.remove(conn);
        conn[CLOSE_LISTENER_SYMBOL] = close_listener;
        conn.once('close', close_listener);
    }

    remove(conn) {
        dbg.warn(this.name, 'removing connection', conn.connid);
        const close_listener = conn[CLOSE_LISTENER_SYMBOL];
        delete conn[CLOSE_LISTENER_SYMBOL];
        conn.removeListener('close', close_listener);
        this.set.delete(conn);
    }

    cleanup() {
        for (const conn of this.set) {
            if (conn.is_closed()) this.remove(conn);
        }
    }

    list() {
        this.cleanup();
        return Array.from(this.set);
    }

}

module.exports = RpcConnSet;

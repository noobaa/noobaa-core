'use strict';

const net_ping = require('net-ping');
const _ = require('lodash');
const dbg = require('./debug_module')(__filename);
const url = require('url');
const dns = require('dns');
const P = require('./promise');

const DEFAULT_PING_OPTIONS = {
    timeout: 5000,
    retries: 0,
    packetSize: 64
};

function ping(target, options) {
    dbg.log0('pinging', target);
    dbg.log0('WOOP target:', target);

    options = options || DEFAULT_PING_OPTIONS;
    _.defaults(options, DEFAULT_PING_OPTIONS);
    let session = net_ping.createSession(options);
    return dns_resolve(url.parse(target).hostname || target)
        .then(ip_table => P.any(
            _.map(ip_table, ip => new Promise((resolve, reject) => {
                dbg.log0('LOOP ip:', ip);
                session.pingHost(ip, error => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            }))));

    /*
    new Promise((resolve, reject) => {
            dbg.log0('LOOP ip:', ip_table);
            session.pingHost(ip_table, error => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        })));*/
}

function dns_resolve(target, options) {
    dbg.log0('resolving dns address', target);
    return new Promise((resolve, reject) => {
        dns.resolve(target, (options && options.rrtype) || 'A', (err, ip_table) => {
            if (err) {
                reject(reject);
            } else {
                resolve(ip_table);
            }
        });
    });
}

exports.ping = ping;
exports.dns_resolve = dns_resolve;

/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');
const net_utils = require('../../../util/net_utils');

describe('IP Utils', () => {
    it('is_ip should correctly identify IP addresses', () => {
        expect(net_utils.is_ip('192.168.1.1')).toBe(true);
        expect(net_utils.is_ip('::1')).toBe(true);
        expect(net_utils.is_ip('not_an_ip')).toBe(false);
        expect(net_utils.is_ip('256.256.256.256')).toBe(false);
    });

    it('is_fqdn should correctly identify FQDNs', () => {
        expect(net_utils.is_fqdn('example.com')).toBe(true);
        expect(net_utils.is_fqdn('sub.example.com')).toBe(true);
        expect(net_utils.is_fqdn('localhost')).toBe(false);
        expect(net_utils.is_fqdn('invalid_domain-.com')).toBe(false);
    });

    it('is_cidr should correctly identify CIDR notation', () => {
        expect(net_utils.is_cidr('192.168.1.0/24')).toBe(true);
        expect(net_utils.is_cidr('10.0.0.0/8')).toBe(true);
        expect(net_utils.is_cidr('2001:db8::/32')).toBe(true);
        expect(net_utils.is_cidr('192.168.1.300/24')).toBe(false);
        expect(net_utils.is_cidr('invalid_cidr')).toBe(false);
        expect(net_utils.is_cidr('192.168.1.1')).toBe(false);
        expect(net_utils.is_cidr('282.150.0.0/12')).toBe(false);
        expect(net_utils.is_cidr('192.168.0.0/35')).toBe(false);
    });

    it('is_localhost should correctly identify localhost addresses', () => {
        expect(net_utils.is_localhost('127.0.0.1')).toBe(true);
        expect(net_utils.is_localhost('::1')).toBe(true);
        expect(net_utils.is_localhost('localhost')).toBe(true);
        expect(net_utils.is_localhost('192.168.1.1')).toBe(false);
    });

    it('unwrap_ipv6 should remove IPv6 prefix', () => {
        expect(net_utils.unwrap_ipv6('::ffff:192.168.1.1')).toBe('192.168.1.1');
        expect(net_utils.unwrap_ipv6('::1')).toBe('::1');
        expect(net_utils.unwrap_ipv6('2001:db8::ff00:42:8329')).toBe('2001:db8::ff00:42:8329');
    });

    it('ip_toLong should convert IPv4 to long', () => {
        expect(net_utils.ip_toLong('192.168.1.1')).toBe(3232235777);
        expect(net_utils.ip_toLong('0.0.0.0')).toBe(0);
        expect(net_utils.ip_toLong('255.255.255.255')).toBe(4294967295);
    });

    it('ip_to_long should handle both IPv4 and IPv6-mapped IPv4', () => {
        expect(net_utils.ip_to_long('192.168.1.1')).toBe(3232235777);
        expect(net_utils.ip_to_long('::ffff:192.168.1.1')).toBe(3232235777);
    });

    it('find_ifc_containing_address should find interface containing the address', () => {
        const networkInterfacesMock = {
            eth0: [
                { family: 'IPv4', cidr: '192.168.1.0/24', address: '192.168.1.2' },
                { family: 'IPv6', cidr: 'fe80::/64', address: 'fe80::1' },
            ],
            lo: [{ family: 'IPv4', cidr: '127.0.0.0/8', address: '127.0.0.1' }],
        };
        jest.spyOn(os, 'networkInterfaces').mockReturnValue(networkInterfacesMock);

        expect(net_utils.find_ifc_containing_address('192.168.1.5')).toEqual({ ifc: 'eth0', info: networkInterfacesMock.eth0[0] });
        expect(net_utils.find_ifc_containing_address('127.0.0.1')).toEqual({ ifc: 'lo', info: networkInterfacesMock.lo[0] });
        expect(net_utils.find_ifc_containing_address('8.8.8.8')).toBeUndefined();
    });

    it('ip_toString should convert buffers to IP strings', () => {
        expect(net_utils.ip_toString(Buffer.from([192, 168, 1, 1]), 0, 4)).toBe('192.168.1.1');
        expect(net_utils.ip_toString(Buffer.from([0, 0, 0, 0]), 0, 4)).toBe('0.0.0.0');
        expect(net_utils.ip_toString(Buffer.from([255, 255, 255, 255]), 0, 4)).toBe('255.255.255.255');
        expect(net_utils.ip_toString(Buffer.from([32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), 0, 16)).toBe('2001:db8::1');
        expect(() => net_utils.ip_toString(Buffer.from([192, 168, 1, 1]), undefined, 4)).toThrow('Offset is required');
    });

    it('ipv4_to_buffer should convert IPv4 string to buffer', () => {
        const buff = Buffer.alloc(4);
        expect(net_utils.ipv4_to_buffer('192.168.1.1', buff, 0)).toEqual(Buffer.from([192, 168, 1, 1]));
    });

    it('ipv6_to_buffer should convert expanded IPv6 string to buffer', () => {
        const buff = Buffer.alloc(16);
        expect(net_utils.ipv6_to_buffer('2001:0db8:0000:0000:0000:0000:0000:0001', buff, 0)).toEqual(
            Buffer.from([32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
        );
    });

    it('expend_ipv6 should expand IPv6 shorthand notation', () => {
        expect(net_utils.expend_ipv6('::')).toEqual(['0', '0', '0', '0', '0', '0', '0', '0']);
        expect(net_utils.expend_ipv6('2001:db8::1')).toEqual(['2001', 'db8', '0', '0', '0', '0', '0', '1']);
        expect(net_utils.expend_ipv6('2001:db8::ff00:42:8329')).toEqual(['2001', 'db8', '0', '0', '0', 'ff00', '42', '8329']);
        expect(net_utils.expend_ipv6('::1')).toEqual(['0', '0', '0', '0', '0', '0', '0', '1']);
        expect(net_utils.expend_ipv6('2001:0db8:85a3::8a2e:370:7334')).toEqual(['2001', '0db8', '85a3', '0', '0', '8a2e', '370', '7334']);
        expect(net_utils.expend_ipv6('::ffff:192.168.1.1')).toEqual(['0', '0', '0', '0', '0', 'ffff', 'c0a8', '0101']);
    });

    it('ip_toBuffer should convert IP strings to buffer', () => {
        expect(net_utils.ip_toBuffer('10.0.0.1', Buffer.alloc(4), 0)).toEqual(Buffer.from([10, 0, 0, 1]));
        expect(net_utils.ip_toBuffer('2001:db8::1', Buffer.alloc(16), 0)).toEqual(
            Buffer.from([32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
        );
        expect(() => net_utils.ip_toBuffer('invalid_ip', Buffer.alloc(16), 0)).toThrow('Invalid IP address: invalid_ip');
        expect(() => net_utils.ip_toBuffer('10.0.0.1')).toThrow('Offset is required');
    });
});

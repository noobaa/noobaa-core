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

    it('normalize_family should return the proper family', () => {
        expect(net_utils.normalize_family(4)).toBe('ipv4');
        expect(net_utils.normalize_family(6)).toBe('ipv6');
        expect(net_utils.normalize_family('IPv4')).toBe('ipv4');
        expect(net_utils.normalize_family('IPv6')).toBe('ipv6');
        expect(net_utils.normalize_family('customFamily')).toBe('customfamily');
        expect(net_utils.normalize_family(undefined)).toBe('ipv4');
        expect(net_utils.normalize_family(null)).toBe('ipv4');
    });

    it('should return true for loopback addresses and false if not', () => {
        expect(net_utils.is_loopback('127.0.0.1')).toBe(true);
        expect(net_utils.is_loopback('127.255.255.255')).toBe(true);
        expect(net_utils.is_loopback('::1')).toBe(true);
        expect(net_utils.is_loopback('192.168.1.1')).toBe(false);
        expect(net_utils.is_loopback('10.0.0.1')).toBe(false);
        expect(net_utils.is_loopback('8.8.8.8')).toBe(false);
        expect(net_utils.is_loopback('2001:db8::1')).toBe(false);
    });

    it('should return true for localhost and loopback addresses and false if not', () => {
        expect(net_utils.is_localhost('127.0.0.1')).toBe(true);
        expect(net_utils.is_localhost('::1')).toBe(true);
        expect(net_utils.is_localhost('localhost')).toBe(true);
        expect(net_utils.is_localhost('192.168.1.1')).toBe(false);
        expect(net_utils.is_localhost('10.0.0.1')).toBe(false);
        expect(net_utils.is_localhost('google.com')).toBe(false);
    });

    it('should return true for the IPv6 loopback address ::1', () => {
        const buf = Buffer.alloc(16);
        buf[15] = 1; // last byte is 1
        expect(net_utils.is_ipv6_loopback_buffer(buf)).toBe(true);
    });

    it('should return false for :: (all zeros)', () => {
        const buf = Buffer.alloc(16); // all zeros
        expect(net_utils.is_ipv6_loopback_buffer(buf)).toBe(false);
    });

    it('should return false for random non-loopback IPv6 address', () => {
        const buf = Buffer.from([
            0x20, 0x01, 0x0d, 0xb8,
            0x85, 0xa3, 0x00, 0x00,
            0x00, 0x00, 0x8a, 0x2e,
            0x03, 0x70, 0x73, 0x34
        ]);
        expect(net_utils.is_ipv6_loopback_buffer(buf)).toBe(false);
    });

    it('should return false if last byte is not 1', () => {
        const buf = Buffer.alloc(16);
        buf[15] = 2; // last byte is 2
        expect(net_utils.is_ipv6_loopback_buffer(buf)).toBe(false);
    });

    it('should return false if first 15 bytes are not all zero', () => {
        const buf = Buffer.alloc(16);
        buf[0] = 1; // first byte not zero
        buf[15] = 1; // last byte correct
        expect(net_utils.is_ipv6_loopback_buffer(buf)).toBe(false);
    });

    it('should return false for buffers of incorrect length', () => {
        const shortBuf = Buffer.alloc(8);
        expect(net_utils.is_ipv6_loopback_buffer(shortBuf)).toBe(false);

        const longBuf = Buffer.alloc(32);
        longBuf[31] = 1;
        expect(net_utils.is_ipv6_loopback_buffer(longBuf)).toBe(false);
    });

    it('should return true for 10/8', () => {
        expect(net_utils.is_private('10.0.0.1')).toBe(true);
        expect(net_utils.is_private('10.255.255.255')).toBe(true);
    });

    it('should return true for 172.16.0.0 – 172.31.255.255', () => {
        expect(net_utils.is_private('172.16.0.1')).toBe(true);
        expect(net_utils.is_private('172.31.255.254')).toBe(true);
        expect(net_utils.is_private('172.15.0.1')).toBe(false); // outside range
        expect(net_utils.is_private('172.32.0.1')).toBe(false); // outside range
    });

    it('should return true for 192.168/16', () => {
        expect(net_utils.is_private('192.168.0.1')).toBe(true);
        expect(net_utils.is_private('192.168.255.255')).toBe(true);
    });

    it('should return true for loopback 127/8', () => {
        expect(net_utils.is_private('127.0.0.1')).toBe(true);
        expect(net_utils.is_private('127.255.255.255')).toBe(true);
    });

    it('should return true for link-local 169.254/16', () => {
        expect(net_utils.is_private('169.254.1.1')).toBe(true);
    });

    it('should return false for public IPv4', () => {
        expect(net_utils.is_private('8.8.8.8')).toBe(false);
        expect(net_utils.is_private('1.1.1.1')).toBe(false);
        expect(net_utils.is_private('172.32.0.1')).toBe(false);
        expect(net_utils.is_private('172.15.0.1')).toBe(false);
    });

    // IPv4 with CIDR
    it('should correctly handle IPv4 addresses with CIDR', () => {
        expect(net_utils.is_private('10.1.2.3/24')).toBe(true);
        expect(net_utils.is_private('8.8.8.8/32')).toBe(false);
    });

    // IPv6 unspecified (::)
    it('should return true for ::', () => {
        expect(net_utils.is_private('::')).toBe(true);
    });

    // IPv6 loopback (::1)
    it('should return true for ::1', () => {
        expect(net_utils.is_private('::1')).toBe(true);
    });

    // IPv6 ULA fc00::/7
    it('should return true for fc00::/7', () => {
        expect(net_utils.is_private('fc00::1')).toBe(true);
        expect(net_utils.is_private('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
        expect(net_utils.is_private('fe00::1')).toBe(false);
    });

    // IPv6 link-local fe80::/10
    it('should return true for fe80::/10', () => {
        expect(net_utils.is_private('fe80::1')).toBe(true);
        expect(net_utils.is_private('febf::1')).toBe(true);
        expect(net_utils.is_private('fec0::1')).toBe(false);
    });

    // IPv4-mapped IPv6
    it('should correctly detect IPv4-mapped IPv6 addresses', () => {
        expect(net_utils.is_private('::ffff:10.0.0.1')).toBe(true);
        expect(net_utils.is_private('::ffff:8.8.8.8')).toBe(false);
        expect(net_utils.is_private('::ffff:192.168.1.1')).toBe(true);
    });

    // Invalid addresses
    it('should return false for invalid addresses', () => {
        expect(net_utils.is_private('invalid')).toBe(false);
        expect(net_utils.is_private('300.300.300.300')).toBe(false);
        expect(net_utils.is_private('::gggg')).toBe(false);
    });

    it('should return true for public addresses or false for private addresses', () => {
        expect(net_utils.is_public('10.0.0.1')).toBe(false);
        expect(net_utils.is_public('172.16.0.1')).toBe(false);
        expect(net_utils.is_public('192.168.1.1')).toBe(false);
        expect(net_utils.is_public('8.8.8.8')).toBe(true);
        expect(net_utils.is_public('1.1.1.1')).toBe(true);
        expect(net_utils.is_public('2001:db8::1')).toBe(true);
    });

    it('should return a 4-byte buffer for IPv4', () => {
        const buf = net_utils.ip_to_buffer_safe('192.168.1.1');
        expect(buf).toBeInstanceOf(Buffer);
        expect(buf.length).toBe(4);
        expect(buf).toEqual(Buffer.from([192, 168, 1, 1]));
    });

    it('should return a 16-byte buffer for IPv6', () => {
        const buf = net_utils.ip_to_buffer_safe('::1');
        expect(buf).toBeInstanceOf(Buffer);
        expect(buf.length).toBe(16);
        // Loopback IPv6 is all zeros except last byte
        expect(buf[15]).toBe(1);
    });

    it('should return null for invalid IP', () => {
        expect(net_utils.ip_to_buffer_safe('invalid')).toBeNull();
        expect(net_utils.ip_to_buffer_safe('300.300.300.300')).toBeNull();
        expect(net_utils.ip_to_buffer_safe('::gggg')).toBeNull();
    });

    // IPv4 equality
    it('should return true for identical IPv4 addresses', () => {
        expect(net_utils.is_equal('192.168.1.1', '192.168.1.1')).toBe(true);
    });

    it('should return false for different IPv4 addresses', () => {
        expect(net_utils.is_equal('192.168.1.1', '192.168.1.2')).toBe(false);
    });

    // IPv6 equality
    it('should return true for identical IPv6 addresses', () => {
        expect(net_utils.is_equal('::1', '::1')).toBe(true);
    });

    it('should return false for different IPv6 addresses', () => {
        expect(net_utils.is_equal('::1', '::2')).toBe(false);
    });

    // IPv4 vs IPv6-mapped IPv4
    it('should return true for IPv4 and its IPv6-mapped equivalent', () => {
        expect(net_utils.is_equal('127.0.0.1', '::ffff:127.0.0.1')).toBe(true);
        expect(net_utils.is_equal('192.168.1.1', '::ffff:192.168.1.1')).toBe(true);
    });

    it('should return false for IPv4 and non-matching IPv6-mapped address', () => {
        expect(net_utils.is_equal('192.168.1.1', '::ffff:192.168.1.2')).toBe(false);
    });

    // Invalid IPs
    it('should return false if either address is invalid', () => {
        expect(net_utils.is_equal('invalid', '192.168.1.1')).toBe(false);
        expect(net_utils.is_equal('192.168.1.1', 'invalid')).toBe(false);
        expect(net_utils.is_equal('invalid', 'also.invalid')).toBe(false);
    });

    // Mixed IPv4 and IPv6
    it('should return false for IPv4 and unrelated IPv6', () => {
        expect(net_utils.is_equal('192.168.1.1', '::1')).toBe(false);
    });

});

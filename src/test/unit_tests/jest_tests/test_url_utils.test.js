/* Copyright (C) 2016 NooBaa */
'use strict';

const { construct_url } = require('../../../util/url_utils');


describe('test url_utils.js', () => {

    describe('construct_url', () => {
        it('should construct a valid URL', () => {
            const def = {
                protocol: 'https',
                hostname: 'localhost',
                port: 3000
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('https://localhost:3000/');
        });

        it('should throw an error when hostname is missing', () => {
            const def = {
                protocol: 'http',
                port: 3000
            };
            expect(() => construct_url(def)).toThrow('Invalid definition, hostname is mandatory');
        });

        it('should construct a valid URL with default protocol', () => {
            const def = {
                hostname: 'localhost',
                port: 3000
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://localhost:3000/');
        });

        it('should construct a valid URL with IPV6 hostname', () => {
            const def = {
                hostname: '2403:4800:54:710::eea',
                port: 3000
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://[2403:4800:54:710::eea]:3000/');
        });

        it('should construct a valid URL with IPV6 and hostname wrapped', () => {
            const def = {
                hostname: '[2403:4800:54:710::eea]',
                port: 3000
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://[2403:4800:54:710::eea]:3000/');
        });

        it('should construct a valid URL with default protocol and no port', () => {
            const def = {
                hostname: 'localhost'
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://localhost/');
        });

        it('should construct a valid URL with default protocol and no port and IPV6 hostname', () => {
            const def = {
                hostname: '2403:4800:54:710::eea'
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://[2403:4800:54:710::eea]/');
        });

        it('should construct a valid URL with IPV4 hostname', () => {
            const def = {
                hostname: '127.0.0.1'
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://127.0.0.1/');
        });

        it('should construct a valid URL with IPV4 hostname and port', () => {
            const def = {
                hostname: '127.0.0.1',
                port: 443
            };
            const url = construct_url(def);
            expect(url.toString()).toBe('http://127.0.0.1:443/');
        });
    });

});

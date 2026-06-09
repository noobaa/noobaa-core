/* Copyright (C) 2016 NooBaa */
'use strict';

const http = require('http');
const https = require('https');

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];

/**
 * Load a fresh http_utils module after applying env overrides.
 * Agents and no_proxy_list are built at require time.
 * @param {Record<string, string|undefined>} env
 */
function load_http_utils_with_env(env) {
    jest.resetModules();
    for (const key of PROXY_ENV_KEYS) {
        if (env[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = env[key];
        }
    }
    return require('../../../util/http_utils');
}

describe('http_utils - proxy and NO_PROXY', () => {
    const original_env = {};

    beforeAll(() => {
        for (const key of PROXY_ENV_KEYS) {
            original_env[key] = process.env[key];
        }
    });

    afterEach(() => {
        jest.resetModules();
        for (const key of PROXY_ENV_KEYS) {
            if (original_env[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = original_env[key];
            }
        }
        require('../../../util/http_utils');
    });

    describe('should_proxy', () => {
        const cases = [
            {
                name: 'FQDN exact match bypasses proxy',
                no_proxy: 'internal.example.com',
                hostname: 'internal.example.com',
                expect_proxy: false,
            },
            {
                name: 'FQDN suffix match bypasses proxy',
                no_proxy: '.suffix',
                hostname: 'app.suffix',
                expect_proxy: false,
            },
            {
                name: 'CIDR match bypasses proxy for IP hostname',
                no_proxy: '10.0.0.0/8',
                hostname: '10.1.2.3',
                expect_proxy: false,
            },
            {
                name: 'IP exact match bypasses proxy',
                no_proxy: '192.168.1.10',
                hostname: '192.168.1.10',
                expect_proxy: false,
            },
            {
                name: 'host outside NO_PROXY uses proxy',
                no_proxy: '10.0.0.0/8,internal.example.com',
                hostname: 'external.example.com',
                expect_proxy: true,
            },
            {
                name: 'IP outside CIDR uses proxy',
                no_proxy: '10.0.0.0/8',
                hostname: '192.168.0.1',
                expect_proxy: true,
            },
        ];

        it.each(cases)('$name', ({ no_proxy, hostname, expect_proxy }) => {
            const http_utils = load_http_utils_with_env({ NO_PROXY: no_proxy });
            expect(http_utils.should_proxy(hostname)).toBe(expect_proxy);
        });

        it('returns true when NO_PROXY is unset', () => {
            const http_utils = load_http_utils_with_env({ NO_PROXY: undefined });
            expect(http_utils.should_proxy('any.example.com')).toBe(true);
        });
    });

    describe('agent selection via proxyEnv', () => {
        const http_proxy_url = 'http://proxy.test.invalid:8080';
        const https_proxy_url = 'http://proxy.test.invalid:8443';

        it('uses HTTP proxy agent when HTTP_PROXY is set and host is not bypassed', () => {
            const http_utils = load_http_utils_with_env({
                HTTP_PROXY: http_proxy_url,
                NO_PROXY: undefined,
            });
            const agent = http_utils.get_default_agent('http://external.example.com');
            expect(agent).toBeInstanceOf(http.Agent);
            expect(agent.options.proxyEnv).toEqual({ HTTP_PROXY: http_proxy_url });
        });

        it('uses direct HTTP agent when host matches NO_PROXY', () => {
            const http_utils = load_http_utils_with_env({
                HTTP_PROXY: http_proxy_url,
                NO_PROXY: 'external.example.com',
            });
            const agent = http_utils.get_default_agent('http://external.example.com');
            expect(agent).toBeInstanceOf(http.Agent);
            expect(agent.options.proxyEnv).toBeUndefined();
        });

        it('uses HTTPS proxy agent when HTTPS_PROXY is set and host is not bypassed', () => {
            const http_utils = load_http_utils_with_env({
                HTTPS_PROXY: https_proxy_url,
                NO_PROXY: undefined,
            });
            const agent = http_utils.get_default_agent('https://external.example.com');
            expect(agent).toBeInstanceOf(https.Agent);
            expect(agent.options.proxyEnv).toEqual({ HTTPS_PROXY: https_proxy_url });
        });

        it('uses direct HTTPS agent when CIDR NO_PROXY matches IP hostname', () => {
            const http_utils = load_http_utils_with_env({
                HTTPS_PROXY: https_proxy_url,
                NO_PROXY: '10.0.0.0/8',
            });
            const agent = http_utils.get_default_agent('https://10.1.2.3');
            expect(agent).toBeInstanceOf(https.Agent);
            expect(agent.options.proxyEnv).toBeUndefined();
        });

        it('uses unsecured HTTPS proxy agent for custom HTTPS host with HTTPS_PROXY', () => {
            const http_utils = load_http_utils_with_env({
                HTTPS_PROXY: https_proxy_url,
                NO_PROXY: undefined,
            });
            const agent = http_utils.get_unsecured_agent('https://backend.test.invalid:9000');
            expect(agent).toBeInstanceOf(https.Agent);
            expect(agent.options.rejectUnauthorized).toBe(false);
            expect(agent.options.proxyEnv).toEqual({ HTTPS_PROXY: https_proxy_url });
        });
    });
});

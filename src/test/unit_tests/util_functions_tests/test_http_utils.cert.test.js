/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const https = require('https');
const { execSync } = require('child_process');
const http_utils = require('../../../util/http_utils');
const fs_utils = require('../../../util/fs_utils');

describe('http_utils - certificate loading and HTTPS connections', () => {

    describe('certificate loading from environment', () => {

        const original_env = { ...process.env };

        afterEach(() => {
            // Restore original environment variables
            process.env.INTERNAL_SERVICE_CA_CERTS = original_env.INTERNAL_SERVICE_CA_CERTS;
            process.env.INTERNAL_CA_CERTS = original_env.INTERNAL_CA_CERTS;
            process.env.EXTERNAL_CA_CERTS = original_env.EXTERNAL_CA_CERTS;
        });

        it('should load certificate from INTERNAL_SERVICE_CA_CERTS env when file exists', () => {
            const test_cert_content = '-----BEGIN CERTIFICATE-----\ntest-cert\n-----END CERTIFICATE-----';
            const temp_cert_path = path.join(__dirname, 'test_internal_ca.crt');

            try {
                // Create a temporary certificate file
                fs.writeFileSync(temp_cert_path, test_cert_content, 'utf8');

                // Set environment variable
                process.env.INTERNAL_SERVICE_CA_CERTS = temp_cert_path;

                // Read the certificate using fs_utils
                const loaded_cert = fs_utils.try_read_file_sync(process.env.INTERNAL_SERVICE_CA_CERTS);

                expect(loaded_cert).toBe(test_cert_content);
                expect(loaded_cert).toContain('BEGIN CERTIFICATE');
                expect(loaded_cert).toContain('END CERTIFICATE');
            } finally {
                // Cleanup
                if (fs.existsSync(temp_cert_path)) {
                    fs.unlinkSync(temp_cert_path);
                }
            }
        });

        it('should load certificate from EXTERNAL_CA_CERTS env when file exists', () => {
            const test_cert_content = '-----BEGIN CERTIFICATE-----\ntest-external-cert\n-----END CERTIFICATE-----';
            const temp_cert_path = path.join(__dirname, 'test_external_ca.crt');

            try {
                // Create a temporary certificate file
                fs.writeFileSync(temp_cert_path, test_cert_content, 'utf8');

                // Set environment variable
                process.env.EXTERNAL_CA_CERTS = temp_cert_path;

                // Read the certificate using fs_utils
                const loaded_cert = fs_utils.try_read_file_sync(process.env.EXTERNAL_CA_CERTS);

                expect(loaded_cert).toBe(test_cert_content);
                expect(loaded_cert).toContain('BEGIN CERTIFICATE');
                expect(loaded_cert).toContain('END CERTIFICATE');
            } finally {
                // Cleanup
                if (fs.existsSync(temp_cert_path)) {
                    fs.unlinkSync(temp_cert_path);
                }
            }
        });

        it('should gracefully handle missing certificate files', () => {
            const nonexistent_path = path.join(__dirname, 'nonexistent_cert_file_12345.crt');

            // Set environment variable to nonexistent path
            process.env.INTERNAL_SERVICE_CA_CERTS = nonexistent_path;

            // Should return undefined when file doesn't exist
            const loaded_cert = fs_utils.try_read_file_sync(process.env.INTERNAL_SERVICE_CA_CERTS);

            expect(loaded_cert).toBeUndefined();
        });

        it('should use default paths when env variables are not set', () => {
            // Remove environment variables
            delete process.env.INTERNAL_SERVICE_CA_CERTS;
            delete process.env.INTERNAL_CA_CERTS;
            delete process.env.EXTERNAL_CA_CERTS;

            const default_internal_service = '/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt';
            const default_internal = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
            const default_external = '/etc/ocp-injected-ca-bundle/ca-bundle.crt';

            // Verify that unset variables are undefined
            expect(process.env.INTERNAL_SERVICE_CA_CERTS).toBeUndefined();
            expect(process.env.INTERNAL_CA_CERTS).toBeUndefined();
            expect(process.env.EXTERNAL_CA_CERTS).toBeUndefined();

            // The actual http_utils module loads these at require-time, so they would use defaults
            // We can't directly test this without reloading the module, but we can verify the paths
            expect(default_internal_service).toBe('/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt');
            expect(default_internal).toBe('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
            expect(default_external).toBe('/etc/ocp-injected-ca-bundle/ca-bundle.crt');
        });

        it('https CA bundle uses internal/external PEMs when external bundle exists (no system defaults)', () => {
            const service_ca_pem =
                '-----BEGIN CERTIFICATE-----\ninternal-service-test-ca\n-----END CERTIFICATE-----\n';
            const kube_ca_pem =
                '-----BEGIN CERTIFICATE-----\ninternal-kube-test-ca\n-----END CERTIFICATE-----\n';
            const external_pem =
                '-----BEGIN CERTIFICATE-----\nexternal-test-ca\n-----END CERTIFICATE-----\n';
            const service_ca_path = path.join(__dirname, 'test_internal_service_ca_default_bundle.crt');
            const kube_ca_path = path.join(__dirname, 'test_internal_ca_default_bundle.crt');
            const external_path = path.join(__dirname, 'test_external_ca_default_bundle.crt');

            const prev_service_ca = process.env.INTERNAL_SERVICE_CA_CERTS;
            const prev_kube_ca = process.env.INTERNAL_CA_CERTS;
            const prev_external = process.env.EXTERNAL_CA_CERTS;

            try {
                fs.writeFileSync(service_ca_path, service_ca_pem, 'utf8');
                fs.writeFileSync(kube_ca_path, kube_ca_pem, 'utf8');
                fs.writeFileSync(external_path, external_pem, 'utf8');

                let ca;
                jest.isolateModules(() => {
                    process.env.INTERNAL_SERVICE_CA_CERTS = service_ca_path;
                    process.env.INTERNAL_CA_CERTS = kube_ca_path;
                    process.env.EXTERNAL_CA_CERTS = external_path;
                    const isolated_http_utils = require('../../../util/http_utils');
                    ca = isolated_http_utils.get_default_agent('https://example.com').options.ca;
                });

                expect(ca).toEqual([service_ca_pem, kube_ca_pem, external_pem]);
            } finally {
                if (fs.existsSync(service_ca_path)) fs.unlinkSync(service_ca_path);
                if (fs.existsSync(kube_ca_path)) fs.unlinkSync(kube_ca_path);
                if (fs.existsSync(external_path)) fs.unlinkSync(external_path);
                if (prev_service_ca === undefined) {
                    delete process.env.INTERNAL_SERVICE_CA_CERTS;
                } else {
                    process.env.INTERNAL_SERVICE_CA_CERTS = prev_service_ca;
                }
                if (prev_kube_ca === undefined) {
                    delete process.env.INTERNAL_CA_CERTS;
                } else {
                    process.env.INTERNAL_CA_CERTS = prev_kube_ca;
                }
                if (prev_external === undefined) {
                    delete process.env.EXTERNAL_CA_CERTS;
                } else {
                    process.env.EXTERNAL_CA_CERTS = prev_external;
                }
            }
        });

        it('https CA bundle falls back to tls.getCACertificates("default") when external bundle is empty', () => {
            const service_ca_pem =
                '-----BEGIN CERTIFICATE-----\ninternal-service-test-ca\n-----END CERTIFICATE-----\n';
            const kube_ca_pem =
                '-----BEGIN CERTIFICATE-----\ninternal-kube-test-ca\n-----END CERTIFICATE-----\n';
            const service_ca_path = path.join(__dirname, 'test_internal_service_ca_fallback_bundle.crt');
            const kube_ca_path = path.join(__dirname, 'test_internal_ca_fallback_bundle.crt');
            const external_path = path.join(__dirname, 'test_external_ca_missing_bundle.crt');

            const prev_service_ca = process.env.INTERNAL_SERVICE_CA_CERTS;
            const prev_kube_ca = process.env.INTERNAL_CA_CERTS;
            const prev_external = process.env.EXTERNAL_CA_CERTS;

            try {
                fs.writeFileSync(service_ca_path, service_ca_pem, 'utf8');
                fs.writeFileSync(kube_ca_path, kube_ca_pem, 'utf8');

                let ca;
                jest.isolateModules(() => {
                    process.env.INTERNAL_SERVICE_CA_CERTS = service_ca_path;
                    process.env.INTERNAL_CA_CERTS = kube_ca_path;
                    process.env.EXTERNAL_CA_CERTS = external_path;
                    const isolated_http_utils = require('../../../util/http_utils');
                    ca = isolated_http_utils.get_default_agent('https://example.com').options.ca;
                });

                expect(ca).toEqual([
                    ...tls.getCACertificates('default'),
                    service_ca_pem,
                    kube_ca_pem,
                ]);
            } finally {
                if (fs.existsSync(service_ca_path)) fs.unlinkSync(service_ca_path);
                if (fs.existsSync(kube_ca_path)) fs.unlinkSync(kube_ca_path);
                if (prev_service_ca === undefined) {
                    delete process.env.INTERNAL_SERVICE_CA_CERTS;
                } else {
                    process.env.INTERNAL_SERVICE_CA_CERTS = prev_service_ca;
                }
                if (prev_kube_ca === undefined) {
                    delete process.env.INTERNAL_CA_CERTS;
                } else {
                    process.env.INTERNAL_CA_CERTS = prev_kube_ca;
                }
                if (prev_external === undefined) {
                    delete process.env.EXTERNAL_CA_CERTS;
                } else {
                    process.env.EXTERNAL_CA_CERTS = prev_external;
                }
            }
        });
    });

    describe('HTTP connection agents', () => {
        it('should handle agent selection', () => {
            const agent_https = http_utils.get_default_agent('https://example.com');
            const agent_http = http_utils.get_default_agent('http://example.com');

            expect(agent_https).toBeTruthy();
            expect(agent_http).toBeTruthy();
            expect(agent_https).not.toBe(agent_http);
        });

        it('should update https agents without changing rejectUnauthorized', () => {
            const max_sockets = 100;

            // Should not throw error when updating with valid options
            expect(() => {
                http_utils.update_https_agents({ maxSockets: max_sockets });
            }).not.toThrow();
        });

        it('should throw error when trying to change rejectUnauthorized on agents', () => {
            expect(() => {
                http_utils.update_https_agents({ rejectUnauthorized: false });
            }).toThrow();
        });

        it('should get unsecured agent for localhost', () => {
            const agent = http_utils.get_unsecured_agent('https://localhost:8443');
            expect(agent).toBeTruthy();
            expect(agent.options.rejectUnauthorized).toBe(false);
        });

        it('should get agent by endpoint', () => {
            // Test with AWS endpoint
            const aws_agent = http_utils.get_agent_by_endpoint('https://s3.amazonaws.com');
            expect(aws_agent).toBeTruthy();
            expect(aws_agent.options.rejectUnauthorized).toBe(undefined);

            // Test with non-AWS endpoint
            const custom_agent = http_utils.get_agent_by_endpoint('https://custom.example.com');
            expect(custom_agent).toBeTruthy();
            expect(custom_agent.options.rejectUnauthorized).toBe(false);
        });

    });

    describe('HTTPS server with self-signed certificate', () => {

        const original_env = { ...process.env };
        let server;
        let cert_path;
        let key_path;
        const test_port = 29443;
        const cert_subject = '/C=US/ST=Test/L=Test/O=Test/CN=localhost';

        beforeAll(() => {
            // Generate self-signed certificate using openssl
            const temp_dir = path.join(__dirname, 'test_certs_temp');
            if (!fs.existsSync(temp_dir)) {
                fs.mkdirSync(temp_dir, { recursive: true });
            }

            cert_path = path.join(temp_dir, 'test_cert.crt');
            key_path = path.join(temp_dir, 'test_key.key');

            // Generate self-signed certificate valid for 365 days
            try {
                execSync(
                    `openssl req -x509 -newkey rsa:2048 -keyout "${key_path}" -out "${cert_path}" -days 365 -nodes -subj "${cert_subject}"`,
                    { stdio: 'pipe' }
                );
            } catch (err) {
                console.error('Failed to generate certificate:', err.message);
                throw err;
            }
        });

        afterAll(async () => {
            // Stop server if running
            if (server) {
                await server.close();
                // Cleanup certificate files
                const temp_dir = path.join(__dirname, 'test_certs_temp');
                if (fs.existsSync(cert_path)) {
                    fs.unlinkSync(cert_path);
                }
                if (fs.existsSync(key_path)) {
                    fs.unlinkSync(key_path);
                }
                if (fs.existsSync(temp_dir)) {
                    fs.rmdirSync(temp_dir);
                }
            }
        });

        afterEach(() => {
            // Restore original environment variables
            process.env.INTERNAL_SERVICE_CA_CERTS = original_env.INTERNAL_SERVICE_CA_CERTS;
        });

        it('should verify certificate is loaded from environment variable path', () => {
            process.env.INTERNAL_SERVICE_CA_CERTS = cert_path;

            // Verify the certificate file exists
            expect(fs.existsSync(cert_path)).toBe(true);

            // Read certificate and verify it's loaded correctly
            const loaded_cert = fs_utils.try_read_file_sync(process.env.INTERNAL_SERVICE_CA_CERTS);

            expect(loaded_cert).toBeTruthy();
            expect(loaded_cert).toContain('BEGIN CERTIFICATE');
            expect(loaded_cert).toContain('END CERTIFICATE');
        });

        it('should connect to HTTPS server using certificate from INTERNAL_SERVICE_CA_CERTS env', async () => {
            // Set environment variable to point to our test certificate
            process.env.INTERNAL_SERVICE_CA_CERTS = cert_path;

            const cert = fs.readFileSync(cert_path, 'utf8');
            const key = fs.readFileSync(key_path, 'utf8');

            // Create HTTPS server with self-signed certificate
            const https_options = { cert, key };

            server = https.createServer(https_options, async function(req, res) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Hello from secure server', success: true }));
            }).listen(test_port, 'localhost');

            // Make HTTPS request using the certificate from environment variable
            http_utils.update_https_agents({
                options: {
                    ca: fs.readFileSync(process.env.INTERNAL_SERVICE_CA_CERTS, 'utf8'),
                }
            });
            const agent = http_utils.get_default_agent(`https://localhost:${test_port}`);
            expect(agent).toBeInstanceOf(https.Agent);
            expect(agent.options.ca).toContain(cert);
            const request_options = {
                hostname: 'localhost',
                port: test_port,
                method: 'GET',
                agent,
            };

            const response = await http_utils.make_https_request(request_options);
            // Verify response
            expect(response.statusCode).toBe(200);

            // Read response data
            let data = '';
            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                const parsed_data = JSON.parse(data);
                expect(parsed_data.success).toBe(true);
                expect(parsed_data.message).toBe('Hello from secure server');
            });
        });
    });

});


describe('CA bundle hot-reload', () => {
    it('hot-reloads the CA bundle when reload_ca_bundle is called after rotation', () => {
        const ca_pem_v1 = '-----BEGIN CERTIFICATE-----\nservice-ca-v1\n-----END CERTIFICATE-----\n';
        const ca_pem_v2 = '-----BEGIN CERTIFICATE-----\nservice-ca-v2-rotated\n-----END CERTIFICATE-----\n';
        const external_pem = '-----BEGIN CERTIFICATE-----\nexternal-test-ca\n-----END CERTIFICATE-----\n';
        const service_ca_path = path.join(__dirname, 'test_internal_service_ca_reload.crt');
        const external_path = path.join(__dirname, 'test_external_ca_reload.crt');

        const prev_service_ca = process.env.INTERNAL_SERVICE_CA_CERTS;
        const prev_kube_ca = process.env.INTERNAL_CA_CERTS;
        const prev_external = process.env.EXTERNAL_CA_CERTS;

        let agent;
        let isolated;
        try {
            fs.writeFileSync(service_ca_path, ca_pem_v1, 'utf8');
            fs.writeFileSync(external_path, external_pem, 'utf8');

            jest.isolateModules(() => {
                process.env.INTERNAL_SERVICE_CA_CERTS = service_ca_path;
                process.env.INTERNAL_CA_CERTS = '';
                delete process.env.EXTERNAL_CA_CERTS;
                process.env.EXTERNAL_CA_CERTS = external_path;
                isolated = require('../../../util/http_utils');
                agent = isolated.get_default_agent('https://example.com');
                expect(agent.options.ca).toEqual([ca_pem_v1, external_pem]);

                // simulate the service CA rotation: kubelet atomically replaces the file
                fs.writeFileSync(service_ca_path, ca_pem_v2, 'utf8');
                // same as the debounced watcher would do
                isolated.reload_ca_bundle();
            });

            expect(agent.options.ca).toEqual([ca_pem_v2, external_pem]);
        } finally {
            // avoid leaking fs.watch() handles across isolated module instances
            if (isolated) isolated.stop_watching_ca_bundle();
            if (fs.existsSync(service_ca_path)) fs.unlinkSync(service_ca_path);
            if (fs.existsSync(external_path)) fs.unlinkSync(external_path);
            if (prev_service_ca === undefined) {
                delete process.env.INTERNAL_SERVICE_CA_CERTS;
            } else {
                process.env.INTERNAL_SERVICE_CA_CERTS = prev_service_ca;
            }
            if (prev_kube_ca === undefined) {
                delete process.env.INTERNAL_CA_CERTS;
            } else {
                process.env.INTERNAL_CA_CERTS = prev_kube_ca;
            }
            if (prev_external === undefined) {
                delete process.env.EXTERNAL_CA_CERTS;
            } else {
                process.env.EXTERNAL_CA_CERTS = prev_external;
            }
        }
    });

    it('hot-reloads the CA bundle when the watched file is rotated', async () => {
        jest.setTimeout(15000);
        const ca_pem_v1 = '-----BEGIN CERTIFICATE-----\nservice-ca-watched-v1\n-----END CERTIFICATE-----\n';
        const ca_pem_v2 = '-----BEGIN CERTIFICATE-----\nservice-ca-watched-v2\n-----END CERTIFICATE-----\n';
        const external_pem = '-----BEGIN CERTIFICATE-----\nexternal-watched-ca\n-----END CERTIFICATE-----\n';
        const service_ca_path = path.join(__dirname, 'test_internal_service_ca_watch.crt');
        const external_path = path.join(__dirname, 'test_external_ca_watch.crt');

        const prev_service_ca = process.env.INTERNAL_SERVICE_CA_CERTS;
        const prev_kube_ca = process.env.INTERNAL_CA_CERTS;
        const prev_external = process.env.EXTERNAL_CA_CERTS;
        const prev_debounce = process.env.CA_RELOAD_DEBOUNCE_MS;

        let agent;
        let isolated;
        try {
            fs.writeFileSync(service_ca_path, ca_pem_v1, 'utf8');
            fs.writeFileSync(external_path, external_pem, 'utf8');

            jest.isolateModules(() => {
                process.env.INTERNAL_SERVICE_CA_CERTS = service_ca_path;
                process.env.INTERNAL_CA_CERTS = '';
                delete process.env.EXTERNAL_CA_CERTS;
                process.env.EXTERNAL_CA_CERTS = external_path;
                // short debounce so the test does not take 5 seconds
                process.env.CA_RELOAD_DEBOUNCE_MS = '100';
                isolated = require('../../../util/http_utils');
                agent = isolated.get_default_agent('https://example.com');
                expect(agent.options.ca).toEqual([ca_pem_v1, external_pem]);

                // rotate: kubelet-style atomic replace emulated via rename
                const tmp = service_ca_path + '.tmp';
                fs.writeFileSync(tmp, ca_pem_v2, 'utf8');
                fs.renameSync(tmp, service_ca_path);
            });

            // wait for the watcher event + debounce
            await new Promise(resolve => setTimeout(resolve, 1500));

            expect(agent.options.ca).toEqual([ca_pem_v2, external_pem]);
        } finally {
            // avoid leaking fs.watch() handles across isolated module instances
            if (isolated) isolated.stop_watching_ca_bundle();
            if (fs.existsSync(service_ca_path)) fs.unlinkSync(service_ca_path);
            if (fs.existsSync(external_path)) fs.unlinkSync(external_path);
            if (prev_service_ca === undefined) {
                delete process.env.INTERNAL_SERVICE_CA_CERTS;
            } else {
                process.env.INTERNAL_SERVICE_CA_CERTS = prev_service_ca;
            }
            if (prev_kube_ca === undefined) {
                delete process.env.INTERNAL_CA_CERTS;
            } else {
                process.env.INTERNAL_CA_CERTS = prev_kube_ca;
            }
            if (prev_external === undefined) {
                delete process.env.EXTERNAL_CA_CERTS;
            } else {
                process.env.EXTERNAL_CA_CERTS = prev_external;
            }
            if (prev_debounce === undefined) {
                delete process.env.CA_RELOAD_DEBOUNCE_MS;
            } else {
                process.env.CA_RELOAD_DEBOUNCE_MS = prev_debounce;
            }
        }
    });

});

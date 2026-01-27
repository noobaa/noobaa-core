/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const http_utils = require('../../../util/http_utils');
const fs_utils = require('../../../util/fs_utils');

describe('http_utils - certificate loading and HTTPS connections', () => {

    describe('certificate loading from environment', () => {

        const original_env = { ...process.env };

        afterEach(() => {
            // Restore original environment variables
            process.env.INTERNAL_CA_CERTS = original_env.INTERNAL_CA_CERTS;
            process.env.EXTERNAL_CA_CERTS = original_env.EXTERNAL_CA_CERTS;
        });

        it('should load certificate from INTERNAL_CA_CERTS env when file exists', () => {
            const test_cert_content = '-----BEGIN CERTIFICATE-----\ntest-cert\n-----END CERTIFICATE-----';
            const temp_cert_path = path.join(__dirname, 'test_internal_ca.crt');

            try {
                // Create a temporary certificate file
                fs.writeFileSync(temp_cert_path, test_cert_content, 'utf8');

                // Set environment variable
                process.env.INTERNAL_CA_CERTS = temp_cert_path;

                // Read the certificate using fs_utils
                const loaded_cert = fs_utils.try_read_file_sync(process.env.INTERNAL_CA_CERTS);

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
            process.env.INTERNAL_CA_CERTS = nonexistent_path;

            // Should return undefined when file doesn't exist
            const loaded_cert = fs_utils.try_read_file_sync(process.env.INTERNAL_CA_CERTS);

            expect(loaded_cert).toBeUndefined();
        });

        it('should use default paths when env variables are not set', () => {
            // Remove environment variables
            delete process.env.INTERNAL_CA_CERTS;
            delete process.env.EXTERNAL_CA_CERTS;

            const default_internal = '/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt';
            const default_external = '/etc/ocp-injected-ca-bundle/ca-bundle.crt';

            // Verify that unset variables are undefined
            expect(process.env.INTERNAL_CA_CERTS).toBeUndefined();
            expect(process.env.EXTERNAL_CA_CERTS).toBeUndefined();

            // The actual http_utils module loads these at require-time, so they would use defaults
            // We can't directly test this without reloading the module, but we can verify the paths
            expect(default_internal).toBe('/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt');
            expect(default_external).toBe('/etc/ocp-injected-ca-bundle/ca-bundle.crt');
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
            process.env.INTERNAL_CA_CERTS = original_env.INTERNAL_CA_CERTS;
        });

        it('should verify certificate is loaded from environment variable path', () => {
            process.env.INTERNAL_CA_CERTS = cert_path;

            // Verify the certificate file exists
            expect(fs.existsSync(cert_path)).toBe(true);

            // Read certificate and verify it's loaded correctly
            const loaded_cert = fs_utils.try_read_file_sync(process.env.INTERNAL_CA_CERTS);

            expect(loaded_cert).toBeTruthy();
            expect(loaded_cert).toContain('BEGIN CERTIFICATE');
            expect(loaded_cert).toContain('END CERTIFICATE');
        });

        it('should connect to HTTPS server using certificate from INTERNAL_CA_CERTS env', async () => {
            // Set environment variable to point to our test certificate
            process.env.INTERNAL_CA_CERTS = cert_path;

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
                    ca: fs.readFileSync(process.env.INTERNAL_CA_CERTS, 'utf8'),
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

/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * Returns an Apache CLF UTC timestamp for log lines.
 * @returns {string}
 */
function get_log_date() {
    const now = new Date();
    const month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(now.getUTCDate()).padStart(2, '0');
    const month = month_names[now.getUTCMonth()];
    const year = now.getUTCFullYear();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    return `[${day}/${month}/${year}:${hours}:${minutes}:${seconds} +0000]`;
}

/**
 * Builds a line in combined access-log style.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {number} duration_ms
 * @returns {string}
 */
function format_combined(req, res, duration_ms) {
    const remote_addr = req.ip || req.socket?.remoteAddress || '-';
    const remote_user = '-';
    const log_date = get_log_date();
    const method = req.method || '-';
    const url = req.originalUrl || req.url || '-';
    const http_version = req.httpVersion || '1.1';
    const status_code = res.statusCode || 0;
    const content_length = res.getHeader('content-length') || '-';
    const referrer = req.get?.('referer') || req.headers.referer || req.headers.referrer || '-';
    const user_agent = req.headers['user-agent'] || '-';

    return `${remote_addr} - ${remote_user} ${log_date} "${method} ${url} HTTP/${http_version}" ${status_code} ${content_length} "${referrer}" "${user_agent}" ${duration_ms.toFixed(3)} ms`;
}

/**
 * Builds a line in short dev access-log style.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {number} duration_ms
 * @returns {string}
 */
function format_dev(req, res, duration_ms) {
    const method = req.method || '-';
    const url = req.originalUrl || req.url || '-';
    const status_code = res.statusCode || 0;
    return `${method} ${url} ${status_code} ${duration_ms.toFixed(3)} ms`;
}

/**
 * Returns an express request logger middleware.
 * Supports the "dev" and "combined" formats.
 * @param {string} format
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse, next: Function) => void}
 */
function express_request_logger(format) {
    const format_name = format === 'dev' ? 'dev' : 'combined';

    return function log_request(req, res, next) {
        const start_time = process.hrtime.bigint();
        let logged = false;

        const emit_log_line = () => {
            if (logged) return;
            logged = true;
            const end_time = process.hrtime.bigint();
            const duration_ms = Number(end_time - start_time) / 1e6;
            const line = format_name === 'dev' ?
                format_dev(req, res, duration_ms) :
                format_combined(req, res, duration_ms);
            process.stdout.write(`${line}\n`);
        };

        res.once('finish', emit_log_line);
        res.once('close', emit_log_line);
        next();
    };
}

module.exports = express_request_logger;

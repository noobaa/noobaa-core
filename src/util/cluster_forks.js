/* Copyright (C) 2023 NooBaa */
'use strict';

// these type hacks are needed because the type info from require is incorrect
const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */ (
        require('node:cluster')
    )
);

/**
 * 
 * @param {() => any} main 
 * @param {number?} forks 
 * @returns {Promise}
 */
async function main_with_forks(main, forks = 0) {
    if (cluster.isPrimary && forks > 0) {
        for (let i = 0; i < forks; ++i) {
            const worker = cluster.fork();
            console.warn('Worker start', worker.process.pid);
        }
        return new Promise((resolve, reject) => {
            cluster.on('exit', (worker, code, signal) => {
                reject(new Error(`worker exit ${worker.id} ${code} ${signal}`));
                // if (!Object.keys(cluster.workers).length) {}
            });
        });
    } else {
        return main();
    }
}

exports.cluster = cluster;
exports.main_with_forks = main_with_forks;

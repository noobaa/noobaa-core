/* Copyright (C) 2020 NooBaa */
'use strict';

const util = require('util');
const events = require('events');
const stream = require('stream');
const argv = require('minimist')(process.argv);
const stream_finished = util.promisify(stream.finished);

async function test(mode) {
    try {
        let r = 0;
        let w = 0;
        const t = Date.now();
        const N = 200000;
        const K = Math.floor(N / 10);

        const input = new stream.Readable({
            read(size) {
                setImmediate(() => {
                    if (r >= N) {
                        this.push(null);
                    } else {
                        r += 1;
                        this.push(Buffer.allocUnsafe(16));
                    }
                });
            }
        });

        const output = new stream.Writable({
            write(data, encoding, callback) {
                setImmediate(() => {
                    w += 1;
                    if (w % K === 0) {
                        const dt = (Date.now() - t) / 1000;
                        console.log(`${mode}: ${(100 * w / N).toFixed(0)}% speed ${(w / 1000 / dt).toFixed(1)} K-items/sec`);
                    }
                    callback();
                });
            },
        });

        console.log(`${mode}: starting ...`);

        if (mode === 'pipe') {

            input.pipe(output);

        } else if (mode === 'events') {

            input.on('data', async data => {
                if (output.write(data)) return;
                input.pause();
                await events.once(output, 'drain');
                input.resume();
            });
            input.on('end', () => output.end());

        } else if (mode === 'forawait') {

            for await (const data of input) {
                if (!output.write(data)) {
                    await events.once(output, 'drain');
                }
            }
            output.end();

        }

        await stream_finished(output);
        console.log(`${mode}: done.`);

    } catch (err) {
        console.error(err);
    }
}

async function main() {
    console.log(argv);
    await test('pipe');
    await test('events');
    await test('forawait');
}

main();

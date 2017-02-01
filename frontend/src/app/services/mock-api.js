import { sleep } from 'utils/promise-utils';
import { makeArray, deepClone, isUndefined } from 'utils/core-utils';

// const texts = [
//     'Pool my.pool capacity usage us over 90%, please add more nodes to to to to to gain capacity',
//     'Bucket archive.bucket faild to upload 22 files - not enough free datacapacity. Please add nore pools to data placement policy or nore nodes to participant pools',
//     'A new version of NooBaa is now availalble, download 0.6.1 version',
//     'Pool default.pool is currently running on less then 60% online nodes, please check nodes connectivity.'
// ];

const severities = ['CRIT', 'MAJOR', 'INFO'];
const alerts = makeArray(400, i => {
    return {
        id: i,
        // text: texts[Math.random() * texts.length | 0],
        text: `Alert ${i}`,
        severity: severities[Math.random() * severities.length | 0],
        time: Date.now(),
        read: Boolean(Math.round(Math.random()))
    };
}).reverse();

async function read_alerts({ severity, read, till, limit }) {
    await sleep(2000);

    if (Math.round(Math.random())) throw new Error('load error');

    return deepClone(
        alerts
            .filter(item => _matchs(item, { severity, read, till }))
            .slice(0, limit)
    );
}

async function mark_alerts_read({ filter, state }) {
    await  sleep(2000);
    alerts
        .filter(item =>  _matchs(item, filter))
        .map(item => item.read = state);
}

function _matchs(item, { ids, severity, read, till }) {
    return (isUndefined(till) || item.id < till) &&
        (isUndefined(ids) || ids.includes(item.id)) &&
        (isUndefined(severity) || item.severity === severity) &&
        (isUndefined(read) || item.read === read);
}

export default {
    events: {
        read_alerts,
        mark_alerts_read
    }
};

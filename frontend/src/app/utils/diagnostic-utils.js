/* Copyright (C) 2016 NooBaa */

import moment from 'moment';

export function formatTimeLeftForDebugMode(debugState, timeLeft) {
    if (!debugState) {
        return 'None';

    } else  if (timeLeft == null) {
        return 'Calculating...';

    } else {
        const duration = moment.duration(timeLeft);
        const minutes = String(duration.minutes()).padStart(2, 0);
        const seconds = String(duration.seconds()).padStart(2, 0);
        return `${minutes}:${seconds} minutes`;
    }
}

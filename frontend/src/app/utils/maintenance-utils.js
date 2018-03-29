/* Copyright (C) 2018 NooBaa */

import moment from 'moment';

export function formatTimeLeftForMaintenanceMode(timeLeft) {
    if (!timeLeft) return;

    const duration = moment.duration(timeLeft);
    return `${
            String(duration.days()).padStart(2, 0)
        }:${
            String(duration.hours()).padStart(2, 0)
        }:${
            String(duration.minutes()).padStart(2, 0)
        }:${
            String(duration.seconds()).padStart(2, 0)
        }`;
}

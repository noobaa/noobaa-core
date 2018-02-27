/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { ensureArray } from 'utils/core-utils';

function _bubbleEvent(event) {
    if (event.bubbles) return;

    const EventType = event.constructor;
    const bublingEvent = new EventType(event.type, { ...event, bubbles: true });
    event.target.dispatchEvent(bublingEvent);
}

export default {
    init: function(element, valueAccessor) {
        const events = ensureArray(ko.unwrap(valueAccessor()))
            .map(val => val.toString());

        for (const event of events) {
            ko.utils.registerEventHandler(element, event, _bubbleEvent);
        }
    }
};

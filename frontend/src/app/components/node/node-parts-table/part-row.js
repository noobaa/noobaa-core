/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';

const partHealthMapping = Object.freeze({
    available: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Available'
    },
    building: {
        name: 'working',
        css: 'warning',
        tooltip: 'In process'
    },
    unavailable: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    }
});

export default class ObjectRowViewModel extends BaseViewModel {
    constructor(part) {

        super();

        this.state = ko.pureComputed(
            () => {
                if (!part()) {
                    return '';
                }

                let health = part().chunk.adminfo.health;
                return partHealthMapping[health];
            }
        );

        this.object = ko.pureComputed(
            () => {
                if (!part()) {
                    return '';
                }

                return {
                    text: part().object,
                    href: {
                        route: 'object',
                        params: {
                            bucket: part().bucket,
                            object: part().object,
                            tab: null
                        }
                    }
                };
            }
        );

        this.bucket = ko.pureComputed(
            () => part() ? part().bucket : ''
        );

        this.startOffset = ko.pureComputed(
            () => part() ? numeral(part().start).format('0.0 b') : ''
        );

        this.endOffset = ko.pureComputed(
            () => part() ? numeral(part().end).format('0.0 b') : ''
        );

        this.size = ko.pureComputed(
            () => part() ?
                numeral(part().end - part().start).format('0.0 b') :
                ''
        );
    }
}

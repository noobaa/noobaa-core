/* Copyright (C) 2016 NooBaa */

import template from './date-time-chooser.html';
import ko from 'knockout';
import moment from 'moment';
import { makeRange } from 'utils/core-utils';

class DateTimeChooserViewModel {
    constructor({ time, timezone }) {
        this.yearOptions = makeRange(
            moment().year() - 10, moment().year() + 10
        ).map(
            value => ({ label: value, value: value })
        );

        this.monthOptions = makeRange(12).map(
            month => ({
                label: moment({ month }).format('MMM'),
                value: month
            })
        );

        this.dayOptions = ko.pureComputed(
            () => {
                let lastDayOfMonth = moment({ year: this.year(), month: this.month() })
                    .endOf('month')
                    .date();

                return makeRange(1, lastDayOfMonth).map(
                    value => ({ label: value, value: value })
                );
            }
        );

        this.year = this.makePartComputed(time, timezone, 'year');
        this.month = this.makePartComputed(time, timezone, 'month');
        this.day = this.makePartComputed(time, timezone, 'date');

        this.hour = this.makePartComputed(time, timezone, 'hour')
            .extend({
                required: true,
                min: 0,
                max: 23
            });

        this.minute = this.makePartComputed(time, timezone, 'minute')
            .extend({
                required: true,
                min: 0,
                max: 59
            });

        this.second = this.makePartComputed(time, timezone, 'second')
            .extend({
                required: true,
                min: 0,
                max: 59
            });
    }

    makePartComputed(time, timezone, part) {
        return ko.pureComputed({
            read(){
                return moment.tz(time(), ko.unwrap(timezone))
                    .get(part);
            },

            write(value) {
                time(
                    moment.tz(time(), ko.unwrap(timezone))
                        .set(part, value)
                        .valueOf()
                );
            }
        });
    }
}

export default {
    viewModel: DateTimeChooserViewModel,
    template: template
};

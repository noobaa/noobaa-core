import template from './date-time-chooser.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import { makeRange } from 'utils';

class DateTimeChooserViewModel extends Disposable{
    constructor({ time, timezone }) {
        super();

        this.yearOptions = makeRange(
            moment().year() - 10, moment().year() + 10
        ).map(
            value => ({ label: value, value: value })
        );

        this.year = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), ko.unwrap(timezone)
            ).year()
        );

        this.monthOptions = makeRange(12).map(
            month => ({
                label: moment({ month }).format('MMM'),
                value: month
            })
        );

        this.month = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), ko.unwrap(timezone)
            ).month()
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

        this.day = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), ko.unwrap(timezone)
            ).date()
        );

        this.hour = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), ko.unwrap(timezone)
            ).hour()
        )
            .extend({ required: true, min: 0, max: 23 });

        this.minute = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), ko.unwrap(timezone)
            ).minute()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.second = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), ko.unwrap(timezone)
            ).second()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.addToDisposeList(
            setInterval(
                () => time() && time(time() + 1000),
                1000
            ),
            clearInterval
        );
    }
}

export default {
    viewModel: DateTimeChooserViewModel,
    template: template
};

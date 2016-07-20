import template from './server-time-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment-timezone';
import { systemInfo } from 'model';
import { makeRange } from 'utils';
import { updateServerClock, updateServerNTPSettings } from 'actions';

const configTypes =  Object.freeze([
    { label: 'Manual Time', value: 'MANUAL' },
    { label: 'Network Time (NTP)', value: 'NTP' }
]);

const timezoneOptions = moment.tz.names()
    .map(
        name => ({
            name: name,
            offset: moment.tz(name).utcOffset()
        })
    )
    .sort(
        (tz1, tz2) => tz1.offset - tz2.offset
    )
    .map(
        ({ name }) => {
            let offsetText = moment().tz(name).format('[GMT]Z');
            let label = name.replace(/\_/g, ' ');

            return {
                label: `(${offsetText}) ${label}`,
                value: name
            };
        }
    );

class ServerTimeFormViewModel extends Disposable{
    constructor() {
        super();

        let server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers[0]
        );

        this.serverSecret = ko.pureComputed(
            () => server() && server().secret
        );

        this.expanded = ko.observable(false);

        let time = ko.observableWithDefault(
            () => server() && server().time_epoch * 1000
        );

        this.formattedTime = ko.pureComputed(
            () => time() && moment(time()).format('MM/DD/YYYY HH:mm:ss ([GMT]Z)')
        );

        this.configTypes = configTypes;
        this.selectedConfigType = ko.observableWithDefault(
            () => server() && server().ntp_server ? 'NTP' : 'MANUAL'
        );

        this.usingManualTime = ko.pureComputed(
            () => this.selectedConfigType() === 'MANUAL'
        );

        this.usingNTP = ko.pureComputed(
            () => this.selectedConfigType() === 'NTP'
        );


        this.timezoneOptions = timezoneOptions;
        this.timezone = ko.observableWithDefault(
            () => server() && server().timezone
        );

        this.yearOptions = makeRange(
            moment().year() - 10, moment().year() + 10
        ).map(
            value => ({ label: value, value: value })
        );

        this.addToDisposeList(
            setInterval(
                () => time() && time(
                        time() + 1000
                ),
                1000
            ),
            clearInterval
        );

        this.year = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), this.timezone()
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
                time(), this.timezone()
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
                time(), this.timezone()
            ).date()
        );

        this.hour = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), this.timezone()
            ).hour()
        )
            .extend({ required: true, min: 0, max: 23 });

        this.minute = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), this.timezone()
            ).minute()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.second = ko.observableWithDefault(
            () => time() && moment.tz(
                time(), this.timezone()
            ).second()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.ntpServer = ko.observableWithDefault(
            () => server() && server().ntp_server
        )
            .extend({
                isIPOrDNSName: true,
                required: { message: 'Please enter an NTP server address' }
            });

        this.manualErrors = ko.validation.group([
            this.hour, this.minute, this.second
        ]);

        this.ntpErrors = ko.validation.group([
            this.ntpServer
        ]);
    }

    matchByTimezoneName(option, input) {
        let regExp = new RegExp(`\\b${input.replace('/', '\\/')}`);
        return regExp.test(option.label.toLowerCase());
    }

    applyChanges() {
        this.usingNTP() ? this.setNTPTime() : this.setManualTime();
    }

    setManualTime() {
        if (this.manualErrors().length > 0) {
            this.manualErrors.showAllMessages();

        } else {
            let epoch = moment.tz(
                {
                    years: this.year(),
                    months: this.month(),
                    date: this.day(),
                    hours: this.hour(),
                    minutes: this.minute(),
                    seconds: this.second()
                },
                this.timezone()
            )
            .unix();

            updateServerClock(
                this.serverSecret(), this.timezone(), epoch
            );
        }
    }

    setNTPTime() {
        if (this.ntpErrors().length > 0) {
            this.ntpErrors.showAllMessages();

        } else {
            updateServerNTPSettings(
                this.serverSecret(), this.timezone(), this.ntpServer()
            );
        }
    }
}

export default {
    viewModel: ServerTimeFormViewModel,
    template: template
};

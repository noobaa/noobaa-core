import template from './server-time-settings-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment-timezone';
import { makeRange } from 'utils';
import { systemInfo, serverTime } from 'model';
import { loadServerTime, updateServerClock, updateServerNTPSettings } from 'actions';

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

class ServerTimeSettingsModalViewModel extends Disposable {
    constructor({ serverSecret, onClose }) {
        super();

        this.onClose = onClose;
        this.serverSecret = ko.unwrap(serverSecret);
        this.configTypes = configTypes;

        let server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                server => server.secret === this.serverSecret
            )
        );

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

        let timeInMilliseconds = ko.observableWithDefault(
            () => {
                if (!serverTime() || serverTime().server != this.serverSecret) {
                    return 0;
                }

                return serverTime().time * 1000;
            }
        );

        this.disposeWithMe(
            setInterval(
                () => timeInMilliseconds() && timeInMilliseconds(
                        timeInMilliseconds() + 1000
                ),
                1000
            ),
            clearInterval
        );

        this.year = ko.observableWithDefault(
            () => timeInMilliseconds() && moment.tz(
                timeInMilliseconds(), this.timezone()
            ).year()
        );

        this.monthOptions = makeRange(12).map(
            month => ({
                label: moment({ month }).format('MMM'),
                value: month
            })
        );

        this.month = ko.observableWithDefault(
            () => timeInMilliseconds() && moment.tz(
                timeInMilliseconds(), this.timezone()
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
            () => timeInMilliseconds() && moment.tz(
                timeInMilliseconds(), this.timezone()
            ).date()
        );

        this.hour = ko.observableWithDefault(
            () => timeInMilliseconds() && moment.tz(
                timeInMilliseconds(), this.timezone()
            ).hour()
        )
            .extend({ required: true, min: 0, max: 23 });

        this.minute = ko.observableWithDefault(
            () => timeInMilliseconds() && moment.tz(
                timeInMilliseconds(), this.timezone()
            ).minute()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.second = ko.observableWithDefault(
            () => timeInMilliseconds() && moment.tz(
                timeInMilliseconds(), this.timezone()
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

        loadServerTime(this.serverSecret);
    }

    matchByTimezoneName(option, input) {
        let regExp = new RegExp(`\\b${input.replace('/', '\\/')}`);
        return regExp.test(option.label.toLowerCase());
    }

    save() {
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
                this.serverSecret, this.timezone(), epoch
            );
            this.onClose();
        }
    }

    setNTPTime() {
        if (this.ntpErrors().length > 0) {
            this.ntpErrors.showAllMessages();

        } else {
            updateServerNTPSettings(
                this.serverSecret, this.timezone(), this.ntpServer()
            );
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: ServerTimeSettingsModalViewModel,
    template: template
};

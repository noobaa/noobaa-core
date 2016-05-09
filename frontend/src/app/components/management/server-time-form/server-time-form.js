import template from './server-time-form.html';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { makeRange, toOwnKeyValuePair } from 'utils';
import { systemInfo } from 'model';
import timezones from './timezones';
import { updateServerTime, updateServerNTP } from 'actions';

const configTypes =  Object.freeze([
    { label: 'Manual Time', value: 'MANUAL' },
    { label: 'Network Time (NTP)', value: 'NTP' }
]);

function timezoneSearchSelector({ label }, input) {
    return !!label.toLowerCase().match(
        new RegExp(`\\b${input.replace('/', '\\/')}`)
    );
}

class ServerTimeFormViewModel {
    constructor() {
        this.expanded = ko.observable(false);

        this.configTypes = configTypes;

        let timeConfig = ko.pureComputed(
            () => systemInfo() && systemInfo().timeConfig
        );

        this.selectedConfigType = ko.observableWithDefault(
            () => timeConfig() && timeConfig().ntp_server ? 'NTP' : 'MANUAL'
        );

        this.usingManualTime = ko.pureComputed(
            () => this.selectedConfigType() === 'MANUAL'
        );

        this.usingNTP = ko.pureComputed(
            () => this.selectedConfigType() === 'NTP'
        );

        let serverTime = ko.observableWithDefault(
            () => timeConfig() && timeConfig().srv_time
        );

        this.serverTimeText = ko.pureComputed(
            () => moment.parseZone(serverTime()).format('MM/DD/YYYY HH:mm:ss ([GMT]Z)')
        );

        this.timezone = ko.observableWithDefault(
            () => timeConfig() && timeConfig().timezone
        );

        this.year = ko.observableWithDefault(
            () => moment.parseZone(serverTime()).year()
        );

        this.month = ko.observableWithDefault(
            () => moment.parseZone(serverTime()).month()
        );

        let day = ko.observableWithDefault(
            () => moment.parseZone(serverTime()).date()
        );

        this.day = ko.pureComputed({
            read: () => Math.min(day(), lastDayOfMonth()),
            write: day
        });

        this.hour = ko.observableWithDefault(
            () => moment.parseZone(serverTime()).hour()
        )
            .extend({ required: true, min: 0, max: 23 });

        this.minute = ko.observableWithDefault(
            () => moment.parseZone(serverTime()).minute()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.second = ko.observableWithDefault(
            () => moment.parseZone(serverTime()).second()
        )
            .extend({ required: true, min: 0, max: 59 });

        this.years = makeRange(moment().year() - 10, moment().year() + 10)
            .map(
                value => ({ label: value, value: value })
            );

        this.months = makeRange(12).map(
            month => ({ 
                label: moment({ month }).format('MMM'), 
                value: month
            })
        );

        let lastDayOfMonth = ko.pureComputed(
            () => moment({ year: this.year(), month: this.month() })
                .endOf('month')
                .date()
        );

        this.days = ko.pureComputed(
            () => makeRange(1, lastDayOfMonth()).map(
                value => ({ label: value, value: value })
            )
        );

        this.ntpServer = ko.observableWithDefault(
            () => timeConfig() && timeConfig().ntp_server
        )
            .extend({ 
                required: { 
                    message: 'Please fill in a NTP server address' 
                }
            });

        this.timezones = timezones.map(
            ({ key, value }) => ({
                label: `(GMT${value}) ${key.replace(/\_/g, ' ')}`,
                value: key
            })
        );

        this.autoIncHandle = setInterval(
            () => serverTime(
                moment.parseZone(serverTime()).add(1, 'second').format()
            ),
            1000
        );

        this.manualErrors = ko.validation.group({
            hour: this.hour,
            minute: this.minute,
            second: this.second,
        });

        this.ntpErrors = ko.validation.group({
            ntpServer: this.ntpServer
        });

        this.timezoneSearchSelector = timezoneSearchSelector;
    }

    applyChanges() {
        this.usingManualTime() ? this.setManualTime() : this.setNTPTime();
    }

    setManualTime() {
        if (this.manualErrors().length > 0) {
            this.manualErrors.showAllMessages();
        } else {
            let epoch = moment.utc({
                years: this.year(),
                months: this.month(),
                date: this.day(),
                hours: this.hour(),
                minutes: this.minute(),
                seconds: this.second(),
            })
            .unix();

            updateServerTime(this.timezone(), epoch);
        }
    }

    setNTPTime() {
        if (this.ntpErrors().length > 0) {
            this.ntpErrors.showAllMessages();
        } else {
            updateServerNTP(this.timezone(), this.ntpServer());
        }
    }

    dispose() {
        clearInterval(this.autoIncHandle);
    }    
}

export default {
    viewModel: ServerTimeFormViewModel,
    template: template
}

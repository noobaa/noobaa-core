import template from './server-time-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment-timezone';
import { systemInfo } from 'model';
import { updateServerClock, updateServerNTPSettings } from 'actions';

const configTypes =  Object.freeze([
    { label: 'Manual Time', value: 'MANUAL' },
    { label: 'Network Time (NTP)', value: 'NTP' }
]);

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

        this.time = ko.observableWithDefault(
            () => server() && server().time_epoch * 1000
        );

        this.formattedTime = ko.pureComputed(
            () => this.time() && moment(this.time()).format('MM/DD/YYYY HH:mm:ss ([GMT]Z)')
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

        this.timezone = ko.observableWithDefault(
            () => server() && server().timezone
        );

        this.ntpServer = ko.observableWithDefault(
            () => server() && server().ntp_server
        )
            .extend({
                isIPOrDNSName: true,
                required: { message: 'Please enter an NTP server address' }
            });

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

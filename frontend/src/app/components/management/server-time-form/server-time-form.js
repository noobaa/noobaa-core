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

        let cluster = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster
        );

        let server = ko.pureComputed(
            () => cluster() && cluster().shards[0].servers.find(
                server => server.secret === cluster().master_secret
            )
        );

        this.serverSecret = ko.pureComputed(
            () => server() && server().secret
        );

        this.expanded = ko.observable(false);

        this.time = ko.observableWithDefault(
            () => server() && server().time_epoch * 1000
        );

        this.addToDisposeList(
            setInterval(
                () => this.time() && this.time(this.time() + 1000),
                1000
            ),
            clearInterval
        );

        this.formattedTime = this.time.extend({
            formatTime: { format: 'MM/DD/YYYY HH:mm:ss ([GMT]Z)' }
        });

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

        this.isValid = ko.pureComputed(
            () => this.usingManualTime() || this.ntpErrors().length === 0
        );
    }

    applyChanges() {
        this.usingNTP() ? this.setNTPTime() : this.setManualTime();
    }

    setManualTime() {
        let epoch = moment.tz(this.time(), this.timezone()).unix();
        updateServerClock(this.serverSecret(), this.timezone(), epoch);
    }

    setNTPTime() {
        if (this.ntpErrors().length > 0) {
            this.ntpErrors.showAllMessages();

        } else {
            updateServerNTPSettings(this.serverSecret(), this.timezone(), this.ntpServer());
        }
    }
}

export default {
    viewModel: ServerTimeFormViewModel,
    template: template
};

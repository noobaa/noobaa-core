import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';

export default class UploadRowViewModel extends BaseViewModel {
    constructor(upload) {
        super();

        this.isVisible =  ko.pureComputed(
            () => !!upload()
        );

        this.name = ko.pureComputed(
            () => upload().name 
        );


        this.css = ko.pureComputed(
            () => upload().state.toLowerCase()
        );

        this.progress = ko.pureComputed(
            () => upload().state === 'UPLOADING' ?
                numeral(upload().progress).format('0%') :
                upload().state
        );

        this.toolTip = ko.pureComputed(
            () => upload().state === 'FAILED' ? upload().error.message : undefined
        );
    }
}
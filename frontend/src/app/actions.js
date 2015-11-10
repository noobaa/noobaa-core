import rx from 'rxjs';
import api from 'services/api';
import { systemInfo } from 'shared-streams';

export function readSystemInfo() {
	rx.Observable.fromPromise(api.read_system())
		.subscribe(si => systemInfo.onNext(si));
} 

export function createBucket(bucketInfo) {
	rx.Observable.fromPromise(api.create_bucket(bucketInfo))
		.subscribe(readSystemInfo);
}

export function deleteBucket(bucketName) {
	rx.Observable.fromPromise(api.delete_bucket({ name: bucketName }))
		.subscribe(readSystemInfo);
}
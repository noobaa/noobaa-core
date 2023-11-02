# NSFS Glacier Storage Class

## Goal
- Support "GLACIER" storage class in NooBaa which should behave similar to AWS "GLACIER" storage class.
- NooBaa should allow limited support of `RestoreObject` API.

## Approach
The current approach to support `GLACIER` storage class is to separate the implementation into two parts.
Main NooBaa process only manages metadata on the files/objects via extended attributes and maintains relevant
data in a log file. Another process (currently `manage_nsfs`) manages the actual movements of the files across
disk and tape.

There are 3 primary flows of concern and this document will discuss all 3 of them:
1. Upload object to `GLACIER` storage class (API: `PutObject`).
2. Restore object that are uploaded to `GLACIER` storage class (API: `RestoreObject`).
3. Copy objects where source is an object stored in `GLACIER` (API: `PutObject`).

### WAL
Important component of all the flows is the write ahead log (WAL). NooBaa has a `SimpleWAL` which as name states
is extremely simple in some senses. It does not deal with fsync issues, partial writes, holes, etc. rather just
appends data seperated by a new line character.

`SimpleWAL` features:
1. Exposes an `append` method which adds data to the file.
2. Can perform auto rotation of the file which makes sure that a single WAL is never too huge for the
WAL consumer to consume.
3. Exposes a `process` method which allows "safe" iteration on the previous WAL files.
4. Tries to make sure that no data loss happens due to process level races.

#### Races which are handled by the current implementation
1. `n` processes open the WAL file while a "consumer" swoops and tries to process the file affectively losing the
current writes (due to processing partially written file and ultimately invoking `unlink` on the file) - This isn't
possible as `process` method makes sure that it doesn't iterate over the "current active file".
2. `k` processes out of `n` (such that `k < n`) open the WAL while a "consumer" swoops and tries to process the
file affectively losing the current writes (due to unliking the file others hold reference to) - Although `process`
method will not protect against this as technically "current active file" is a different file but this is still **not**
possible as the "consumer" need to have an "EXCLUSIVE" lock on the files before it can process the file this makes sure
that for as long as any process is writing on the file, the "consumer" cannot consume the file and will block.
3. `k` processes out of `n` (such that `k < n`) open the WAL but before the NSFS process could get a "SHARED" lock on
the file the "consumer" process swoops in and process the files and then issues `unlink` on the file. The unlink will
not delete the file as `k` processes have open FD to the file but as soon as those processes will be done writing to
it and will close the FD, the file will be deleted which will result in lost writes - This isn't possible as `SimpleWAL`
does not allow writing to a file till it can get a lock on the file and ensure that there are `> 0` links to the file.
If there are no links then it tries to open file the again assuming that the consumer has issued `unlink` on the file
it holds the FD to.
4. Multiple processes try to swap the same file causing issues - This isn't possible as the process needs to acquire
a "swap lock" before it performs the swap which essentially serializes the operations. Further the swapping is done only
once by ensuring that the process only swaps if the current `inode` matches with the `inode` it got when it opened the
file initially, if not it skips the swapping.

### Requirements for `TAPECLOUD` backend
1. Scripts should be placed in `config.NSFS_GLACIER_TAPECLOUD_BIN_DIR` dir.
2. `migrate` script should take a file name and perform migrations of the files mentioned in the given file. The output should comply with `eeadm migrate` command.
3. `recall` script should take a file name and perform recall of the files mentioned in the given file. The output should comply with `eeadm recall` command.
3. `task_show` script should take a task id as argument and output its status. The output should be similar to `eeadm task show -r <id>`.
4. `scan_expired` should take a directory name and dump files in it. The files should have the names of all the files which need to be migrated back to disk. The names should be newline separated.
5. `low_free_space` script should output `true` if the disk has low free space or else should return `false`.

### Flow 1: Upload Object to Glacier
As mentioned earlier, any operation that is related to `GLACIER` are handled in 2 phases. One phase is immediate
which is managed my the NSFS process itself while another phase is something which needs to be invoked seperately
which manages the actual movements of the file.

#### Phase 1
1. PutObject is requested with storage class set to `GLACIER`.
2. NooBaa rejects the request if NooBaa isn't configured to support the given storage class. This is **not** enabled
by default and needs to be enabled via `config-local.js` by setting `config.NSFS_GLACIER_ENABLED = true` and `config.NSFS_GLACIER_LOGS_ENABLED = true`.
3. NooBaa will set the storage class to `GLACIER` by setting `user.storage_class` extended attribute.
4. NooBaa creates a simple WAL (Write Ahead Log) and appends the filename to the log file.
5. Completes the upload.

Once the upload is complete, the file sits on the disk till the second process kicks in and actually does the movement
of the file but main NooBaa process does not concerns itself with the actual file state and rather just relies on the
extended attributes to judge the state of the file. The implications of this is that NooBaa will refuse a file read operation
even if the file is on disk unless the user explicitly issues a `RestoreObject` (It should be noted that this is what AWS
does as well).

#### Phase 2
1. A scheduler (eg. Cron, human, script, etc) issues `node src/cmd/manage_nsfs glacier migrate --interval <val>`.
2. The command will first acquire an "EXCLUSIVE" lock so as to ensure that only one tape management command is running at once.
3. Once the process has the lock it will start to iterate over the potentially currently inactive files.
4. Before processing a WAL file, the proceess will get an "EXCLUSIVE" lock to the file ensuring that it is indeed the only
process processing the file.
5. It will read the WAL one line at a time and will ensure the following:
    1. The file still exists.
    2. The file is still has `GLACIER` storage class. (This is can happen if the user uploads another object with `STANDARD`
    storage class).
    3. The file doesn't have any of the `RestoreObject` extended attributes. This is to ensure that if the file was marked
    for restoration as soon as it was uploaded then we don't perform the migration at all. This is to avoid unnecessary
    work and also make sure that we don't end up racing with ourselves.
6. Once a file name passes through all the above criterions then we add its name to a temporary WAL and handover the file
name to `migrate` script which should be in `config.NSFS_GLACIER_TAPECLOUD_BIN_DIR` directory. We expect that the script will take the file name as its first parameter and will perform the migration. If the `config.NSFS_GLACIER_BACKEND` is set to `TAPECLOUD` (default) then we expect the script to output data in compliance with `eeadm migrate` command.
7. We delete the temporary WAL that we created.
8. We delete the WAL created by NSFS process **iff** there were no failures in `migrate`. In case of failures we skip the WAL
deletion as a way to retry during the next trigger of the script. It should be noted that NooBaa's `migrate` (`TAPECLOUD` backend) invocation does **not** consider `DUPLICATE TASK` an error.

### Flow 2: Restore Object
As mentioned earlier, any operation that is related to `GLACIER` are handled in 2 phases. One phase is immediate
which is managed my the NSFS process itself while another phase is something which needs to be invoked seperately
which manages the actual movements of the file.

#### Phase 1
1. RestoreObject is requested with non-zero positive number of days.
2. NooBaa rejects the request if NooBaa isn't configured to support the given storage class. This is **not** enabled
by default and needs to be enabled via `config-local.js` by setting `config.NSFS_GLACIER_ENABLED = true` and `config.NSFS_GLACIER_LOGS_ENABLED = true`.
3. NooBaa performs a number of checks to ensure that the operation is valid (for example there is no already ongoing
restore request going on etc).
4. NooBaa saves the filename to a simple WAL (Write Ahead Log).
5. Returns the request with success indicating that the restore request has been accepted.

#### Phase 2
1. A scheduler (eg. Cron, human, script, etc) issues `node src/cmd/manage_nsfs glacier restore --interval <val>`.
2. The command will first acquire an "EXCLUSIVE" lock so as to ensure that only one tape management command is running at once.
3. Once the process has the lock it will start to iterate over the potentially currently inactive files.
4. Before processing a WAL file, the proceess will get an "EXCLUSIVE" lock to the file ensuring that it is indeed the only
process processing the file.
5. It will read the WAL one line at a time and will store the names of the files that we expect to fail during an eeadm restore
(this can happen for example because a `RestoreObject` was issued for a file but later on that file was deleted before we could
actually process the file).
6. The WAL is handed over to `recall` script which should be present in `config.NSFS_GLACIER_TAPECLOUD_BIN_DIR` directory. We expect that the script will take the file name as its first parameter and will perform the recall. If the `config.NSFS_GLACIER_BACKEND` is set to `TAPECLOUD` (default) then we expect the script to output data in compliance with `eeadm recall` command.
7. If we get any unexpected failures then we mark it a failure and make sure we do not delete the WAL file (so as to retry later).
8. We iterate over the WAL again to set the final extended attributes. This is to make sure that we can communicate the latest with
the NSFS processes.

### Flow 3: Copy Object with Glacier Object as copy source
This is very similar to Flow 1 with some additional checks.  
If the source file is not in `GLACIER` storage class then normal procedure kicks in.  
If the source file is in `GLACIER` storage class then:
- NooBaa refuses the copy if the file is not already restored (similar to AWS behaviour).
- NooBaa accepts the copy if the file is already restored (similar to AWS behaviour).

